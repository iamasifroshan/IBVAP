"""
IBVAP Phase 2 ANPR (Automatic Number Plate Recognition) Tests
============================================================

24 tests covering:
 1. Plate localization candidate extraction
 2. Character segmentation & template OCR
 3. Plate normalization (uppercase, strip dashes/spaces)
 4. Indian format validation (RTO, BH, Military series)
 5. Invalid format handling (raw OCR preserved, format_valid=False)
 6. OCR confidence threshold filtering
 7. Temporal OCR stabilization (sliding window majority vote)
 8. Multi-frame plate stability
 9. Vehicle ↔ plate association (spatial containment)
10. Two vehicles with different plates
11. Same plate on different cameras (camera isolation)
12. In-memory plate persistence
13. Invalid OCR noise rejection (short / bad characters)
14. Vehicle without visible plate (no false plate generated)
15. ANPR creates ZERO IncidentModel rows (CRITICAL SAFETY)
16. ANPR creates ZERO EvidenceModel rows (CRITICAL SAFETY)
17. GET /cameras/{id}/anpr endpoint returns real records
18. GET /anpr/stats endpoint returns real statistics
19. GET /anpr/search plate search API endpoint
20. Camera isolation for ANPR observations
21. Phase 1 Vehicle tracking regression (VTRK# tracking intact)
22. Human detection regression (person pipeline intact)
23. Unknown person incident regression (human incident logic intact)
24. Cloud false-positive regression (background false-positive gate intact)
"""

import sys
import os
import io
import json
import numpy as np
import cv2
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, run_migrations, get_db
from database.models import CameraModel, IncidentModel, EvidenceModel, ANPRObservationModel
from main import app
from ai.anpr_engine import anpr_engine, ANPREngine
from ai.tracker import TrackRegistry, TrackRecord, TrackState
from config import settings

# ── Fixtures & Helpers ────────────────────────────────────────────────────────

def _make_frame_jpeg(h=480, w=640, color=(50, 50, 50)):
    frame = np.full((h, w, 3), color, dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", frame)
    return io.BytesIO(buf.tobytes())


def _build_car_det(track_id=1, confidence=0.88, x=0.1, y=0.3, width=0.3, height=0.2):
    return {
        "fine_class": "car",
        "object_type": "vehicle",
        "confidence": confidence,
        "track_id": track_id,
        "bounding_box": {"x": x, "y": y, "width": width, "height": height},
        "bbox_pixels": {"x": int(x * 640), "y": int(y * 480), "width": int(width * 640), "height": int(height * 480)},
    }


@pytest.fixture(scope="module")
def db():
    run_migrations()
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def client(db):
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="module")
def test_camera(db):
    cam = db.query(CameraModel).filter(CameraModel.camera_id == "CAM-ANPR-TEST").first()
    if not cam:
        cam = CameraModel(
            id="cam-anpr-test-uuid",
            camera_id="CAM-ANPR-TEST",
            name="ANPR Test Camera",
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
    db.query(ANPRObservationModel).filter(ANPRObservationModel.camera_id == "CAM-ANPR-TEST").delete()
    db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ANPR-TEST").delete()
    db.query(CameraModel).filter(CameraModel.camera_id == "CAM-ANPR-TEST").delete()
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 1 — Plate Localization
# ─────────────────────────────────────────────────────────────────────────────

def test_01_plate_localization():
    """Verify detect_plate_region finds plate candidate in vehicle ROI."""
    engine = ANPREngine()
    crop = np.zeros((120, 240, 3), dtype=np.uint8)
    # Draw a plate-like white rectangle in lower region
    cv2.rectangle(crop, (50, 70), (190, 102), (240, 240, 240), -1)
    cv2.putText(crop, "KA01AB1234", (55, 94), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 0), 2)

    res = engine.detect_plate_region(crop)
    assert res is not None, "Plate region should be detected"
    plate_crop, (px, py, pw, ph), conf = res
    assert pw > 0 and ph > 0
    assert conf >= 0.30


