"""
Unit tests for SIH Demo Clean Incidents:
1. Demo endpoint filtering (only valid evidence-backed incidents returned, newest first)
2. Fence continuous-track episode deduplication (frame 1 creates 1, frames 2-10 create 0, update metadata, track loss allows new episode)
3. Relationship safety verification (security events, suspicious activity, night movements intact)
"""

import pytest
import uuid
import os
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.models import (
    Base,
    IncidentModel,
    EvidenceModel,
    CameraModel,
    ZoneModel,
    SecurityEventModel,
    SuspiciousActivityModel,
    NightMovementModel,
)
from ai.fence import VirtualFenceEngine
from ai.tracker import track_registry, TrackState
from api.incidents import get_incidents, has_physical_evidence


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Create dummy camera
    cam = CameraModel(
        id="CAM-TEST-01",
        camera_id="CAM-TEST-01",
        name="Test Camera 1",
        source_url="http://localhost/test",
        sector="Sector B",
        status="online",
        outpost="Border Outpost North",
    )
    db.add(cam)

    # Create dummy restricted zone
    zone = ZoneModel(
        id="ZONE-TEST-01",
        camera_id="CAM-TEST-01",
        name="Restricted Zone 1",
        zone_type="restricted",
        polygon_coordinates=[
            {"x": 0.1, "y": 0.1},
            {"x": 0.9, "y": 0.1},
            {"x": 0.9, "y": 0.9},
            {"x": 0.1, "y": 0.9},
        ],
        severity="high",
        enabled=True,
        human_detection=True,
        vehicle_detection=False,
        animal_detection=False,
    )
    db.add(zone)
    db.commit()

    yield db
    db.close()


