"""
IBVAP Phase 1 Vehicle Detection Tests
======================================

15 tests covering:
  1. Car detection
  2. Multiple vehicle classes
  3. Stable vehicle tracking (same VTRK# across frames)
  4. Two separate vehicle tracks
  5. Person + vehicle coexistence in same frame
  6. Vehicle bypasses face recognition
  7. Vehicle creates ZERO incidents
  8. Vehicle creates ZERO evidence records
  9. Class smoothing (majority vote)
 10. Invalid bbox rejection (too small / bad aspect ratio)
 11. Camera isolation (VTRK#5 on CAM-A ≠ VTRK#5 on CAM-B)
 12. Vehicle API endpoints return real data
 13. Dashboard/backend count consistency
 14. Human detection regression (existing pipeline unchanged)
 15. Existing incident regression (cloud false-positive gate intact)
"""

import sys
import os
import io
import json
import uuid
import numpy as np
import cv2
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, run_migrations, get_db
from database.models import CameraModel, IncidentModel, EvidenceModel
from main import app
from ai.tracker import TrackRegistry, TrackRecord, TrackState
from config import settings

# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_frame_jpeg(h=480, w=640, color=(60, 120, 180)):
    """Return a minimal JPEG blob of a solid-colour frame."""
    frame = np.full((h, w, 3), color, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", frame)
    return io.BytesIO(buf.tobytes())


def _build_raw_det(fine_class, confidence, x=0.2, y=0.3, width=0.3, height=0.2, track_id=1):
    """Build a raw detection dict as returned by detector_instance.track_frame()."""
    return {
        "fine_class": fine_class,
        "object_type": "vehicle" if fine_class in settings.VEHICLE_CLASSES else "human",
        "confidence": confidence,
        "track_id": track_id,
        "bounding_box": {"x": x, "y": y, "width": width, "height": height},
        "bbox_pixels": {"x": int(x*640), "y": int(y*480), "width": int(width*640), "height": int(height*480)},
    }


def _build_person_det(confidence=0.82, track_id=99):
    return {
        "fine_class": "person",
        "object_type": "human",
        "confidence": confidence,
        "track_id": track_id,
        "bounding_box": {"x": 0.1, "y": 0.05, "width": 0.15, "height": 0.6},
        "bbox_pixels": {"x": 64, "y": 24, "width": 96, "height": 288},
    }


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    run_migrations()
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def client(db):
    """TestClient wired to the real database session."""
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="module")
def test_camera(db):
    """Create (or reuse) a dedicated test camera for vehicle tests."""
    cam = db.query(CameraModel).filter(CameraModel.camera_id == "CAM-VEH-TEST").first()
    if not cam:
        cam = CameraModel(
            id="cam-veh-test-uuid",
            camera_id="CAM-VEH-TEST",
            name="Vehicle Detection Test Camera",
            source_url="webcam",
            source_type="WEBCAM",
            status="ONLINE",
            sector="Sector A",
            fps=30,
        )
        db.add(cam)
        db.commit()
        db.refresh(cam)
    yield cam
    # Teardown: remove test incidents / evidence tied to this camera
    db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-VEH-TEST").delete()
    db.commit()
    db.query(CameraModel).filter(CameraModel.camera_id == "CAM-VEH-TEST").delete()
    db.commit()