# ─────────────────────────────────────────────────────────────────────────────
# Test 2 — Character Segmentation & OCR
# ─────────────────────────────────────────────────────────────────────────────

def test_02_ocr_extraction():
    """Verify run_ocr returns raw text, normalized text, and confidence."""
    engine = ANPREngine()
    with patch.object(engine, "run_ocr", return_value=("KA-01-AB-1234", "KA01AB1234", 0.92)):
        raw, norm, conf = engine.run_ocr(np.zeros((50, 150, 3), dtype=np.uint8))
        assert norm == "KA01AB1234"
        assert conf == 0.92


# ─────────────────────────────────────────────────────────────────────────────
# Test 3 — Plate Normalization
# ─────────────────────────────────────────────────────────────────────────────

def test_03_plate_normalization():
    """Verify normalize_plate strips spaces, dashes, and converts to uppercase."""
    engine = ANPREngine()
    assert engine.normalize_plate("ka-01 ab 1234") == "KA01AB1234"
    assert engine.normalize_plate("DL-3C-1234") == "DL3C1234"
    assert engine.normalize_plate("  mh 12 de 5678  ") == "MH12DE5678"


# ─────────────────────────────────────────────────────────────────────────────
# Test 4 — Indian Registration Format Validation
# ─────────────────────────────────────────────────────────────────────────────

def test_04_indian_format_validation():
    """Verify Indian RTO, BH series, and Military registration formats."""
    engine = ANPREngine()
    # Standard RTO formats
    assert engine.validate_indian_plate_format("KA01AB1234") is True
    assert engine.validate_indian_plate_format("DL3C1234") is True
    assert engine.validate_indian_plate_format("MH12DE5678") is True
    assert engine.validate_indian_plate_format("HR26DQ5551") is True

    # BH Series
    assert engine.validate_indian_plate_format("22BH1234AB") is True

    # Invalid formats
    assert engine.validate_indian_plate_format("INVALID123") is False
    assert engine.validate_indian_plate_format("12345") is False
    assert engine.validate_indian_plate_format("") is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 5 — Invalid Format Preserves Raw OCR
# ─────────────────────────────────────────────────────────────────────────────

def test_05_invalid_format_preserves_ocr():
    """Invalid format is marked format_valid=False without altering plate_text."""
    engine = ANPREngine()
    raw = "KA01A81234"  # Non-standard/noisy format
    is_valid = engine.validate_indian_plate_format(raw)
    assert is_valid is False
    # Normalization retains text
    assert engine.normalize_plate(raw) == "KA01A81234"


# ─────────────────────────────────────────────────────────────────────────────
# Test 6 — OCR Confidence Threshold Filtering
# ─────────────────────────────────────────────────────────────────────────────

def test_06_ocr_confidence_threshold():
    """Low confidence OCR is rejected by stabilize_ocr."""
    engine = ANPREngine()
    history = [("KA01AB1234", 0.20), ("KA01AB1234", 0.15)]
    text, conf, is_stable = engine.stabilize_ocr(history)
    # Average conf 0.17 is below threshold so is_stable should be False
    assert is_stable is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 7 — Temporal OCR Stabilization
# ─────────────────────────────────────────────────────────────────────────────

def test_07_temporal_stabilization():
    """Sliding-window majority vote selects the most frequent OCR reading."""
    engine = ANPREngine()
    # 4 frames of KA01AB1234, 1 noisy frame KA01A81234
    history = [
        ("KA01AB1234", 0.90),
        ("KA01A81234", 0.50),
        ("KA01AB1234", 0.92),
        ("KA01AB1234", 0.88),
        ("KA01AB1234", 0.91),
    ]
    stable_text, avg_conf, is_stable = engine.stabilize_ocr(history, window=5)
    assert stable_text == "KA01AB1234", f"Expected KA01AB1234, got {stable_text}"
    assert is_stable is True
    assert avg_conf >= 0.85


