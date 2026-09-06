"""
IBVAP Night-Time Movement Detection Tests — Phase 1
==================================================

10 deterministic unit tests covering:
 1. Daytime walking produces zero night events
 2. Night stationary person produces zero night events
 3. Night sustained walking produces exactly ONE night movement incident
 4. Continued walking produces zero duplicate incidents (episode deduplication)
 5. Brief movement spike (<5 samples) produces zero events
 6. Micro-jitter below threshold produces zero events
 7. Vehicles/VTRK tracks produce zero human night movement events
 8. Independent track states (Track A walking triggers, Track B stationary does not)
 9. Coexistence with UNKNOWN_PERSON_DETECTED (both events coexist independently)
10. Bounded track history (<=60 samples) and inactive track cleanup
"""

import os
import sys
import pytest
import numpy as np
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, run_migrations
from database.models import CameraModel, IncidentModel, NightMovementModel
from ai.night_movement_engine import (
    NightMovementEngine,
    TrackNightMovementState,
)


@pytest.fixture(scope="module")
def db():
    run_migrations()
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def test_camera(db):
    cam = db.query(CameraModel).filter(CameraModel.camera_id == "CAM-NM-TEST").first()
    if not cam:
        cam = CameraModel(
            id="cam-nm-test-uuid",
            camera_id="CAM-NM-TEST",
            name="Night Movement Test Camera",
            source_url="simulated",
            source_type="SIMULATED",
            status="ONLINE",
            sector="Sector B",
            fps=30,
        )
        db.add(cam)
        db.commit()
        db.refresh(cam)
    yield cam
    db.query(NightMovementModel).filter(NightMovementModel.camera_id == "CAM-NM-TEST").delete()
    db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-NM-TEST").delete()
    db.query(CameraModel).filter(CameraModel.camera_id == "CAM-NM-TEST").delete()
    db.commit()


def make_synthetic_frame(avg_luma: float, dark_ratio: float, height: int = 100, width: int = 100):
    """
    Creates a synthetic BGR frame with predictable luminance and dark pixel ratio.
    """
    frame = np.full((height, width, 3), int(avg_luma), dtype=np.uint8)
    num_dark = int(height * width * dark_ratio)
    if num_dark > 0:
        flat = frame.reshape(-1, 3)
        flat[:num_dark] = [15, 15, 15]  # pixel < 50
    return frame


