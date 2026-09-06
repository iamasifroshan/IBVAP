"""
IBVAP Phase 4 — Unified Threat & Event Intelligence Test Suite.
Verifies all 19 mandatory test cases, negative tests, Sentinel Query, and API endpoints.
"""

import time
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from database.db import SessionLocal
from database.models import SecurityEventModel, CameraModel
from ai.security_intelligence import UnifiedSecurityIntelligenceEngine
from main import app


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        # Create dummy camera if not present
        cam = db.query(CameraModel).filter(CameraModel.camera_id == "BORDER-CAM-07").first()
        if not cam:
            cam = CameraModel(
                camera_id="BORDER-CAM-07",
                name="Border Cam 07",
                sector="Sector B",
                source_url="test.mp4",
                status="online"
            )
            db.add(cam)
            db.commit()
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def fresh_engine():
    """Returns a clean UnifiedSecurityIntelligenceEngine instance for deterministic test state."""
    engine = UnifiedSecurityIntelligenceEngine()
    engine.stale_timeout_sec = 0.5  # fast timeout for tests
    return engine


class TestUnifiedSecurityIntelligence:

    # ── TEST 1: Known person walking normally ──
    def test_01_known_person_walking_normally(self, db_session, fresh_engine):
        face = {
            "recognized": True,
            "name": "Asif",
            "identity_status": "KNOWN",
            "confidence": 0.88,
        }
        ev = fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=10,
            confidence=0.92,
            bounding_box={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face_info=face,
            zone_name=None,
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        assert ev.threat_level == "low"
        assert ev.threat_score <= 25
        assert "Asif" in ev.threat_reason or "Authorized" in ev.threat_reason
        assert ev.face_info["person_name"] == "Asif"
        assert ev.face_info["identity_status"] == "KNOWN"

    # ── TEST 2: Unknown person alone ──
    def test_02_unknown_person_alone(self, db_session, fresh_engine):
        face = {
            "recognized": False,
            "identity_status": "UNKNOWN",
            "confidence": 0.40,
        }
        ev = fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=12,
            confidence=0.89,
            bounding_box={"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.5},
            face_info=face,
            zone_name=None,
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        # Unknown person alone according to rule is MEDIUM
        assert ev.threat_level == "medium"
        assert "Unidentified subject" in ev.threat_reason
        assert "UNKNOWN_PERSON" in ev.contributing_signals

    # ── TEST 3: Night movement correlated with same TRK# ──
    def test_03_night_movement_correlation(self, db_session, fresh_engine):
        fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=15,
            confidence=0.85,
            bounding_box={"x": 0.3, "y": 0.3, "width": 0.2, "height": 0.5},
            face_info=None,
            zone_name=None,
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        fresh_engine.attach_night_movement(
            camera_id="BORDER-CAM-07",
            track_id=15,
            avg_luma=38.0,
            dark_pixel_ratio=0.55,
            displacement=0.08,
            path_length=0.12,
            incident_id="INC-NM-15",
            db=db_session
        )
        ev = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")[0]
        assert ev.track_id == 15
        assert "NIGHT_MOVEMENT" in ev.contributing_signals
        assert "night" in ev.threat_reason.lower()
        assert "INC-NM-15" in ev.related_incident_ids

    # ── TEST 4: Suspicious loitering correlated with same TRK# ──
    def test_04_suspicious_loitering_correlation(self, db_session, fresh_engine):
        fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=20,
            confidence=0.90,
            bounding_box={"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.5},
            face_info=None,
            zone_name=None,
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        fresh_engine.attach_suspicious_activity(
            camera_id="BORDER-CAM-07",
            track_id=20,
            activity_type="SUSPICIOUS_LOITERING",
            severity="HIGH",
            description="Subject loitering near fence",
            incident_id="INC-SUSP-20",
            db=db_session
        )
        ev = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")[0]
        assert ev.track_id == 20
        assert "SUSPICIOUS_LOITERING" in ev.contributing_signals
        assert "INC-SUSP-20" in ev.related_incident_ids

    # ── TEST 5: Restricted zone behavior correlation ──
    def test_05_restricted_zone_behavior_correlation(self, db_session, fresh_engine):
        ev = fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=25,
            confidence=0.88,
            bounding_box={"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.5},
            face_info=None,
            zone_name="Buffer Zone North",
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        assert "RESTRICTED_ZONE_PRESENCE" in ev.contributing_signals

    # ── TEST 6: Unknown + night movement = ONE unified event ──
    def test_06_unknown_plus_night_movement_one_event(self, db_session, fresh_engine):
        face = {"identity_status": "UNKNOWN"}
        ev1 = fresh_engine.ingest_human_frame_signals(
            camera_id="BORDER-CAM-07",
            track_id=30,
            confidence=0.91,
            bounding_box={"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face_info=face,
            zone_name=None,
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        ev_id = ev1.event_id

        fresh_engine.attach_night_movement(
            camera_id="BORDER-CAM-07",
            track_id=30,
            avg_luma=42.0,
            dark_pixel_ratio=0.5,
            displacement=0.06,
            path_length=0.1,
            incident_id="INC-NM-30",
            db=db_session
        )
        active_events = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")
        assert len(active_events) == 1
        ev = active_events[0]
        assert ev.event_id == ev_id
        # ONE unified event contains both signals!
        assert "UNKNOWN_PERSON" in ev.contributing_signals
        assert "NIGHT_MOVEMENT" in ev.contributing_signals
        assert ev.threat_level == "high"

    # ── TEST 7: Unknown + suspicious + night movement escalates ──
    def test_07_unknown_suspicious_night_escalation(self, db_session, fresh_engine):
        face = {"identity_status": "UNKNOWN"}
        fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 35, 0.93,
            {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        fresh_engine.attach_night_movement(
            "BORDER-CAM-07", 35, 35.0, 0.6, 0.05, 0.08, "INC-NM-35", db_session
        )
        fresh_engine.attach_suspicious_activity(
            "BORDER-CAM-07", 35, "SUSPICIOUS_LOITERING", "HIGH", "Loitering", "INC-SUSP-35", db_session
        )
        ev = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")[0]
        assert ev.threat_level in ("high", "critical")
        assert ev.threat_score >= 80

    # ── TEST 8: Fence + suspicious + night -> HIGH / CRITICAL ──
    def test_08_fence_suspicious_night_critical(self, db_session, fresh_engine):
        face = {"identity_status": "UNKNOWN"}
        fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 40, 0.95,
            {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        fresh_engine.attach_incident(
            "BORDER-CAM-07", 40, "INC-FENCE-40", "RESTRICTED_ZONE_BREACH", "/snap/fence.jpg", db_session
        )
        fresh_engine.attach_night_movement(
            "BORDER-CAM-07", 40, 30.0, 0.7, 0.1, 0.15, "INC-NM-40", db_session
        )
        fresh_engine.attach_suspicious_activity(
            "BORDER-CAM-07", 40, "SUSPICIOUS_RAPID_MOVEMENT", "CRITICAL", "Rapid breach", "INC-SUSP-40", db_session
        )
        ev = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")[0]
        assert ev.threat_level == "critical"
        assert ev.threat_score >= 90
        assert "perimeter" in ev.threat_reason.lower() or "intruder" in ev.threat_reason.lower()

    # ── TEST 9: Two different TRK# produce two separate events ──
    def test_09_two_different_tracks_separate_events(self, db_session, fresh_engine):
        ev1 = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 50, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        ev2 = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 51, 0.88, {"x": 0.5, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        assert ev1.event_id != ev2.event_id
        assert ev1.track_id == 50
        assert ev2.track_id == 51

    # ── TEST 10: Same track number on two cameras NOT merged ──
    def test_10_same_track_different_cameras_isolated(self, db_session, fresh_engine):
        ev1 = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 60, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        ev2 = fresh_engine.ingest_human_frame_signals(
            "SECTOR-B-CAM-03", 60, 0.91, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Sector B Cam 03"
        )
        assert ev1.event_id != ev2.event_id
        assert ev1.camera_id == "BORDER-CAM-07"
        assert ev2.camera_id == "SECTOR-B-CAM-03"

    # ── TEST 11: Same track over many frames = ONE active unified event ──
    def test_11_same_track_multiple_frames_deduplication(self, db_session, fresh_engine):
        first_ev = None
        for frame in range(15):
            ev = fresh_engine.ingest_human_frame_signals(
                "BORDER-CAM-07", 70, 0.88, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
                None, None, time.time(), db_session, "Border Cam 07"
            )
            if first_ev is None:
                first_ev = ev
            else:
                assert ev.event_id == first_ev.event_id

        # Verify in DB: exactly ONE row for event_id
        count = db_session.query(SecurityEventModel).filter(
            SecurityEventModel.event_id == first_ev.event_id
        ).count()
        assert count == 1

    # ── TEST 12: Track disappears -> becomes RESOLVED after timeout ──
    def test_12_track_disappearance_resolves_event(self, db_session, fresh_engine):
        ev = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 80, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        ev_id = ev.event_id
        assert ev.status == "active"

        # Wait past stale_timeout_sec (0.5s)
        time.sleep(0.6)
        resolved = fresh_engine.reap_stale_events("BORDER-CAM-07", active_human_track_ids=[], active_vehicle_track_ids=[], timeout_sec=0.5, db=db_session)
        resolved_ids = [r.event_id for r in resolved]
        assert ev_id in resolved_ids

        # Check DB status
        row = db_session.query(SecurityEventModel).filter(SecurityEventModel.event_id == ev_id).first()
        assert row.status == "resolved"

    # ── TEST 13: WebSocket payload and rate limiting ──
    def test_13_websocket_payload_and_rate_limiting(self, db_session, fresh_engine):
        broadcast_calls = []
        fresh_engine._broadcast_event = lambda event_type, data: broadcast_calls.append((event_type, data))

        face = {"identity_status": "UNKNOWN"}
        # Ingest frame 1
        fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 90, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        assert len(broadcast_calls) == 1
        assert broadcast_calls[0][0] == "SECURITY_EVENT_UPDATED"
        payload = broadcast_calls[0][1]
        assert payload.track_id == 90
        assert payload.threat_level == "medium"
        assert "UNKNOWN_PERSON" in payload.contributing_signals

        # Ingest frame 2 immediately without state change -> rate limited, no spam
        fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 90, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        assert len(broadcast_calls) == 1

    # ── TEST 14: Related evidence correctly linked ──
    def test_14_evidence_correctly_linked(self, db_session, fresh_engine):
        fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 95, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        fresh_engine.attach_evidence(
            "BORDER-CAM-07", track_id=95, evidence_id="EVID-TEST-95",
            snapshot_url="/snapshots/test95.jpg", db=db_session
        )
        ev = fresh_engine.get_active_states(camera_id="BORDER-CAM-07")[0]
        assert "EVID-TEST-95" in ev.related_evidence_ids
        assert ev.snapshot_url == "/snapshots/test95.jpg"

        # Attaching the same evidence again should not duplicate
        fresh_engine.attach_evidence(
            "BORDER-CAM-07", track_id=95, evidence_id="EVID-TEST-95",
            snapshot_url="/snapshots/test95.jpg", db=db_session
        )
        assert ev.related_evidence_ids.count("EVID-TEST-95") == 1

    # ── TEST 15: Vehicle VTRK# isolated from human threat ──
    def test_15_vehicle_isolated_from_human_threat(self, db_session, fresh_engine):
        ev = fresh_engine.ingest_vehicle_signals(
            camera_id="BORDER-CAM-07",
            track_id=100,
            vehicle_class="car",
            plate_text="PB02AB1234",
            plate_confidence=0.88,
            format_valid=True,
            direction="inbound",
            timestamp_sec=time.time(),
            db=db_session,
            camera_name="Border Cam 07"
        )
        assert ev.subject_type == "vehicle"
        assert ev.track_label == "VTRK#100"
        assert ev.threat_level == "low"
        # Vehicle must NEVER have human signals or incidents
        assert "UNKNOWN_PERSON" not in ev.contributing_signals
        assert "NIGHT_MOVEMENT" not in ev.contributing_signals
        assert ev.face_info is None
        assert ev.vehicle_info["plate_text"] == "PB02AB1234"


class TestNegativeScenariosAndSemantics:

    # ── NEGATIVE TESTS: Normal activities do not trigger high threats ──
    def test_negative_normal_walking(self, db_session, fresh_engine):
        ev = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 110, 0.95, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            None, None, time.time(), db_session, "Border Cam 07"
        )
        assert ev.threat_level == "low"

    def test_negative_known_person_walking(self, db_session, fresh_engine):
        face = {"identity_status": "KNOWN", "name": "Gokul", "recognized": True}
        ev = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 111, 0.94, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        assert ev.threat_level == "low"
        assert "Gokul" in ev.threat_reason or "known" in ev.threat_reason.lower()

    def test_negative_normal_vehicle_movement(self, db_session, fresh_engine):
        ev = fresh_engine.ingest_vehicle_signals(
            "BORDER-CAM-07", 112, "truck", None, 0.0, False, "outbound", time.time(), db_session, "Border Cam 07"
        )
        assert ev.threat_level == "low"

    # ── CRITICAL IDENTITY SEMANTICS ──
    def test_face_unavailable_is_not_unknown(self, db_session, fresh_engine):
        face = {"identity_status": "FACE_UNAVAILABLE"}
        ev = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 115, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        assert ev.threat_level == "low"
        assert "UNKNOWN_PERSON" not in ev.contributing_signals
        assert ev.face_info["identity_status"] == "FACE_UNAVAILABLE"

    def test_face_processing_error_is_not_unknown(self, db_session, fresh_engine):
        face = {"identity_status": "FACE_PROCESSING_ERROR"}
        ev = fresh_engine.ingest_human_frame_signals(
            "BORDER-CAM-07", 116, 0.90, {"x": 0.1, "y": 0.1, "width": 0.2, "height": 0.5},
            face, None, time.time(), db_session, "Border Cam 07"
        )
        assert ev.threat_level == "low"
        assert "UNKNOWN_PERSON" not in ev.contributing_signals
        assert ev.face_info["identity_status"] == "FACE_PROCESSING_ERROR"


class TestSentinelQueryAndAPI:

    def test_api_security_events_endpoints(self, client, db_session):
        now_dt = datetime.now(timezone.utc)
        # Create a security event in DB
        ev = SecurityEventModel(
            event_id="EVT-API-01",
            camera_id="BORDER-CAM-07",
            camera_name="Border Cam 07",
            subject_type="human",
            track_id=27,
            track_label="TRK#27",
            threat_level="high",
            threat_score=75,
            threat_reason="Unknown person exhibiting night movement.",
            status="active",
            contributing_signals=["unknown_person", "night_movement"],
            related_incident_ids=["INC-01"],
            first_seen=now_dt,
            last_seen=now_dt,
        )
        db_session.add(ev)
        db_session.commit()

        # 1. GET /api/v1/security-events
        res = client.get("/api/v1/security-events?threat_level=high")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 1
        match = [e for e in data if e["event_id"] == "EVT-API-01"]
        assert len(match) == 1
        assert match[0]["track_id"] == 27

        # 2. GET /api/v1/security-events/stats
        stats_res = client.get("/api/v1/security-events/stats")
        assert stats_res.status_code == 200
        stats = stats_res.json()
        assert stats["total_events"] >= 1
        assert "high" in stats["threat_level_breakdown"]

        # 3. GET /api/v1/security-events/{id}
        one_res = client.get("/api/v1/security-events/EVT-API-01")
        assert one_res.status_code == 200
        assert one_res.json()["event_id"] == "EVT-API-01"

        # 4. GET /api/v1/cameras/{camera_id}/security-events
        cam_res = client.get("/api/v1/cameras/BORDER-CAM-07/security-events")
        assert cam_res.status_code == 200
        assert len(cam_res.json()) >= 1

    def test_sentinel_query_security_events(self, client, db_session):
        # Query: "show high threat events for BORDER-CAM-07"
        res = client.post("/api/v1/search/query", json={"query": "show high threat events for BORDER-CAM-07"})
        assert res.status_code == 200
        payload = res.json()
        assert "security_events" in payload
        assert len(payload["security_events"]) >= 1

        # Query: "show events involving TRK#27"
        res2 = client.post("/api/v1/search/query", json={"query": "show events involving TRK#27"})
        assert res2.status_code == 200
        payload2 = res2.json()
        assert any(e["track_id"] == 27 for e in payload2.get("security_events", []))
