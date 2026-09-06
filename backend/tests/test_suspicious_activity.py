"""
IBVAP Phase 1 Suspicious Activity Detection Tests
=================================================

16 deterministic tests covering:
 1. Normal walking produces zero suspicious events
 2. Standing for 10 seconds produces zero events
 3. Stationary >=30 seconds produces exactly ONE UNUSUAL_STOP
 4. Local repeated movement >=30 seconds produces exactly ONE LOITERING
 5. Prolonged loitering across many frames produces exactly ONE incident
 6. Independent track states (Track A loitering, Track B walking)
 7. Independent camera states (isolated per camera_id)
 8. One-frame speed spike produces zero events
 9. Sustained high speed >=5 consecutive samples produces ONE RAPID_MOVEMENT
10. Restricted-zone presence >=10 seconds produces ONE event
11. Virtual fence crossing (<10s) does not create duplicate restricted-zone behavior
12. Vehicles/VTRK produce zero suspicious events
13. Unknown-person detection does not automatically create suspicious activity
14. Disappeared tracks are cleaned from memory
15. Bounded history never exceeds 60 samples
16. Activity duration updates without creating duplicate incidents
"""

import os
import sys
import uuid
import pytest
from datetime import datetime, timezone
from collections import deque

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, run_migrations, get_db
from database.models import CameraModel, IncidentModel, SuspiciousActivityModel, ZoneModel
from ai.suspicious_engine import (
    SuspiciousActivityEngine,
    TrackSuspiciousState,
    BEHAVIOR_UNUSUAL_STOP,
    BEHAVIOR_LOITERING,
    BEHAVIOR_RAPID_MOVEMENT,
    BEHAVIOR_RESTRICTED_ZONE,
)


@pytest.fixture(scope="module")
def db():
    run_migrations()
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def test_camera(db):
    cam = db.query(CameraModel).filter(CameraModel.camera_id == "CAM-SUSP-TEST").first()
    if not cam:
        cam = CameraModel(
            id="cam-susp-test-uuid",
            camera_id="CAM-SUSP-TEST",
            name="Suspicious Test Camera",
            source_url="webcam",
            source_type="WEBCAM",
            status="ONLINE",
            sector="Sector B",
            fps=30,
        )
        db.add(cam)
        db.commit()
        db.refresh(cam)
    yield cam
    db.query(SuspiciousActivityModel).filter(SuspiciousActivityModel.camera_id == "CAM-SUSP-TEST").delete()
    db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-SUSP-TEST").delete()
    db.query(CameraModel).filter(CameraModel.camera_id == "CAM-SUSP-TEST").delete()
    db.commit()


@pytest.fixture
def clean_engine():
    engine = SuspiciousActivityEngine()
    engine.clear_camera("CAM-SUSP-TEST")
    return engine