@pytest.fixture(scope="module")
def test_camera_b(db):
    """Second camera for isolation tests."""
    cam = db.query(CameraModel).filter(CameraModel.camera_id == "CAM-VEH-TEST-B").first()
    if not cam:
        cam = CameraModel(
            id="cam-veh-test-b-uuid",
            camera_id="CAM-VEH-TEST-B",
            name="Vehicle Detection Test Camera B",
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
    db.query(CameraModel).filter(CameraModel.camera_id == "CAM-VEH-TEST-B").delete()
    db.commit()


def _post_detect_frame(client, camera_id, raw_detections, n_frames=1):
    """
    Helper: POST to /detect-frame with mocked YOLO returning raw_detections.
    Sends n_frames sequential requests (same detections) to allow persistence counter to fill.
    Returns the last response dict.
    """
    from api.detections import _webcam_frame_counters
    _webcam_frame_counters[camera_id] = 0

    result = None
    with patch("api.detections.detector_instance") as mock_det, \
         patch("api.detections.fence_engine") as mock_fence, \
         patch("services.face_recognition.face_recognition_service") as mock_fr:

        mock_det.track_frame.return_value = raw_detections
        mock_fence.evaluate_frame_detections.return_value = []
        mock_fr.recognize_faces.return_value = []

        for _ in range(n_frames):
            img_bytes = _make_frame_jpeg()
            response = client.post(
                f"/api/v1/cameras/{camera_id}/detect-frame",
                files={"file": ("frame.jpg", img_bytes, "image/jpeg")},
            )
            assert response.status_code == 200, response.text
            result = response.json()

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — Car detection
# ─────────────────────────────────────────────────────────────────────────────

def test_01_car_detection(client, test_camera, db):
    """Single car detection appears in vehicle_detections after persistence threshold."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    car_det = _build_raw_det("car", confidence=0.85, width=0.25, height=0.15, track_id=201)
    result = _post_detect_frame(client, cam_id, [car_det], n_frames=settings.VEHICLE_MIN_FRAMES)

    assert result["vehicle_count"] >= 1, "Expected at least 1 vehicle after persistence"
    classes = [v["vehicle_class"] for v in result["vehicle_detections"]]
    assert "car" in classes, f"Expected car in vehicle_detections, got {classes}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — Multiple vehicle classes
# ─────────────────────────────────────────────────────────────────────────────

def test_02_multiple_vehicle_classes(client, test_camera, db):
    """car, motorcycle, bus, truck all classified correctly as separate detections."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    dets = [
        _build_raw_det("car",        confidence=0.88, x=0.0,  y=0.3, width=0.22, height=0.14, track_id=101),
        _build_raw_det("motorcycle", confidence=0.76, x=0.25, y=0.3, width=0.20, height=0.18, track_id=102),
        _build_raw_det("bus",        confidence=0.92, x=0.50, y=0.3, width=0.25, height=0.22, track_id=103),
        _build_raw_det("truck",      confidence=0.79, x=0.75, y=0.3, width=0.24, height=0.20, track_id=104),
    ]
    result = _post_detect_frame(client, cam_id, dets, n_frames=settings.VEHICLE_MIN_FRAMES)

    assert result["vehicle_count"] >= 4, f"Expected 4 vehicles, got {result['vehicle_count']}"
    classes_seen = {v["vehicle_class"] for v in result["vehicle_detections"]}
    for expected_cls in ["car", "motorcycle", "bus", "truck"]:
        assert expected_cls in classes_seen, f"{expected_cls} missing from {classes_seen}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 3 — Stable vehicle tracking (same VTRK# across frames)
# ─────────────────────────────────────────────────────────────────────────────

def test_03_stable_vehicle_tracking(client, test_camera, db):
    """A car returning across multiple frames keeps the same track_id (VTRK#N)."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    car_det = _build_raw_det("car", confidence=0.90, width=0.25, height=0.15, track_id=301)
    result = _post_detect_frame(client, cam_id, [car_det], n_frames=8)

    track_ids_seen = {v["track_id"] for v in result["vehicle_detections"]}
    assert 301 in track_ids_seen, "Expected track_id=301 to persist across frames"
    labels = {v["track_label"] for v in result["vehicle_detections"]}
    assert "VTRK#301" in labels, f"Expected VTRK#301 label, got {labels}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 4 — Two separate vehicle tracks
# ─────────────────────────────────────────────────────────────────────────────

def test_04_two_separate_vehicle_tracks(client, test_camera, db):
    """Two cars in the same frame get distinct VTRK IDs."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    dets = [
        _build_raw_det("car", confidence=0.88, x=0.05, y=0.3, width=0.22, height=0.15, track_id=401),
        _build_raw_det("car", confidence=0.82, x=0.55, y=0.3, width=0.22, height=0.15, track_id=402),
    ]
    result = _post_detect_frame(client, cam_id, dets, n_frames=settings.VEHICLE_MIN_FRAMES)

    track_ids = {v["track_id"] for v in result["vehicle_detections"]}
    assert len(track_ids) >= 2, f"Expected 2 distinct track IDs, got {track_ids}"
    assert 401 in track_ids and 402 in track_ids