def test_daytime_walking_zero_night_events(db, test_camera):
    """Test 1: Normal walking under daylight illumination must produce 0 night events."""
    engine = NightMovementEngine()
    engine.reset()

    day_frame = make_synthetic_frame(avg_luma=140.0, dark_ratio=0.08)
    avg_luma, dark_ratio, is_night = engine.analyze_frame_lighting(day_frame)
    assert not is_night, f"Day frame incorrectly classified as night: luma={avg_luma}, dark_ratio={dark_ratio}"

    # Simulate 10 frames of human walking
    for i in range(10):
        human_tracks = [{
            "track_id": 101,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.92,
            "bounding_box": {"x": 0.10 + (i * 0.02), "y": 0.50, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=100.0 + i,
            db=db,
            frame_image=day_frame,
        )
        assert len(acts) == 0
        assert len(engine.last_created_incidents) == 0


def test_night_stationary_zero_night_events(db, test_camera):
    """Test 2: Standing still in the dark must NOT trigger night movement."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=35.0, dark_ratio=0.75)
    _, _, is_night = engine.analyze_frame_lighting(night_frame)
    assert is_night, "Frame should be classified as night"

    # Human standing still for 10 frames
    for i in range(10):
        human_tracks = [{
            "track_id": 102,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.90,
            "bounding_box": {"x": 0.40, "y": 0.50, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=200.0 + i,
            db=db,
            frame_image=night_frame,
        )
        assert len(acts) == 0
        assert len(engine.last_created_incidents) == 0


def test_night_sustained_walking_one_incident(db, test_camera):
    """Test 3: Sustained walking across >=5 frames at night produces exactly ONE incident + ONE record."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)
    created_incidents = []

    for i in range(5):
        human_tracks = [{
            "track_id": 103,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.94,
            "bounding_box": {"x": 0.20 + (i * 0.015), "y": 0.40, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=300.0 + i,
            db=db,
            frame_image=night_frame,
        )
        if engine.last_created_incidents:
            created_incidents.extend(engine.last_created_incidents)

    assert len(created_incidents) == 1
    inc = created_incidents[0]
    assert inc.event_type == "NIGHT_MOVEMENT_DETECTED"
    assert inc.track_id == "TRK#103"
    assert inc.threat_level == "high"
    assert inc.environment == "night"

    # Verify database persistence
    nm_db = db.query(NightMovementModel).filter(NightMovementModel.track_id == 103).all()
    assert len(nm_db) == 1
    assert nm_db[0].displacement >= 0.03
    assert nm_db[0].path_length >= 0.04


def test_continued_walking_deduplication(db, test_camera):
    """Test 4: Continued walking after initial event generates 0 duplicate incidents or records."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)
    all_created = []

    # Run for 20 continuous frames
    for i in range(20):
        human_tracks = [{
            "track_id": 104,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.91,
            "bounding_box": {"x": 0.10 + (i * 0.01), "y": 0.30, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=400.0 + i,
            db=db,
            frame_image=night_frame,
        )
        if engine.last_created_incidents:
            all_created.extend(engine.last_created_incidents)

    # Exactly 1 incident created across the entire 20-frame episode
    assert len(all_created) == 1
    nm_records = db.query(NightMovementModel).filter(NightMovementModel.track_id == 104).all()
    assert len(nm_records) == 1


def test_brief_movement_spike_rejected(db, test_camera):
    """Test 5: Movement lasting only 2 frames (<5 samples) must be rejected."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)

    # Frame 1 and Frame 2 only
    for i in range(2):
        human_tracks = [{
            "track_id": 105,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.88,
            "bounding_box": {"x": 0.20 + (i * 0.05), "y": 0.30, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=500.0 + i,
            db=db,
            frame_image=night_frame,
        )
        assert len(acts) == 0
        assert len(engine.last_created_incidents) == 0


def test_micro_jitter_rejected(db, test_camera):
    """Test 6: Stationary track with sensor jitter (displacement < 0.03) must not trigger."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)

    for i in range(8):
        jitter = 0.002 if (i % 2 == 0) else -0.002
        human_tracks = [{
            "track_id": 106,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.89,
            "bounding_box": {"x": 0.50 + jitter, "y": 0.50 + jitter, "width": 0.08, "height": 0.20},
        }]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=600.0 + i,
            db=db,
            frame_image=night_frame,
        )
        assert len(acts) == 0
        assert len(engine.last_created_incidents) == 0


def test_vehicle_separation(db, test_camera):
    """Test 7: Vehicles must never trigger night movement events."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)

    for i in range(10):
        # Mixed tracks: a vehicle moving rapidly
        vehicle_tracks = [
            {
                "track_id": 991,
                "track_label": "VTRK#991",
                "fine_class": "car",
                "object_type": "vehicle",
                "confidence": 0.95,
                "bounding_box": {"x": 0.10 + (i * 0.05), "y": 0.60, "width": 0.20, "height": 0.15},
            }
        ]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=vehicle_tracks,
            timestamp_sec=700.0 + i,
            db=db,
            frame_image=night_frame,
        )
        assert len(acts) == 0
        assert len(engine.last_created_incidents) == 0

    assert db.query(NightMovementModel).filter(NightMovementModel.track_id == 991).count() == 0


def test_independent_tracks(db, test_camera):
    """Test 8: Track 1 moving triggers event, Track 2 stationary does not."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)
    all_created = []

    for i in range(7):
        tracks = [
            # Track 201: Walking
            {
                "track_id": 201,
                "fine_class": "person",
                "object_type": "human",
                "confidence": 0.93,
                "bounding_box": {"x": 0.10 + (i * 0.015), "y": 0.30, "width": 0.08, "height": 0.20},
            },
            # Track 202: Standing still
            {
                "track_id": 202,
                "fine_class": "person",
                "object_type": "human",
                "confidence": 0.90,
                "bounding_box": {"x": 0.80, "y": 0.70, "width": 0.08, "height": 0.20},
            },
        ]
        acts = engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=tracks,
            timestamp_sec=800.0 + i,
            db=db,
            frame_image=night_frame,
        )
        if engine.last_created_incidents:
            all_created.extend(engine.last_created_incidents)

    # Only Track 201 should generate an incident
    assert len(all_created) == 1
    assert all_created[0].track_id == "TRK#201"
    assert db.query(NightMovementModel).filter(NightMovementModel.track_id == 201).count() == 1
    assert db.query(NightMovementModel).filter(NightMovementModel.track_id == 202).count() == 0


def test_coexistence_with_unknown_person(db, test_camera):
    """Test 9: UNKNOWN_PERSON_DETECTED and NIGHT_MOVEMENT_DETECTED coexist independently."""
    engine = NightMovementEngine()
    engine.reset()

    night_frame = make_synthetic_frame(avg_luma=30.0, dark_ratio=0.80)

    # 1. Create UNKNOWN_PERSON_DETECTED incident for TRK#301
    unk_inc = IncidentModel(
        id="inc-unk-test-uuid",
        incident_id="INC-UNK-TEST-01",
        camera_id=test_camera.camera_id,
        camera_name=test_camera.name,
        sector="Sector B",
        object_type="human",
        track_id="TRK#301",
        event_type="UNKNOWN_PERSON_DETECTED",
        threat_score=85,
        threat_level="high",
        explainable_reason="Unidentified individual in perimeter.",
        person_name="UNKNOWN",
        face_recognized=False,
    )
    db.add(unk_inc)
    db.commit()

    # 2. Process night movement for the same track TRK#301
    for i in range(6):
        human_tracks = [{
            "track_id": 301,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.94,
            "person_name": "UNKNOWN",
            "recognized": False,
            "bounding_box": {"x": 0.15 + (i * 0.02), "y": 0.35, "width": 0.08, "height": 0.20},
        }]
        engine.process_frame(
            camera_id=test_camera.camera_id,
            human_tracks=human_tracks,
            timestamp_sec=900.0 + i,
            db=db,
            frame_image=night_frame,
        )

    # Verify both incidents exist independently in DB for TRK#301
    incidents = db.query(IncidentModel).filter(
        IncidentModel.camera_id == test_camera.camera_id,
        IncidentModel.track_id == "TRK#301"
    ).all()

    event_types = {inc.event_type for inc in incidents}
    assert "UNKNOWN_PERSON_DETECTED" in event_types, "Unknown person event must remain intact"
    assert "NIGHT_MOVEMENT_DETECTED" in event_types, "Night movement event must be created"
    assert len(incidents) == 2, "Both events must coexist without overwriting each other"


def test_bounded_history_and_cleanup(db, test_camera):
    """Test 10: State history is bounded to maxlen 60 and disappeared tracks are purged."""
    engine = NightMovementEngine()
    engine.reset()

    state = TrackNightMovementState(test_camera.camera_id, 401)
    # Add 100 samples to verify bounded deque
    for i in range(100):
        state.add_sample(timestamp=1000.0 + i, cx=0.1 + (i * 0.001), cy=0.2)

    assert len(state.samples) == 60, "Samples deque must be strictly bounded to 60"

    # Test inactive track cleanup
    engine.camera_tracks[test_camera.camera_id] = {
        401: state
    }
    # Track has not been seen for 65 seconds
    engine.cleanup_inactive_tracks(
        camera_id=test_camera.camera_id,
        active_track_ids=[],
        timeout_sec=60.0,
        current_ts=1000.0 + 100 + 65,
    )
    assert 401 not in engine.camera_tracks.get(test_camera.camera_id, {}), "Disappeared track should be removed"