@pytest.fixture
def sample_zone():
    return ZoneModel(
        id="zone-restricted-test",
        camera_id="CAM-SUSP-TEST",
        name="High Security Fence Zone",
        sector="Sector B",
        zone_type="restricted_fence",
        polygon_coordinates=[
            {"x": 0.4, "y": 0.4},
            {"x": 0.8, "y": 0.4},
            {"x": 0.8, "y": 0.8},
            {"x": 0.4, "y": 0.8},
        ],
        enabled=True,
        human_detection=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — Normal walking produces zero suspicious events
# ─────────────────────────────────────────────────────────────────────────────

def test_01_normal_walking_produces_zero_suspicious_events(clean_engine):
    """A person continuously walking forward across the frame produces zero suspicious events."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 1

    # Walk from x=0.05 to x=0.55 over 35 seconds (continuous displacement)
    behavior = None
    for step in range(35):
        t = float(step)
        x = 0.05 + (step * 0.015)  # net displacement = 0.51 >> 0.12
        bbox = {"x": x, "y": 0.2, "width": 0.05, "height": 0.15}
        b, desc, dur = engine.evaluate_human_track(
            camera_id=camera_id,
            track_id=track_id,
            bbox=bbox,
            timestamp_sec=t,
            zones=[],
        )
        if b is not None:
            behavior = b

    assert behavior is None, f"Normal walking should not trigger any suspicious behavior, got {behavior}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — Standing for 10 seconds produces zero events
# ─────────────────────────────────────────────────────────────────────────────

def test_02_standing_for_10_seconds_produces_zero_events(clean_engine):
    """Brief standing (10s < 30s) is completely normal and produces zero events."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 2

    behavior = None
    for step in range(11):
        t = float(step)
        bbox = {"x": 0.30, "y": 0.30, "width": 0.05, "height": 0.15}
        b, desc, dur = engine.evaluate_human_track(
            camera_id=camera_id,
            track_id=track_id,
            bbox=bbox,
            timestamp_sec=t,
            zones=[],
        )
        if b is not None:
            behavior = b

    assert behavior is None, "Standing for 10 seconds must not create a suspicious event"


# ─────────────────────────────────────────────────────────────────────────────
# Test 3 — Stationary >=30 seconds produces exactly ONE UNUSUAL_STOP
# ─────────────────────────────────────────────────────────────────────────────

def test_03_stationary_30_seconds_produces_exactly_one_unusual_stop(clean_engine, db, test_camera):
    """Remaining motionless for >=30s triggers UNUSUAL_STOP and creates exactly ONE incident."""
    engine = clean_engine
    camera_id = test_camera.camera_id
    track_id = 3

    inc_before = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()
    susp_before = db.query(SuspiciousActivityModel).filter(SuspiciousActivityModel.camera_id == camera_id).count()

    # Feed 32 seconds of motionless samples
    last_activities = []
    for step in range(33):
        t = float(step)
        # Slight negligible jitter (<0.0001)
        bbox = {"x": 0.25, "y": 0.25, "width": 0.05, "height": 0.15}
        human_tracks = [{
            "track_id": track_id,
            "track_label": f"TRK#{track_id}",
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.92,
            "bounding_box": bbox,
        }]
        last_activities = engine.process_frame(
            camera_id=camera_id,
            human_tracks=human_tracks,
            zones=[],
            timestamp_sec=t,
            db=db,
        )

    inc_after = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()
    susp_after = db.query(SuspiciousActivityModel).filter(SuspiciousActivityModel.camera_id == camera_id).count()

    assert len(last_activities) == 1
    assert last_activities[0]["activity_type"] == BEHAVIOR_UNUSUAL_STOP
    assert inc_after == inc_before + 1, "Exactly one IncidentModel must be created"
    assert susp_after == susp_before + 1, "Exactly one SuspiciousActivityModel must be created"

    # Verify event type
    inc = db.query(IncidentModel).filter(IncidentModel.incident_id == last_activities[0]["incident_id"]).first()
    assert inc is not None
    assert inc.event_type == "SUSPICIOUS_UNUSUAL_STOP"
    assert inc.threat_level == "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Test 4 — Local repeated movement >=30 seconds produces exactly ONE LOITERING
# ─────────────────────────────────────────────────────────────────────────────

def test_04_local_repeated_movement_30_seconds_produces_exactly_one_loitering(clean_engine):
    """Pacing back and forth (A -> B -> A) with net displacement <=0.12 and path >=0.10 for >=30s qualifies as LOITERING."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 4

    behavior = None
    # Oscillate between x=0.20 and x=0.25 every 2 seconds
    for step in range(35):
        t = float(step)
        offset = 0.05 if (step // 2) % 2 == 1 else 0.00
        bbox = {"x": 0.20 + offset, "y": 0.30, "width": 0.05, "height": 0.15}
        b, desc, dur = engine.evaluate_human_track(
            camera_id=camera_id,
            track_id=track_id,
            bbox=bbox,
            timestamp_sec=t,
            zones=[],
        )
        if b is not None:
            behavior = b

    assert behavior == BEHAVIOR_LOITERING, f"Expected LOITERING, got {behavior}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 5 — Prolonged loitering across many frames produces exactly ONE incident
# ─────────────────────────────────────────────────────────────────────────────

def test_05_prolonged_loitering_across_many_frames_produces_exactly_one_incident(clean_engine, db, test_camera):
    """Frame 30 qualifies -> 1 incident. Frames 31..60 -> ZERO additional incidents created."""
    engine = clean_engine
    camera_id = test_camera.camera_id
    track_id = 5

    inc_before = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()

    for step in range(60):
        t = float(step)
        offset = 0.05 if (step // 2) % 2 == 1 else 0.00
        bbox = {"x": 0.20 + offset, "y": 0.30, "width": 0.05, "height": 0.15}
        human_tracks = [{
            "track_id": track_id,
            "track_label": f"TRK#{track_id}",
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.90,
            "bounding_box": bbox,
        }]
        engine.process_frame(
            camera_id=camera_id,
            human_tracks=human_tracks,
            zones=[],
            timestamp_sec=t,
            db=db,
        )

    inc_after = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()
    assert inc_after == inc_before + 1, "Prolonged loitering across 60 frames must create exactly ONE incident"


# ─────────────────────────────────────────────────────────────────────────────
# Test 6 — Independent track states
# ─────────────────────────────────────────────────────────────────────────────

def test_06_independent_track_states(clean_engine):
    """Track A loitering and Track B walking maintain completely isolated states."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"

    for step in range(35):
        t = float(step)
        # Track 6: Loiters locally
        offset = 0.04 if (step // 2) % 2 == 1 else 0.00
        bbox6 = {"x": 0.10 + offset, "y": 0.20, "width": 0.05, "height": 0.15}
        b6, _, _ = engine.evaluate_human_track(camera_id, 6, bbox6, t, [])

        # Track 7: Walks continuously forward
        bbox7 = {"x": 0.05 + (step * 0.02), "y": 0.60, "width": 0.05, "height": 0.15}
        b7, _, _ = engine.evaluate_human_track(camera_id, 7, bbox7, t, [])

    assert b6 == BEHAVIOR_LOITERING, "Track 6 should trigger LOITERING"
    assert b7 is None, "Track 7 should produce zero events"


# ─────────────────────────────────────────────────────────────────────────────
# Test 7 — Independent camera states
# ─────────────────────────────────────────────────────────────────────────────

def test_07_independent_camera_states(clean_engine):
    """Same track_id on Camera 1 vs Camera 2 must not cross-contaminate."""
    engine = clean_engine

    for step in range(35):
        t = float(step)
        # Camera A: Motionless for 35s
        bboxA = {"x": 0.20, "y": 0.20, "width": 0.05, "height": 0.15}
        bA, _, _ = engine.evaluate_human_track("CAM-A", 10, bboxA, t, [])

        # Camera B: Walks forward
        bboxB = {"x": 0.05 + (step * 0.02), "y": 0.20, "width": 0.05, "height": 0.15}
        bB, _, _ = engine.evaluate_human_track("CAM-B", 10, bboxB, t, [])

    assert bA == BEHAVIOR_UNUSUAL_STOP, "Camera A track 10 should trigger UNUSUAL_STOP"
    assert bB is None, "Camera B track 10 should produce zero events"


# ─────────────────────────────────────────────────────────────────────────────
# Test 8 — One-frame speed spike produces zero events
# ─────────────────────────────────────────────────────────────────────────────

def test_08_one_frame_speed_spike_produces_zero_events(clean_engine):
    """A single-frame velocity spike (tracker jitter) must NOT trigger RAPID_MOVEMENT."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 8

    behavior = None
    # 5 slow samples, 1 fast jump, 5 slow samples
    for step in range(12):
        t = float(step)
        x = 0.10 if step < 6 else (0.50 if step == 6 else 0.51 + (step - 7) * 0.005)
        bbox = {"x": x, "y": 0.30, "width": 0.05, "height": 0.15}
        b, desc, dur = engine.evaluate_human_track(camera_id, track_id, bbox, t, [])
        if b is not None:
            behavior = b

    assert behavior is None, "Single frame spike must not trigger RAPID_MOVEMENT"


# ─────────────────────────────────────────────────────────────────────────────
# Test 9 — Sustained high speed >=5 consecutive samples produces ONE RAPID_MOVEMENT
# ─────────────────────────────────────────────────────────────────────────────

def test_09_sustained_high_speed_5_consecutive_samples_produces_one_rapid_movement(clean_engine):
    """Sustained high velocity (speed >= 0.35) for >=5 consecutive samples triggers RAPID_MOVEMENT."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 9

    behavior = None
    # Sample every 0.1s, jump 0.04 each step -> speed = 0.40 >= 0.35
    for step in range(7):
        t = step * 0.1
        x = 0.10 + (step * 0.04)
        bbox = {"x": x, "y": 0.30, "width": 0.05, "height": 0.15}
        b, desc, dur = engine.evaluate_human_track(camera_id, track_id, bbox, t, [])
        if b is not None:
            behavior = b

    assert behavior == BEHAVIOR_RAPID_MOVEMENT, f"Expected RAPID_MOVEMENT, got {behavior}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 10 — Restricted-zone presence >=10 seconds produces ONE event
# ─────────────────────────────────────────────────────────────────────────────

def test_10_restricted_zone_presence_10_seconds_produces_one_event(clean_engine, sample_zone):
    """Remaining inside a restricted zone for >=10 seconds triggers RESTRICTED_ZONE_BEHAVIOR."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 10
    zones = [sample_zone]

    behavior = None
    # Feet at x=0.55, y=0.55 (inside polygon [0.4, 0.4] to [0.8, 0.8])
    for step in range(12):
        t = float(step)
        bbox = {"x": 0.50, "y": 0.40, "width": 0.10, "height": 0.15}  # feet_y = 0.55
        b, desc, dur = engine.evaluate_human_track(camera_id, track_id, bbox, t, zones)
        if b is not None:
            behavior = b

    assert behavior == BEHAVIOR_RESTRICTED_ZONE, f"Expected RESTRICTED_ZONE_BEHAVIOR, got {behavior}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 11 — Virtual fence crossing does not create duplicate restricted-zone behavior
# ─────────────────────────────────────────────────────────────────────────────

def test_11_virtual_fence_crossing_does_not_create_duplicate_restricted_zone_behavior(clean_engine, sample_zone):
    """Brief crossing through a zone (< 10s) must NOT trigger RESTRICTED_ZONE_BEHAVIOR."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 11
    zones = [sample_zone]

    behavior = None
    # Inside zone at t=1, 2, 3 (< 10s), then exits at t=4
    for step in range(6):
        t = float(step)
        if step in (1, 2, 3):
            # Inside zone
            bbox = {"x": 0.50, "y": 0.40, "width": 0.10, "height": 0.15}
        else:
            # Outside zone (feet at y=0.25 < 0.40)
            bbox = {"x": 0.10, "y": 0.10, "width": 0.10, "height": 0.15}

        b, desc, dur = engine.evaluate_human_track(camera_id, track_id, bbox, t, zones)
        if b is not None:
            behavior = b

    assert behavior is None, "Brief fence crossing (<10s) must not trigger RESTRICTED_ZONE_BEHAVIOR"


# ─────────────────────────────────────────────────────────────────────────────
# Test 12 — Vehicles / VTRK produce zero suspicious events
# ─────────────────────────────────────────────────────────────────────────────

def test_12_vehicles_vtrk_produce_zero_suspicious_events(clean_engine, db, test_camera):
    """Vehicles and VTRK labels must NEVER trigger suspicious activity."""
    engine = clean_engine
    camera_id = test_camera.camera_id

    inc_before = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()

    vehicle_tracks = [
        {
            "track_id": 99,
            "track_label": "VTRK#99",
            "object_type": "vehicle",
            "fine_class": "car",
            "confidence": 0.95,
            "bounding_box": {"x": 0.30, "y": 0.30, "width": 0.20, "height": 0.15},
        },
        {
            "track_id": 100,
            "track_label": "VTRK#100",
            "object_type": "vehicle",
            "fine_class": "truck",
            "confidence": 0.88,
            "bounding_box": {"x": 0.30, "y": 0.30, "width": 0.20, "height": 0.15},
        }
    ]

    for step in range(40):
        t = float(step)
        acts = engine.process_frame(
            camera_id=camera_id,
            human_tracks=vehicle_tracks,
            zones=[],
            timestamp_sec=t,
            db=db,
        )
        assert len(acts) == 0, "Vehicles must produce zero suspicious activities"

    inc_after = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()
    assert inc_after == inc_before, "Vehicles must NEVER create IncidentModel records via suspicious engine"


# ─────────────────────────────────────────────────────────────────────────────
# Test 13 — Unknown-person detection does not automatically create suspicious activity
# ─────────────────────────────────────────────────────────────────────────────

def test_13_unknown_person_detection_does_not_automatically_create_suspicious_activity(clean_engine, db, test_camera):
    """An unknown person walking normally produces ZERO suspicious events."""
    engine = clean_engine
    camera_id = test_camera.camera_id
    track_id = 13

    acts = []
    for step in range(20):
        t = float(step)
        x = 0.05 + (step * 0.02)
        human_tracks = [{
            "track_id": track_id,
            "track_label": f"TRK#{track_id}",
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.93,
            "person_name": "UNKNOWN",
            "recognized": False,
            "bounding_box": {"x": x, "y": 0.20, "width": 0.05, "height": 0.15},
        }]
        acts = engine.process_frame(
            camera_id=camera_id,
            human_tracks=human_tracks,
            zones=[],
            timestamp_sec=t,
            db=db,
        )

    assert len(acts) == 0, "Unknown person by themselves must NOT create suspicious activity"


# ─────────────────────────────────────────────────────────────────────────────
# Test 14 — Disappeared tracks are cleaned from memory
# ─────────────────────────────────────────────────────────────────────────────

def test_14_disappeared_tracks_are_cleaned_from_memory(clean_engine):
    """Tracks not seen for >60s are purged from memory."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"

    # Add sample at t=0
    engine.evaluate_human_track(camera_id, 14, {"x": 0.1, "y": 0.1, "width": 0.05, "height": 0.15}, 0.0, [])
    assert 14 in engine._states[camera_id]

    # At t=70 (>60s), track 14 is not active
    engine.cleanup_inactive_tracks(camera_id, active_track_ids=[], timeout_sec=60.0, current_ts=70.0)
    assert 14 not in engine._states[camera_id], "Disappeared track should be cleaned up from memory"


# ─────────────────────────────────────────────────────────────────────────────
# Test 15 — Bounded history never exceeds 60 samples
# ─────────────────────────────────────────────────────────────────────────────

def test_15_bounded_history_never_exceeds_60_samples(clean_engine):
    """Track sample deque strictly caps at maxlen=60 to prevent unbounded memory growth."""
    engine = clean_engine
    camera_id = "CAM-SUSP-TEST"
    track_id = 15

    for step in range(120):
        engine.evaluate_human_track(
            camera_id,
            track_id,
            {"x": 0.2, "y": 0.2, "width": 0.05, "height": 0.15},
            float(step),
            []
        )

    state = engine.get_track_state(camera_id, track_id)
    assert len(state.samples) == 60, f"Deque size should be bounded at 60, got {len(state.samples)}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 16 — Activity duration updates without creating duplicate incidents
# ─────────────────────────────────────────────────────────────────────────────

def test_16_activity_duration_updates_without_creating_duplicate_incidents(clean_engine, db, test_camera):
    """Duration increments on ongoing loitering episodes without duplicating incidents."""
    engine = clean_engine
    camera_id = test_camera.camera_id
    track_id = 16

    inc_before = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()

    durations = []
    # Steps 0..45
    for step in range(46):
        t = float(step)
        offset = 0.05 if (step // 2) % 2 == 1 else 0.00
        bbox = {"x": 0.20 + offset, "y": 0.30, "width": 0.05, "height": 0.15}
        human_tracks = [{
            "track_id": track_id,
            "track_label": f"TRK#{track_id}",
            "object_type": "human",
            "fine_class": "person",
            "confidence": 0.90,
            "bounding_box": bbox,
        }]
        acts = engine.process_frame(
            camera_id=camera_id,
            human_tracks=human_tracks,
            zones=[],
            timestamp_sec=t,
            db=db,
        )
        if acts:
            durations.append(acts[0]["duration_sec"])

    inc_after = db.query(IncidentModel).filter(IncidentModel.camera_id == camera_id).count()

    assert inc_after == inc_before + 1, "Exactly one incident should be created across the episode"
    assert len(durations) >= 15, "Should have returned active activities for frames >=30s"
    assert durations[-1] >= durations[0], "Duration should update/grow over time"