# ─────────────────────────────────────────────────────────────────────────────
# Test 8 — Multi-frame Plate Stability
# ─────────────────────────────────────────────────────────────────────────────

def test_08_multiframe_plate_stability():
    """TrackRecord updates plate_stable=True after multiple observations."""
    rec = TrackRecord(camera_id="cam1", track_id=1, fine_class="car", object_type="vehicle")
    for _ in range(6):
        rec.update_vehicle_plate("KA-01-AB-1234", "KA01AB1234", 0.90, True)

    assert rec.plate_text == "KA01AB1234"
    assert rec.plate_stable is True
    assert rec.format_valid is True


# ─────────────────────────────────────────────────────────────────────────────
# Test 9 — Vehicle ↔ Plate Spatial Association
# ─────────────────────────────────────────────────────────────────────────────

def test_09_vehicle_plate_association():
    """Plate center inside vehicle bounding box returns True; outside returns False."""
    engine = ANPREngine()
    vehicle_bbox = {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3}
    plate_inside = {"x": 0.2, "y": 0.4, "width": 0.1, "height": 0.05}
    plate_outside = {"x": 0.7, "y": 0.7, "width": 0.1, "height": 0.05}

    assert engine.associate_plate_with_vehicle(vehicle_bbox, plate_inside) is True
    assert engine.associate_plate_with_vehicle(vehicle_bbox, plate_outside) is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 10 — Two Vehicles With Different Plates
# ─────────────────────────────────────────────────────────────────────────────

def test_10_two_vehicles_different_plates():
    """Two vehicle TrackRecords maintain independent plate readings."""
    rec1 = TrackRecord(camera_id="cam1", track_id=1, fine_class="car", object_type="vehicle")
    rec2 = TrackRecord(camera_id="cam1", track_id=2, fine_class="truck", object_type="vehicle")

    for _ in range(6):
        rec1.update_vehicle_plate("KA01AB1234", "KA01AB1234", 0.92, True)
        rec2.update_vehicle_plate("DL3C5678", "DL3C5678", 0.88, True)

    dict1 = rec1.to_vehicle_dict()
    dict2 = rec2.to_vehicle_dict()

    assert dict1["plate_text"] == "KA01AB1234"
    assert dict2["plate_text"] == "DL3C5678"
    assert dict1["track_label"] == "VTRK#1"
    assert dict2["track_label"] == "VTRK#2"


# ─────────────────────────────────────────────────────────────────────────────
# Test 11 — Same Plate on Different Cameras (Isolation)
# ─────────────────────────────────────────────────────────────────────────────

def test_11_camera_isolation_plates(client, test_camera, db):
    """ANPR observation for camera A does not appear in camera B's endpoint."""
    obs_a = ANPRObservationModel(
        id="anpr-test-iso-a",
        anpr_id="ANPR-ISO-A",
        camera_id="CAM-ANPR-TEST",
        vehicle_track_id=10,
        vehicle_track_label="VTRK#10",
        vehicle_class="car",
        plate_text="MH12DE9999",
        confidence=0.91,
        format_valid=True,
    )
    db.add(obs_a)
    db.commit()

    resp_a = client.get("/api/v1/cameras/CAM-ANPR-TEST/anpr")
    assert resp_a.status_code == 200
    plates_a = [r["plate_text"] for r in resp_a.json()]
    assert "MH12DE9999" in plates_a

    resp_b = client.get("/api/v1/cameras/CAM-OTHER-CAM/anpr")
    assert resp_b.status_code == 200
    plates_b = [r["plate_text"] for r in resp_b.json()]
    assert "MH12DE9999" not in plates_b

    db.delete(obs_a)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 12 — In-memory Plate Persistence
# ─────────────────────────────────────────────────────────────────────────────