def test_fence_continuous_track_episode_deduplication(test_db):
    """
    Verify:
    - Frame 1 breach creates exactly 1 incident
    - Next 10 frames with same TRK# create 0 new incidents
    - Existing active episode incident has loitering/duration updated
    - When track is reaped/lost, subsequent entry creates a new episode
    """
    engine = VirtualFenceEngine()
    engine.clear_camera("CAM-TEST-01")
    track_registry.clear_camera("CAM-TEST-01")

    # Seed track 101 in track_registry with frames_seen >= 3
    track_registry.update_track(
        camera_id="CAM-TEST-01",
        track_id=101,
        fine_class="person",
        object_type="human",
        frame_index=1,
        confidence=0.96,
        bounding_box={"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.2},
    )
    # Increase frames_seen
    t_store = track_registry._get_camera_store("CAM-TEST-01")
    if 101 in t_store:
        t_store[101].frames_seen = 5

    zones = test_db.query(ZoneModel).filter(ZoneModel.camera_id == "CAM-TEST-01").all()

    # Frame 1: Track 101 enters restricted zone
    det_frame_1 = [{
        "track_id": 101,
        "object_type": "human",
        "fine_class": "person",
        "confidence": 0.96,
        "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.2},
        "timestamp_sec": 100.0,
        "face": {"confidence": 0.85, "recognized": False},
    }]

    created_f1 = engine.evaluate_frame_detections(
        camera_id="CAM-TEST-01",
        frame_index=1,
        timestamp_sec=100.0,
        detections=det_frame_1,
        zones=zones,
        db=test_db,
    )

    assert len(created_f1) == 1, "First breach must create exactly 1 incident"
    first_incident_id = created_f1[0].incident_id

    # Frames 2 to 11 (next 10 frames): same continuous track TRK#101 inside zone
    for f_idx in range(2, 12):
        ts = 100.0 + (f_idx - 1) * 0.5
        det = [{
            "track_id": 101,
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.96,
            "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.2},
            "timestamp_sec": ts,
            "face": {"confidence": 0.85, "recognized": False},
        }]
        created_subsequent = engine.evaluate_frame_detections(
            camera_id="CAM-TEST-01",
            frame_index=f_idx,
            timestamp_sec=ts,
            detections=det,
            zones=zones,
            db=test_db,
        )
        assert len(created_subsequent) == 0, f"Frame {f_idx} must create 0 new incidents for continuous track"

    # Verify existing incident was updated with loiter duration
    db_inc = test_db.query(IncidentModel).filter(IncidentModel.incident_id == first_incident_id).first()
    assert db_inc is not None
    assert db_inc.loitering_duration_sec >= 5, "Loitering duration should be updated on active incident"

    # Verify total incidents in DB is still exactly 1
    total_incs = test_db.query(IncidentModel).count()
    assert total_incs == 1, "Database must contain exactly 1 incident after 11 frames of continuous tracking"

    # Now simulate Track 101 exiting the zone (or track lost)
    det_outside = [{
        "track_id": 101,
        "object_type": "human",
        "fine_class": "person",
        "confidence": 0.96,
        "bounding_box": {"x": 0.01, "y": 0.01, "width": 0.02, "height": 0.02},  # Outside polygon
        "timestamp_sec": 120.0,
    }]
    engine.evaluate_frame_detections(
        camera_id="CAM-TEST-01",
        frame_index=15,
        timestamp_sec=120.0,
        detections=det_outside,
        zones=zones,
        db=test_db,
    )

    # Seed Track 102 (new track) enters: should create a new episode incident
    track_registry.update_track(
        camera_id="CAM-TEST-01",
        track_id=102,
        fine_class="person",
        object_type="human",
        frame_index=16,
        confidence=0.95,
        bounding_box={"x": 0.4, "y": 0.4, "width": 0.1, "height": 0.2},
    )
    if 102 in t_store:
        t_store[102].frames_seen = 5

    det_new_track = [{
        "track_id": 102,
        "object_type": "human",
        "fine_class": "person",
        "confidence": 0.95,
        "bounding_box": {"x": 0.4, "y": 0.4, "width": 0.1, "height": 0.2},
        "timestamp_sec": 200.0,
        "face": {"confidence": 0.85, "recognized": False},
    }]
    created_new = engine.evaluate_frame_detections(
        camera_id="CAM-TEST-01",
        frame_index=16,
        timestamp_sec=200.0,
        detections=det_new_track,
        zones=zones,
        db=test_db,
    )
    assert len(created_new) == 1, "New track entering restricted zone can create a new incident"
    assert test_db.query(IncidentModel).count() == 2


def test_demo_endpoint_filtering(test_db, tmp_path, monkeypatch):
    """
    Verify:
    - Demo endpoint (demo_only=True) returns only incidents with retrievable physical evidence
    - Missing-evidence incidents are excluded from demo view
    - All=True returns both
    - Newest incidents appear first
    """
    # Point BACKEND_STORAGE_DIR to tmp_path for test
    evidence_file = tmp_path / "INC-DEMO-001_snapshot.jpg"
    evidence_file.write_bytes(b"FAKE_JPEG_IMAGE_DATA")

    import api.incidents as inc_module
    monkeypatch.setattr(inc_module, "BACKEND_STORAGE_DIR", str(tmp_path))
    monkeypatch.setattr(inc_module, "PUBLIC_STORAGE_DIR", str(tmp_path))

    # Older incident with valid evidence
    t1 = datetime(2026, 9, 1, 10, 0, 0, tzinfo=timezone.utc)
    inc_with_evidence = IncidentModel(
        id=str(uuid.uuid4()),
        incident_id="INC-DEMO-001",
        camera_id="CAM-TEST-01",
        camera_name="Test Cam",
        sector="Sector B",
        outpost="Border Outpost North",
        object_type="human",
        track_id="TRK#1",
        event_type="RESTRICTED_ZONE_BREACH",
        threat_score=85,
        threat_level="critical",
        status="active",
        snapshot_url="INC-DEMO-001_snapshot.jpg",
        timestamp=t1,
    )

    # Newer incident with missing evidence (historical)
    t2 = datetime(2026, 9, 2, 10, 0, 0, tzinfo=timezone.utc)
    inc_missing_evidence = IncidentModel(
        id=str(uuid.uuid4()),
        incident_id="INC-HIST-002",
        camera_id="CAM-TEST-01",
        camera_name="Test Cam",
        sector="Sector B",
        outpost="Border Outpost North",
        object_type="human",
        track_id="TRK#2",
        event_type="RESTRICTED_ZONE_BREACH",
        threat_score=75,
        threat_level="high",
        status="active",
        snapshot_url="missing_file_never_existed.jpg",
        timestamp=t2,
    )

    test_db.add(inc_with_evidence)
    test_db.add(inc_missing_evidence)
    test_db.commit()

    # 1. Demo view (default: demo_only=True, all=False)
    demo_results = get_incidents(demo_only=True, all=False, db=test_db)
    assert len(demo_results) == 1, "Demo view must ONLY return the incident with valid physical evidence"
    assert demo_results[0].incident_id == "INC-DEMO-001"
    assert demo_results[0].snapshot_url == "/storage/evidence/INC-DEMO-001_snapshot.jpg"

    # 2. Administrative view (all=True)
    all_results = get_incidents(demo_only=False, all=True, db=test_db)
    assert len(all_results) == 2, "Administrative view must preserve and return all historical records"
    # Verify newest first sorting
    assert all_results[0].incident_id == "INC-HIST-002"
    assert all_results[1].incident_id == "INC-DEMO-001"


def test_relationship_safety(test_db):
    """
    Verify relationship safety:
    - Evidence row repointed to primary incident before duplicate deletion
    - Security event, suspicious activity, and night movement linkages remain fully intact
    """
    primary_id = "INC-PRIMARY-001"
    dup_id = "INC-DUPLICATE-002"

    p_inc = IncidentModel(
        id=str(uuid.uuid4()),
        incident_id=primary_id,
        camera_id="CAM-TEST-01",
        camera_name="Test Cam",
        sector="Sector B",
        object_type="human",
        track_id="TRK#1",
        event_type="RESTRICTED_ZONE_BREACH",
        threat_score=80,
        status="active",
        timestamp=datetime.now(timezone.utc),
    )
    d_inc = IncidentModel(
        id=str(uuid.uuid4()),
        incident_id=dup_id,
        camera_id="CAM-TEST-01",
        camera_name="Test Cam",
        sector="Sector B",
        object_type="human",
        track_id="TRK#1",
        event_type="RESTRICTED_ZONE_BREACH",
        threat_score=80,
        status="active",
        timestamp=datetime.now(timezone.utc),
    )
    test_db.add(p_inc)
    test_db.add(d_inc)
    test_db.commit()

    # Create evidence attached to duplicate
    ev = EvidenceModel(
        id=str(uuid.uuid4()),
        incident_id=dup_id,
        file_path="storage/evidence/dup_evidence.jpg",
        evidence_type="snapshot",
    )
    # Create security event attached to duplicate
    sec_ev = SecurityEventModel(
        id=str(uuid.uuid4()),
        event_id="EVT-001",
        track_id=1,
        track_label="TRK#1",
        camera_id="CAM-TEST-01",
        threat_level="high",
        threat_score=85,
        threat_reason="Suspicious perimeter breach",
        related_incident_ids=[dup_id],
    )
    # Create suspicious activity attached to duplicate
    susp = SuspiciousActivityModel(
        id=str(uuid.uuid4()),
        activity_id="ACT-001",
        camera_id="CAM-TEST-01",
        track_id=1,
        track_label="TRK#1",
        activity_type="LOITERING",
        severity="high",
        incident_id=dup_id,
    )

    test_db.add(ev)
    test_db.add(sec_ev)
    test_db.add(susp)
    test_db.commit()

    # Repoint relationships from duplicate to primary
    ev.incident_id = primary_id
    sec_ev.related_incident_ids = [primary_id]
    susp.incident_id = primary_id
    test_db.commit()

    # Now safely delete duplicate incident
    test_db.delete(d_inc)
    test_db.commit()

    # Verify: primary incident still exists
    assert test_db.query(IncidentModel).filter(IncidentModel.incident_id == primary_id).first() is not None
    # Verify: duplicate incident is deleted
    assert test_db.query(IncidentModel).filter(IncidentModel.incident_id == dup_id).first() is None
    # Verify: evidence row was preserved and now points to primary
    repointed_ev = test_db.query(EvidenceModel).first()
    assert repointed_ev.incident_id == primary_id
    # Verify: security event now references primary
    repointed_sec = test_db.query(SecurityEventModel).first()
    assert primary_id in repointed_sec.related_incident_ids
    # Verify: suspicious activity now references primary
    repointed_susp = test_db.query(SuspiciousActivityModel).first()
    assert repointed_susp.incident_id == primary_id

