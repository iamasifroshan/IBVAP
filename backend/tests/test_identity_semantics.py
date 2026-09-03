import unittest
import numpy as np
import cv2
import uuid
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from database.db import SessionLocal, Base, engine
from database.models import CameraModel, ZoneModel, IncidentModel, RegisteredPersonModel
from ai.tracker import track_registry, TrackRecord, TrackState
from ai.smart_alert import smart_alert_service
from services.face_recognition import face_recognition_service
from main import app

class TestIdentitySemantics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.db = SessionLocal()
        cls.client = TestClient(app)

        cls.camera = cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-ID-SEM").first()
        if not cls.camera:
            cls.camera = CameraModel(
                id="cam-id-sem-uuid",
                camera_id="CAM-ID-SEM",
                name="Identity Semantics Test Camera",
                source_url="webcam",
                source_type="WEBCAM",
                status="ONLINE",
                sector="Sector A",
                fps=30
            )
            cls.db.add(cls.camera)
            cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-ID-SEM").delete()
        cls.db.commit()
        cls.db.close()

    def setUp(self):
        self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ID-SEM").delete()
        self.db.query(ZoneModel).filter(ZoneModel.camera_id == "CAM-ID-SEM").delete()
        self.db.commit()

        from api.detections import _webcam_frame_counters
        _webcam_frame_counters.clear()
        track_registry._store.clear()
        track_registry._vehicle_store.clear()

        from ai.fence import fence_engine
        fence_engine._track_zone_states.clear()

        self.zone = ZoneModel(
            id=str(uuid.uuid4()),
            name="Global Restricted Zone",
            camera_id="CAM-ID-SEM",
            sector="Sector A",
            zone_type="restricted_fence",
            polygon_coordinates=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}],
            severity="critical",
            sensitivity=90,
            min_threat_threshold=60,
            loitering_limit_sec=15,
            enabled=True,
            human_detection=True,
            vehicle_detection=False,
            animal_detection=False
        )
        self.db.add(self.zone)
        self.db.commit()

    # 1. Known person → KNOWN → 0 incidents
    @patch('ai.detector.detector_instance.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_01_known_person_zero_incidents(self, mock_rec, mock_track):
        mock_track.return_value = [
            {"track_id": 1, "fine_class": "person", "object_type": "human", "confidence": 0.95,
             "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5},
             "bbox_pixels": {"x1": 50, "y1": 50, "x2": 150, "y2": 200}}
        ]
        mock_rec.return_value = [
            {"recognized": True, "person_id": "p1", "name": "ASIF", "confidence": 0.99,
             "recognition_confidence": 0.99, "face_detection_confidence": 0.95,
             "confidence_level": "HIGH", "identity_status": "KNOWN", "bounding_box": [60, 60, 30, 30]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        for _ in range(4):
            resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
            self.assertEqual(resp.status_code, 200)

        data = resp.json()
        self.assertEqual(data["person_count"], 1)
        self.assertEqual(data["detections"][0]["identity_status"], "KNOWN")
        self.assertEqual(data["detections"][0]["face"]["name"], "ASIF")
        self.assertEqual(data["incidents_created_count"], 0)
        self.assertEqual(self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ID-SEM").count(), 0)

    # 2. Person with no visible face → FACE_UNAVAILABLE → 0 incidents
    @patch('ai.detector.detector_instance.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_02_person_no_visible_face_zero_incidents(self, mock_rec, mock_track):
        mock_track.return_value = [
            {"track_id": 2, "fine_class": "person", "object_type": "human", "confidence": 0.92,
             "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5},
             "bbox_pixels": {"x1": 50, "y1": 50, "x2": 150, "y2": 200}}
        ]
        mock_rec.return_value = [] # No faces found

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        for _ in range(4):
            resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
            self.assertEqual(resp.status_code, 200)

        data = resp.json()
        self.assertEqual(data["detections"][0]["identity_status"], "FACE_UNAVAILABLE")
        self.assertEqual(data["detections"][0]["face_detected"], False)
        self.assertEqual(data["incidents_created_count"], 0)
        self.assertEqual(self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ID-SEM").count(), 0)

    # 3. Person with occluded face → FACE_UNAVAILABLE → 0 incidents
    def test_03_occluded_face_suppression(self):
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM-ID-SEM", track_id=301, fine_class="person", object_type="human",
            confidence=0.91, frames_seen=10, is_inside_zone=True, zone_name="Global Restricted Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.4},
            face_metadata={"identity_status": "FACE_UNAVAILABLE", "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule7_identity_verification"]["status"], "SUPPRESSED_FACE_UNAVAILABLE")

    # 4. Face detected, valid SFace match → KNOWN
    def test_04_valid_sface_match_known(self):
        t = TrackRecord(camera_id="CAM-ID-SEM", track_id=401, fine_class="person", object_type="human")
        face_data = {
            "identity_status": "KNOWN",
            "recognized": True,
            "person_id": "person_01",
            "name": "Asif",
            "confidence": 0.985,
            "recognition_confidence": 0.985,
            "face_detection_confidence": 0.96,
            "confidence_level": "HIGH",
            "bounding_box": [10, 10, 50, 50]
        }
        t.update_face_identity(face_data, grace_limit=5)
        self.assertEqual(t.identity_status, "KNOWN")
        self.assertEqual(t.identity_name, "Asif")
        self.assertEqual(t.recognition_confidence, 0.985)

    # 5. Face detected, no valid profile match → UNKNOWN → existing threat rules
    @patch('ai.detector.detector_instance.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_05_unknown_face_creates_incident(self, mock_rec, mock_track):
        mock_track.return_value = [
            {"track_id": 5, "fine_class": "person", "object_type": "human", "confidence": 0.94,
             "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5},
             "bbox_pixels": {"x1": 50, "y1": 50, "x2": 150, "y2": 200}}
        ]
        mock_rec.return_value = [
            {"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.32,
             "recognition_confidence": 0.32, "face_detection_confidence": 0.92,
             "confidence_level": "UNKNOWN", "identity_status": "UNKNOWN", "bounding_box": [60, 60, 30, 30]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        for _ in range(4):
            resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
            self.assertEqual(resp.status_code, 200)

        data = resp.json()
        self.assertEqual(data["detections"][0]["identity_status"], "UNKNOWN")
        self.assertEqual(self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ID-SEM").count(), 1)

    # 6. SFace technical failure → FACE_PROCESSING_ERROR → 0 incidents
    def test_06_sface_technical_failure_suppressed(self):
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM-ID-SEM", track_id=601, fine_class="person", object_type="human",
            confidence=0.91, frames_seen=10, is_inside_zone=True, zone_name="Global Restricted Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.4},
            face_metadata={"identity_status": "FACE_PROCESSING_ERROR", "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule7_identity_verification"]["status"], "SUPPRESSED_FACE_PROCESSING_ERROR")

    # 7. Known → temporary face unavailable → known → identity remains temporally stable
    def test_07_temporal_identity_stability(self):
        t = TrackRecord(camera_id="CAM-ID-SEM", track_id=701, fine_class="person", object_type="human")
        # Frame 1: Known Asif 0.99
        t.update_face_identity({
            "identity_status": "KNOWN", "recognized": True, "person_id": "p1", "name": "Asif",
            "confidence": 0.99, "recognition_confidence": 0.99, "face_detection_confidence": 0.95
        }, grace_limit=3)
        self.assertEqual(t.identity_status, "KNOWN")
        self.assertEqual(t.identity_name, "Asif")

        # Frame 2: Face unavailable
        t.update_face_identity(None, grace_limit=3)
        self.assertEqual(t.identity_status, "KNOWN")
        self.assertEqual(t.face_info["name"], "Asif")

        # Frame 3: Known Asif 0.97
        t.update_face_identity({
            "identity_status": "KNOWN", "recognized": True, "person_id": "p1", "name": "Asif",
            "confidence": 0.97, "recognition_confidence": 0.97, "face_detection_confidence": 0.94
        }, grace_limit=3)
        self.assertEqual(t.identity_status, "KNOWN")
        self.assertEqual(t.identity_name, "Asif")

    # 8. Multiple people → each gets independent TRK and identity state
    @patch('ai.detector.detector_instance.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_08_multiple_people_independent_identity(self, mock_rec, mock_track):
        mock_track.return_value = [
            {"track_id": 81, "fine_class": "person", "object_type": "human", "confidence": 0.95,
             "bounding_box": {"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.5},
             "bbox_pixels": {"x1": 30, "y1": 50, "x2": 90, "y2": 200}},
            {"track_id": 82, "fine_class": "person", "object_type": "human", "confidence": 0.91,
             "bounding_box": {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.5},
             "bbox_pixels": {"x1": 190, "y1": 50, "x2": 250, "y2": 200}}
        ]
        mock_rec.return_value = [
            {"recognized": True, "person_id": "p1", "name": "ASIF", "confidence": 0.98,
             "recognition_confidence": 0.98, "face_detection_confidence": 0.95,
             "confidence_level": "HIGH", "identity_status": "KNOWN", "bounding_box": [40, 60, 20, 20]}
            # Person 82 has NO face detected
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
        self.assertEqual(resp.status_code, 200)
        dets = resp.json()["detections"]
        self.assertEqual(len(dets), 2)
        
        d81 = next(d for d in dets if d["track_id"] == 81)
        d82 = next(d for d in dets if d["track_id"] == 82)
        self.assertEqual(d81["identity_status"], "KNOWN")
        self.assertEqual(d82["identity_status"], "FACE_UNAVAILABLE")

    # 9. Known person + unknown person → only actual UNKNOWN candidate may enter threat logic
    @patch('ai.detector.detector_instance.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_09_known_plus_unknown_only_unknown_alerts(self, mock_rec, mock_track):
        mock_track.return_value = [
            {"track_id": 91, "fine_class": "person", "object_type": "human", "confidence": 0.95,
             "bounding_box": {"x": 0.1, "y": 0.2, "width": 0.2, "height": 0.5},
             "bbox_pixels": {"x1": 30, "y1": 50, "x2": 90, "y2": 200}},
            {"track_id": 92, "fine_class": "person", "object_type": "human", "confidence": 0.93,
             "bounding_box": {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.5},
             "bbox_pixels": {"x1": 190, "y1": 50, "x2": 250, "y2": 200}}
        ]
        mock_rec.return_value = [
            {"recognized": True, "person_id": "p1", "name": "ASIF", "confidence": 0.98,
             "recognition_confidence": 0.98, "face_detection_confidence": 0.95,
             "confidence_level": "HIGH", "identity_status": "KNOWN", "bounding_box": [40, 60, 20, 20]},
            {"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.25,
             "recognition_confidence": 0.25, "face_detection_confidence": 0.91,
             "confidence_level": "UNKNOWN", "identity_status": "UNKNOWN", "bounding_box": [200, 60, 20, 20]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        for _ in range(4):
            resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
            self.assertEqual(resp.status_code, 200)

        incidents = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-ID-SEM").all()
        self.assertEqual(len(incidents), 1)
        self.assertEqual(incidents[0].track_id, "TRK#92")

    # 10. Vehicle → no human identity state
    @patch('ai.detector.detector_instance.track_frame')
    def test_10_vehicle_has_no_human_identity_state(self, mock_track):
        mock_track.return_value = [
            {"track_id": 101, "fine_class": "car", "object_type": "vehicle", "confidence": 0.89,
             "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.4, "height": 0.3},
             "bbox_pixels": {"x1": 100, "y1": 100, "x2": 220, "y2": 190}}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, enc = cv2.imencode('.jpg', img)

        for _ in range(3):
            resp = self.client.post("/api/v1/cameras/CAM-ID-SEM/detect-frame", files={"file": ("frame.jpg", enc.tobytes(), "image/jpeg")})
            self.assertEqual(resp.status_code, 200)

        data = resp.json()
        self.assertEqual(data["person_count"], 0)
        self.assertEqual(data["vehicle_count"], 1)
        self.assertEqual(len(data["detections"]), 0)
        self.assertEqual(len(data["vehicle_detections"]), 1)
        self.assertEqual(data["vehicle_detections"][0]["class"], "car")