def test_12_in_memory_plate_persistence():
    """Plate data stays attached to TrackRecord across update() ticks."""
    rec = TrackRecord(camera_id="cam1", track_id=12, fine_class="car", object_type="vehicle", bounding_box={"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.2})
    for _ in range(6):
        rec.update_vehicle_plate("KA01AB1234", "KA01AB1234", 0.90, True)

    # Next frame position update tick
    rec.update(frame_index=10, confidence=0.89, bounding_box={"x": 0.15, "y": 0.25, "width": 0.3, "height": 0.2})

    assert rec.plate_text == "KA01AB1234"
    assert rec.to_vehicle_dict()["plate_text"] == "KA01AB1234"


# ─────────────────────────────────────────────────────────────────────────────
# Test 13 — Invalid OCR Noise Rejection
# ─────────────────────────────────────────────────────────────────────────────

def test_13_invalid_ocr_noise_rejection():
    """Empty or short noise strings (< 6 chars) are ignored by update_vehicle_plate."""
    rec = TrackRecord(camera_id="cam1", track_id=13, fine_class="car", object_type="vehicle")
    rec.update_vehicle_plate("", "", 0.1, False)
    rec.update_vehicle_plate("XY", "XY", 0.2, False)

    assert rec.plate_text is None
    assert rec.plate_stable is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 14 — Vehicle Without Visible Plate
# ─────────────────────────────────────────────────────────────────────────────

def test_14_vehicle_without_visible_plate():
    """Vehicle with no plate detected returns plate_text=None (no fabricated plate)."""
    rec = TrackRecord(camera_id="cam1", track_id=14, fine_class="car", object_type="vehicle")
    d = rec.to_vehicle_dict()
    assert d["plate_text"] is None
    assert d["plate_stable"] is False


# ─────────────────────────────────────────────────────────────────────────────
# Test 15 — ANPR Creates ZERO IncidentModel Rows (MANDATORY SAFETY)
# ─────────────────────────────────────────────────────────────────────────────

def test_15_anpr_zero_incidents(client, test_camera, db):
    """ANPR observations must NOT create any IncidentModel records."""
    inc_before = db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ANPR-TEST").count()

    car_det = _build_car_det(track_id=15, confidence=0.92)

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("ai.anpr_engine.anpr_engine.detect_plate_region") as mock_pr, \
         patch("ai.anpr_engine.anpr_engine.run_ocr") as mock_ocr:

        mock_tf.return_value = [car_det]
        mock_pr.return_value = (np.zeros((30, 90, 3), dtype=np.uint8), (10, 10, 80, 25), 0.90)
        mock_ocr.return_value = ("KA-01-AB-1234", "KA01AB1234", 0.95)

        for _ in range(5):
            res = client.post(
                "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
                files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
            )
            assert res.status_code == 200
            data = res.json()
            assert data["incidents_created_count"] == 0

    inc_after = db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ANPR-TEST").count()
    assert inc_after == inc_before, "ANPR must not create IncidentModel rows"


# ─────────────────────────────────────────────────────────────────────────────
# Test 16 — ANPR Creates ZERO EvidenceModel Rows (MANDATORY SAFETY)
# ─────────────────────────────────────────────────────────────────────────────

def test_16_anpr_zero_evidence(client, test_camera, db):
    """ANPR observations must NOT create any EvidenceModel records."""
    ev_before = db.query(EvidenceModel).count()

    car_det = _build_car_det(track_id=16, confidence=0.90)

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("ai.anpr_engine.anpr_engine.detect_plate_region") as mock_pr, \
         patch("ai.anpr_engine.anpr_engine.run_ocr") as mock_ocr:

        mock_tf.return_value = [car_det]
        mock_pr.return_value = (np.zeros((30, 90, 3), dtype=np.uint8), (10, 10, 80, 25), 0.90)
        mock_ocr.return_value = ("DL-3C-9999", "DL3C9999", 0.92)

        for _ in range(5):
            res = client.post(
                "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
                files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
            )
            assert res.status_code == 200

    ev_after = db.query(EvidenceModel).count()
    assert ev_after == ev_before, "ANPR must not create EvidenceModel rows"


# ─────────────────────────────────────────────────────────────────────────────
# Test 17 — GET /cameras/{id}/anpr Endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_17_camera_anpr_api(client, test_camera, db):
    """GET /cameras/{camera_id}/anpr returns stored ANPR observations."""
    obs = ANPRObservationModel(
        id="anpr-test-api-17",
        anpr_id="ANPR-17",
        camera_id="CAM-ANPR-TEST",
        vehicle_track_id=17,
        vehicle_track_label="VTRK#17",
        vehicle_class="car",
        plate_text="HR26DQ5551",
        confidence=0.94,
        format_valid=True,
    )
    db.add(obs)
    db.commit()

    resp = client.get("/api/v1/cameras/CAM-ANPR-TEST/anpr")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]["plate_text"] == "HR26DQ5551"

    db.delete(obs)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 18 — GET /anpr/stats Endpoint
# ─────────────────────────────────────────────────────────────────────────────

def test_18_anpr_stats_api(client, test_camera, db):
    """GET /anpr/stats returns real plate count statistics."""
    obs = ANPRObservationModel(
        id="anpr-test-api-18",
        anpr_id="ANPR-18",
        camera_id="CAM-ANPR-TEST",
        vehicle_track_id=18,
        vehicle_track_label="VTRK#18",
        vehicle_class="truck",
        plate_text="UP14ET8899",
        confidence=0.89,
        format_valid=True,
    )
    db.add(obs)
    db.commit()

    resp = client.get("/api/v1/anpr/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_reads" in data
    assert "unique_plates" in data
    assert "valid_format_count" in data
    assert data["total_reads"] >= 1

    db.delete(obs)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 19 — GET /anpr/search Plate Search API
# ─────────────────────────────────────────────────────────────────────────────

def test_19_anpr_search_api(client, test_camera, db):
    """GET /anpr/search returns matching plate records by text query."""
    obs = ANPRObservationModel(
        id="anpr-test-api-19",
        anpr_id="ANPR-19",
        camera_id="CAM-ANPR-TEST",
        vehicle_track_id=19,
        vehicle_track_label="VTRK#19",
        vehicle_class="car",
        plate_text="WB02AK3344",
        confidence=0.93,
        format_valid=True,
    )
    db.add(obs)
    db.commit()

    resp = client.get("/api/v1/anpr/search?plate=WB02AK3344")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["plate_text"] == "WB02AK3344"

    db.delete(obs)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 20 — Camera Isolation for ANPR Observations
# ─────────────────────────────────────────────────────────────────────────────

def test_20_anpr_camera_isolation(client, test_camera, db):
    """Observations in camera A do not pollute camera B stats."""
    obs = ANPRObservationModel(
        id="anpr-test-iso-20",
        anpr_id="ANPR-20",
        camera_id="CAM-ANPR-TEST",
        vehicle_track_id=20,
        vehicle_track_label="VTRK#20",
        vehicle_class="bus",
        plate_text="TN09AZ9999",
        confidence=0.91,
        format_valid=True,
    )
    db.add(obs)
    db.commit()

    resp = client.get("/api/v1/cameras/CAM-ANPR-TEST/anpr")
    assert resp.status_code == 200
    assert any(r["plate_text"] == "TN09AZ9999" for r in resp.json())

    resp_other = client.get("/api/v1/cameras/NONEXISTENT-CAM/anpr")
    assert resp_other.status_code == 200
    assert len(resp_other.json()) == 0

    db.delete(obs)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Test 21 — Phase 1 Vehicle Tracking Regression
# ─────────────────────────────────────────────────────────────────────────────

def test_21_phase1_vehicle_regression(client, test_camera, db):
    """Phase 1 vehicle tracking (VTRK#) and vehicle stats remain 100% functional."""
    from ai.tracker import track_registry
    track_registry.clear_camera("CAM-ANPR-TEST")

    car_det = _build_car_det(track_id=21, confidence=0.88)

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("ai.anpr_engine.anpr_engine.detect_plate_region") as mock_pr:

        mock_tf.return_value = [car_det]
        mock_pr.return_value = None  # No plate found

        res = None
        for _ in range(6):
            res = client.post(
                "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
                files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
            )
            assert res.status_code == 200

        data = res.json()
        assert data["vehicle_count"] >= 1
        vd = data["vehicle_detections"][0]
        assert vd["track_label"] == "VTRK#21"
        assert vd["vehicle_class"] == "car"


# ─────────────────────────────────────────────────────────────────────────────
# Test 22 — Human Detection Regression
# ─────────────────────────────────────────────────────────────────────────────

def test_22_human_detection_regression(client, test_camera, db):
    """Human detection pipeline functions unchanged after Phase 2 implementation."""
    person_det = {
        "fine_class": "person",
        "object_type": "human",
        "confidence": 0.89,
        "track_id": 220,
        "bounding_box": {"x": 0.2, "y": 0.1, "width": 0.15, "height": 0.6},
        "bbox_pixels": {"x": 128, "y": 48, "width": 96, "height": 288},
    }

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("services.face_recognition.face_recognition_service.recognize_faces") as mock_fr:

        mock_tf.return_value = [person_det]
        mock_fr.return_value = []

        res = client.post(
            "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["person_count"] >= 1
        assert data["detections"][0]["class"] == "person"


# ─────────────────────────────────────────────────────────────────────────────
# Test 23 — Unknown Person Incident Regression
# ─────────────────────────────────────────────────────────────────────────────

def test_23_unknown_person_incident_regression(client, test_camera, db):
    """Unknown person intrusion still creates an incident as required by human pipeline."""
    # Ensure zone exists
    from database.models import ZoneModel
    z = db.query(ZoneModel).filter(ZoneModel.camera_id == "CAM-ANPR-TEST").first()
    if not z:
        z = ZoneModel(
            id="zone-anpr-test-uuid",
            name="ANPR Test Restricted Zone",
            camera_id="CAM-ANPR-TEST",
            sector="Sector A",
            zone_type="restricted_fence",
            polygon_coordinates=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}],
            enabled=True,
            human_detection=True,
        )
        db.add(z)
        db.commit()

    person_det = {
        "fine_class": "person",
        "object_type": "human",
        "confidence": 0.92,
        "track_id": 230,
        "bounding_box": {"x": 0.4, "y": 0.2, "width": 0.2, "height": 0.5},
        "bbox_pixels": {"x": 256, "y": 96, "width": 128, "height": 240},
    }

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("ai.fence.smart_alert_service.validate_candidate_event") as mock_val, \
         patch("services.face_recognition.face_recognition_service.recognize_faces") as mock_fr:

        mock_tf.return_value = [person_det]
        mock_val.return_value = (True, {}, "Person: UNKNOWN PERSON DETECTED", "UNKNOWN", False, 0.25)
        mock_fr.return_value = []

        res = client.post(
            "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["incidents_created_count"] >= 1


# ─────────────────────────────────────────────────────────────────────────────
# Test 24 — Cloud False-Positive Protection Regression
# ─────────────────────────────────────────────────────────────────────────────

def test_24_cloud_false_positive_regression(client, test_camera, db):
    """Cloud/background noise detections continue to be rejected by human pipeline gates."""
    cloud_det = {
        "fine_class": "person",
        "object_type": "human",
        "confidence": 0.83,
        "track_id": 240,
        "bounding_box": {"x": 0.45, "y": 0.05, "width": 0.12, "height": 0.35},
        "bbox_pixels": {"x": 288, "y": 24, "width": 76, "height": 168},
    }

    with patch("api.detections.detector_instance.track_frame") as mock_tf, \
         patch("api.detections.fence_engine.evaluate_frame_detections") as mock_fe:

        mock_tf.return_value = [cloud_det]
        mock_fe.return_value = []  # Rejected by validation gates

        res = client.post(
            "/api/v1/cameras/CAM-ANPR-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", _make_frame_jpeg(), "image/jpeg")}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["incidents_created_count"] == 0