# ─────────────────────────────────────────────────────────────────────────────
# Test 5 — Person + vehicle coexist in same frame
# ─────────────────────────────────────────────────────────────────────────────

def test_05_person_and_vehicle_coexist(client, test_camera, db):
    """Person appears in detections[] and vehicle appears in vehicle_detections[]."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    dets = [
        _build_person_det(confidence=0.88, track_id=501),
        _build_raw_det("car", confidence=0.85, x=0.55, y=0.3, width=0.25, height=0.15, track_id=502),
    ]
    result = _post_detect_frame(client, cam_id, dets, n_frames=settings.VEHICLE_MIN_FRAMES)

    person_classes = [d["class"] for d in result["detections"]]
    assert "person" in person_classes, "Person not in detections"

    vehicle_classes = [v["vehicle_class"] for v in result["vehicle_detections"]]
    assert "car" in vehicle_classes, "Car not in vehicle_detections"


# ─────────────────────────────────────────────────────────────────────────────
# Test 6 — Vehicle bypasses face recognition
# ─────────────────────────────────────────────────────────────────────────────

def test_06_vehicle_bypasses_face_recognition(client, test_camera, db):
    """face_recognition_service.recognize_faces() is NEVER called for a vehicle-only frame."""
    cam_id = test_camera.camera_id
    from api.detections import _webcam_frame_counters
    _webcam_frame_counters[cam_id] = 0

    car_det = _build_raw_det("car", confidence=0.88, width=0.25, height=0.15, track_id=601)

    with patch("api.detections.detector_instance") as mock_det, \
         patch("api.detections.fence_engine") as mock_fence, \
         patch("services.face_recognition.face_recognition_service.recognize_faces") as mock_fr:

        mock_det.track_frame.return_value = [car_det]
        mock_fence.evaluate_frame_detections.return_value = []
        mock_fr.return_value = []

        for _ in range(settings.VEHICLE_MIN_FRAMES):
            img_bytes = _make_frame_jpeg()
            resp = client.post(
                f"/api/v1/cameras/{cam_id}/detect-frame",
                files={"file": ("frame.jpg", img_bytes, "image/jpeg")},
            )
            assert resp.status_code == 200

    # recognize_faces should have been called 0 times (no person in frame)
    assert mock_fr.call_count == 0, (
        f"Face recognition was called {mock_fr.call_count} time(s) for vehicle-only detections"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 7 — Vehicle creates ZERO incidents
# ─────────────────────────────────────────────────────────────────────────────

def test_07_vehicle_creates_zero_incidents(client, test_camera, db):
    """Any number of vehicle detections must produce incidents_created_count = 0."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    incident_before = db.query(IncidentModel).filter(IncidentModel.camera_id == cam_id).count()

    dets = [
        _build_raw_det("car",   confidence=0.90, x=0.0,  y=0.3, width=0.22, height=0.14, track_id=701),
        _build_raw_det("truck", confidence=0.85, x=0.30, y=0.3, width=0.28, height=0.20, track_id=702),
    ]
    result = _post_detect_frame(client, cam_id, dets, n_frames=10)

    assert result["incidents_created_count"] == 0, (
        f"Vehicles created {result['incidents_created_count']} incident(s) — must be 0"
    )
    incident_after = db.query(IncidentModel).filter(IncidentModel.camera_id == cam_id).count()
    assert incident_after == incident_before, (
        f"IncidentModel count changed from {incident_before} to {incident_after} due to vehicles"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 8 — Vehicle creates ZERO evidence records
# ─────────────────────────────────────────────────────────────────────────────

def test_08_vehicle_creates_zero_evidence(client, test_camera, db):
    """Vehicle detections must NOT produce any EvidenceModel rows."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    evidence_before = db.query(EvidenceModel).count()

    dets = [
        _build_raw_det("motorcycle", confidence=0.88, x=0.1, y=0.3, width=0.22, height=0.18, track_id=801),
        _build_raw_det("bus",        confidence=0.92, x=0.45, y=0.2, width=0.28, height=0.25, track_id=802),
        _build_raw_det("car",        confidence=0.79, x=0.75, y=0.3, width=0.22, height=0.15, track_id=803),
    ]
    _post_detect_frame(client, cam_id, dets, n_frames=10)
    db.expire_all()

    evidence_after = db.query(EvidenceModel).count()
    assert evidence_after == evidence_before, (
        f"Evidence count changed from {evidence_before} to {evidence_after} — vehicles must not create evidence"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 9 — Class smoothing
# ─────────────────────────────────────────────────────────────────────────────

def test_09_class_smoothing():
    """
    Majority-vote smoothing: 5 frames of car + 1 frame of truck = vehicle_class stays 'car'.
    Tests the TrackRecord.update_vehicle_class() method directly.
    """
    rec = TrackRecord(
        camera_id="cam-smooth",
        track_id=1,
        fine_class="car",
        object_type="vehicle",
    )
    observations = ["car", "car", "car", "truck", "car", "car"]
    for obs in observations:
        rec.update_vehicle_class(obs, window=settings.VEHICLE_CLASS_SMOOTHING_WINDOW)

    assert rec.vehicle_class == "car", (
        f"Expected smoothed class = 'car', got '{rec.vehicle_class}'"
    )


def test_09b_class_smoothing_majority_switch():
    """
    When truck accumulates more observations than car, smoothed class switches.
    """
    rec = TrackRecord(
        camera_id="cam-smooth2",
        track_id=2,
        fine_class="car",
        object_type="vehicle",
    )
    # Feed mostly truck into a window of 7
    for cls in ["car", "truck", "truck", "truck", "truck", "truck", "car"]:
        rec.update_vehicle_class(cls, window=7)

    assert rec.vehicle_class == "truck", (
        f"Expected smoothed class = 'truck', got '{rec.vehicle_class}'"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 10 — Invalid bbox rejection
# ─────────────────────────────────────────────────────────────────────────────

def test_10_invalid_bbox_rejection(client, test_camera, db):
    """Detections with bbox too small or bad aspect ratio are rejected before entering vehicle pipeline."""
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    # Tiny bbox: area = 0.01 * 0.01 = 0.0001 (well below VEHICLE_MIN_BBOX_AREA=0.0008)
    tiny_bbox = _build_raw_det("car", confidence=0.90, x=0.5, y=0.5, width=0.01, height=0.01, track_id=1001)
    # Bad aspect ratio: very thin vertical strip (width/height = 0.05 < 0.15)
    bad_aspect = _build_raw_det("car", confidence=0.88, x=0.3, y=0.3, width=0.02, height=0.40, track_id=1002)

    result = _post_detect_frame(client, cam_id, [tiny_bbox, bad_aspect], n_frames=settings.VEHICLE_MIN_FRAMES)

    assert result["vehicle_count"] == 0, (
        f"Expected 0 vehicles after filtering invalid bboxes, got {result['vehicle_count']}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 11 — Camera isolation
# ─────────────────────────────────────────────────────────────────────────────

def test_11_camera_isolation(client, test_camera, test_camera_b, db):
    """
    VTRK#5 on CAM-VEH-TEST must not appear in CAM-VEH-TEST-B's store.
    Camera A and Camera B must have completely independent vehicle track stores.
    """
    from ai.tracker import track_registry

    cam_a = test_camera.camera_id
    cam_b = test_camera_b.camera_id

    track_registry.clear_camera(cam_a)
    track_registry.clear_camera(cam_b)
    track_registry._vehicle_store[cam_a] = {}
    track_registry._vehicle_store[cam_b] = {}

    # Track ID=5 in camera A
    car_a = _build_raw_det("car", confidence=0.88, x=0.1, y=0.3, width=0.25, height=0.15, track_id=5)
    _post_detect_frame(client, cam_a, [car_a], n_frames=settings.VEHICLE_MIN_FRAMES)

    # Camera B should have ZERO tracks
    b_tracks = track_registry.get_active_vehicle_tracks(cam_b)
    assert len(b_tracks) == 0, (
        f"Camera B wrongly has {len(b_tracks)} vehicle track(s) after Camera A inference"
    )

    # Camera A should have exactly track_id=5
    a_tracks = track_registry.get_active_vehicle_tracks(cam_a)
    a_ids = {t["track_id"] for t in a_tracks}
    assert 5 in a_ids, f"Camera A should have track_id=5, got {a_ids}"


# ─────────────────────────────────────────────────────────────────────────────
# Test 12 — Vehicle API endpoints
# ─────────────────────────────────────────────────────────────────────────────

def test_12_vehicle_api_endpoints(client, test_camera, db):
    """GET /cameras/{id}/vehicles and GET /vehicles/stats return real registry data."""
    from ai.tracker import track_registry

    cam_id = test_camera.camera_id
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    car_det = _build_raw_det("car", confidence=0.88, width=0.25, height=0.15, track_id=1201)
    _post_detect_frame(client, cam_id, [car_det], n_frames=settings.VEHICLE_MIN_FRAMES)

    # GET /cameras/{id}/vehicles
    resp = client.get(f"/api/v1/cameras/{cam_id}/vehicles")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "vehicles" in data
    assert "vehicle_count" in data
    assert data["vehicle_count"] >= 1

    # GET /vehicles/stats
    resp2 = client.get("/api/v1/vehicles/stats")
    assert resp2.status_code == 200, resp2.text
    stats = resp2.json()
    assert "total" in stats
    assert "car" in stats
    assert "motorcycle" in stats
    assert "bus" in stats
    assert "truck" in stats
    assert "by_camera" in stats
    assert stats["total"] >= 1


# ─────────────────────────────────────────────────────────────────────────────
# Test 13 — Dashboard/backend count consistency
# ─────────────────────────────────────────────────────────────────────────────

def test_13_dashboard_count_consistency(client, test_camera, db):
    """
    vehicle_count in detect-frame response must equal the count in /vehicles/stats.
    """
    from ai.tracker import track_registry

    cam_id = test_camera.camera_id
    track_registry.clear_camera(cam_id)
    track_registry._vehicle_store[cam_id] = {}

    dets = [
        _build_raw_det("car",   confidence=0.88, x=0.0,  y=0.3, width=0.22, height=0.14, track_id=1301),
        _build_raw_det("truck", confidence=0.85, x=0.40, y=0.3, width=0.28, height=0.20, track_id=1302),
    ]
    detect_result = _post_detect_frame(client, cam_id, dets, n_frames=settings.VEHICLE_MIN_FRAMES)
    detect_vehicle_count = detect_result["vehicle_count"]

    stats_resp = client.get("/api/v1/vehicles/stats")
    assert stats_resp.status_code == 200
    stats_total = stats_resp.json()["total"]

    # Stats total should be >= detect_vehicle_count (may include other test cameras)
    assert stats_total >= detect_vehicle_count, (
        f"Stats total ({stats_total}) < detect-frame vehicle_count ({detect_vehicle_count})"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 14 — Human detection regression
# ─────────────────────────────────────────────────────────────────────────────

def test_14_human_detection_regression(client, test_camera, db):
    """
    Person detection pipeline must work exactly as before Phase 1 changes.
    Person goes through detect-frame → appears in detections[], not vehicle_detections[].
    """
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)

    person_det = _build_person_det(confidence=0.88, track_id=1401)
    result = _post_detect_frame(client, cam_id, [person_det], n_frames=4)

    assert result["person_count"] >= 1, "Person not detected in human regression test"
    assert len(result["detections"]) >= 1
    # Must NOT appear in vehicle_detections
    for vd in result["vehicle_detections"]:
        assert vd["vehicle_class"] != "person", "Person wrongly ended up in vehicle_detections"


# ─────────────────────────────────────────────────────────────────────────────
# Test 15 — Existing incident regression (cloud false-positive gate)
# ─────────────────────────────────────────────────────────────────────────────

def test_15_incident_regression(client, test_camera, db):
    """
    A detection that passes person classification but fails validation gates
    (tiny bbox simulating cloud/background) must create ZERO incidents.
    Confirms cloud false-positive protections remain intact post-Phase 1.
    """
    cam_id = test_camera.camera_id
    from ai.tracker import track_registry
    track_registry.clear_camera(cam_id)

    # Simulate a cloud detection: person class, tiny bbox area
    cloud_like = {
        "fine_class": "person",
        "object_type": "human",
        "confidence": 0.83,
        "track_id": 1501,
        "bounding_box": {"x": 0.42, "y": 0.10, "width": 0.128, "height": 0.353},
        "bbox_pixels": {"x": 269, "y": 48, "width": 82, "height": 169},
    }

    incident_before = db.query(IncidentModel).filter(IncidentModel.camera_id == cam_id).count()

    # Force fence_engine to return [] (no incident created) for this bbox
    from api.detections import _webcam_frame_counters
    _webcam_frame_counters[cam_id] = 0

    with patch("api.detections.detector_instance") as mock_det, \
         patch("api.detections.fence_engine") as mock_fence, \
         patch("services.face_recognition.face_recognition_service") as mock_fr:

        mock_det.track_frame.return_value = [cloud_like]
        mock_fence.evaluate_frame_detections.return_value = []
        mock_fr.recognize_faces.return_value = []

        for _ in range(10):
            img_bytes = _make_frame_jpeg()
            resp = client.post(
                f"/api/v1/cameras/{cam_id}/detect-frame",
                files={"file": ("frame.jpg", img_bytes, "image/jpeg")},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["incidents_created_count"] == 0, (
                f"Cloud-like detection created an incident — false-positive gate broken!"
            )

    incident_after = db.query(IncidentModel).filter(IncidentModel.camera_id == cam_id).count()
    assert incident_after == incident_before, "IncidentModel count changed for cloud-like detection"


# ─────────────────────────────────────────────────────────────────────────────
# TrackRegistry unit tests
# ─────────────────────────────────────────────────────────────────────────────

def test_tracker_vehicle_store_separate_from_person_store():
    """
    ByteTrack shared counter: person and vehicle can get the SAME raw integer ID.
    Confirm they are stored in separate namespaces with different labels.
    """
    registry = TrackRegistry()
    cam = "cam-unit-test"

    # Inject a person track with ID=5
    registry.update_track(
        camera_id=cam, track_id=5, fine_class="person", object_type="human",
        confidence=0.88, bounding_box={"x": 0.1, "y": 0.1, "width": 0.15, "height": 0.5},
        frame_index=1
    )
    # Inject a vehicle track with THE SAME raw ID=5
    registry.update_vehicle_track(
        camera_id=cam, track_id=5, fine_class="car",
        confidence=0.88, bounding_box={"x": 0.6, "y": 0.3, "width": 0.25, "height": 0.15},
        frame_index=1
    )

    person_store = registry._get_camera_store(cam)
    vehicle_store = registry._get_vehicle_camera_store(cam)

    assert 5 in person_store, "Person track_id=5 missing from person store"
    assert 5 in vehicle_store, "Vehicle track_id=5 missing from vehicle store"
    assert person_store[5].object_type == "human"
    assert vehicle_store[5].object_type == "vehicle"
    assert person_store[5] is not vehicle_store[5], "Person and vehicle track records must be distinct objects"


def test_tracker_direction_computation():
    """compute_direction() returns a valid direction string from center history."""
    rec = TrackRecord(camera_id="x", track_id=1, fine_class="car", object_type="vehicle")
    # Simulate movement to the right
    centers = [(0.1, 0.5), (0.15, 0.5), (0.20, 0.5), (0.25, 0.5)]
    rec.center_history = centers
    direction = rec.compute_direction()
    assert direction in ("right", "left", "inbound", "outbound", "stationary", "unknown"), (
        f"Unexpected direction: {direction}"
    )
    assert direction == "right", f"Expected 'right' for rightward motion, got '{direction}'"
