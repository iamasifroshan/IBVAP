import unittest
import sys
import os
import numpy as np
import cv2
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, Base, engine, run_migrations
from database.models import RegisteredPersonModel, CameraModel, ZoneModel, IncidentModel, TrackModel
from main import app
from ai.detector import detector_instance
from services.face_recognition import face_recognition_service

class TestFaceSurveillance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run_migrations()
        cls.db = SessionLocal()
        cls.client = TestClient(app)

        # Setup mock camera if not exists
        cls.camera = cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-SURV-TEST").first()
        if not cls.camera:
            cls.camera = CameraModel(
                id="cam-surv-test-uuid",
                camera_id="CAM-SURV-TEST",
                name="Surveillance Test Camera",
                source_url="webcam",
                source_type="WEBCAM",
                status="ONLINE",
                sector="Sector B",
                fps=30
            )
            cls.db.add(cls.camera)
            cls.db.commit()
            cls.db.refresh(cls.camera)

    @classmethod
    def tearDownClass(cls):
        # Cleanup
        cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-SURV-TEST").delete()
        cls.db.commit()
        cls.db.close()

    def setUp(self):
        # Clean records
        self.db.query(RegisteredPersonModel).delete()
        self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-SURV-TEST").delete()
        self.db.query(ZoneModel).filter(ZoneModel.camera_id == "CAM-SURV-TEST").delete()
        self.db.commit()
        from api.detections import _webcam_frame_counters
        _webcam_frame_counters["CAM-SURV-TEST"] = 0
        from ai.tracker import track_registry
        track_registry.clear_camera("CAM-SURV-TEST")

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_single_frame_known_face(self, mock_recognize, mock_track):
        """
        Verify single-frame inference detects a known face, maps it to a person and returns the face dict.
        """
        # Mock YOLO detection to return one person
        mock_track.return_value = [{
            "track_id": 101,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.92,
            "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5},
            "bbox_pixels": {"x1": 64, "y1": 64, "x2": 160, "y2": 224}
        }]

        # Mock face recognition to return a known person (center of face is inside person box)
        mock_recognize.return_value = [{
            "recognized": True,
            "person_id": "person_abc",
            "name": "Jane Doe",
            "confidence": 0.88,
            "bounding_box": [80, 80, 40, 40]
        }]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/cameras/CAM-SURV-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["person_count"], 1)
        
        det = data["detections"][0]
        self.assertEqual(det["track_id"], 101)
        self.assertIsNotNone(det["face"])
        self.assertTrue(det["face"]["recognized"])
        self.assertEqual(det["face"]["name"], "Jane Doe")
        self.assertEqual(det["face"]["confidence"], 0.88)

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_single_frame_unknown_face(self, mock_recognize, mock_track):
        """
        Verify single-frame inference labels unrecognized face as UNKNOWN.
        """
        mock_track.return_value = [{
            "track_id": 102,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.90,
            "bounding_box": {"x": 0.1, "y": 0.1, "width": 0.4, "height": 0.6},
            "bbox_pixels": {"x1": 32, "y1": 32, "x2": 160, "y2": 224}
        }]

        mock_recognize.return_value = [{
            "recognized": False,
            "person_id": None,
            "name": "UNKNOWN",
            "confidence": 0.21,
            "bounding_box": [50, 50, 30, 30]
        }]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/cameras/CAM-SURV-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["person_count"], 1)
        det = data["detections"][0]
        self.assertIsNotNone(det["face"])
        self.assertFalse(det["face"]["recognized"])
        self.assertEqual(det["face"]["name"], "UNKNOWN")

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_single_frame_multiple_faces(self, mock_recognize, mock_track):
        """
        Verify multiple faces are detected and mapped independently to their corresponding persons.
        """
        mock_track.return_value = [
            {
                "track_id": 1,
                "fine_class": "person",
                "object_type": "human",
                "confidence": 0.90,
                "bounding_box": {"x": 0.0, "y": 0.0, "width": 0.3, "height": 0.5},
                "bbox_pixels": {"x1": 0, "y1": 0, "x2": 96, "y2": 160}
            },
            {
                "track_id": 2,
                "fine_class": "person",
                "object_type": "human",
                "confidence": 0.85,
                "bounding_box": {"x": 0.6, "y": 0.6, "width": 0.3, "height": 0.3},
                "bbox_pixels": {"x1": 192, "y1": 192, "x2": 288, "y2": 288}
            }
        ]

        mock_recognize.return_value = [
            {
                "recognized": True,
                "person_id": "person_1",
                "name": "Alice",
                "confidence": 0.90,
                "bounding_box": [20, 20, 20, 20]
            },
            {
                "recognized": True,
                "person_id": "person_2",
                "name": "Bob",
                "confidence": 0.82,
                "bounding_box": [210, 210, 20, 20]
            }
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/cameras/CAM-SURV-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["person_count"], 2)
        
        # Sort by track_id
        dets = sorted(data["detections"], key=lambda x: x["track_id"])
        self.assertEqual(dets[0]["face"]["name"], "Alice")
        self.assertEqual(dets[1]["face"]["name"], "Bob")

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_track_association_and_skipping(self, mock_recognize, mock_track):
        """
        Verify that identity is evaluated at interval and persisted in-memory for skipped frames.
        """
        from config import settings
        
        # We will process 3 live frames
        # Frame 0: face recognition runs, recognizes Alice.
        # Frame 1: face recognition skipped (as 1 % 5 != 0), but identity is carried over via track_to_identity.
        # Frame 2: face recognition skipped, identity is still Alice.
        
        frames = [
            (0, np.zeros((100, 100, 3), dtype=np.uint8)),
            (1, np.zeros((100, 100, 3), dtype=np.uint8)),
            (2, np.zeros((100, 100, 3), dtype=np.uint8)),
        ]

        # track_frame returns person for Track #500
        mock_track.return_value = [{
            "track_id": 500,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.88,
            "bounding_box": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
            "bbox_pixels": {"x1": 10, "y1": 10, "x2": 90, "y2": 90}
        }]

        # face recognition returns Alice
        mock_recognize.return_value = [{
            "recognized": True,
            "person_id": "person_alice",
            "name": "Alice",
            "confidence": 0.91,
            "bounding_box": [30, 30, 20, 20]
        }]

        # Run process_frames_with_tracking
        results = detector_instance.process_frames_with_tracking(
            frames_with_indices=frames,
            camera_id="CAM-SURV-TEST",
            conf_threshold=0.35,
            db=self.db
        )

        # Assert 3 frames processed and detections created
        self.assertEqual(results["frames_analyzed"], 3)
        self.assertEqual(len(results["detections"]), 3)

        # Verify Frame 0 contains face
        self.assertIsNotNone(results["detections"][0]["face"])
        self.assertEqual(results["detections"][0]["face"]["name"], "Alice")

        # Verify Frame 1 (which skipped face recognition run) carries over Alice!
        self.assertIsNotNone(results["detections"][1]["face"])
        self.assertEqual(results["detections"][1]["face"]["name"], "Alice")

        # Verify Frame 2 carries over Alice!
        self.assertIsNotNone(results["detections"][2]["face"])
        self.assertEqual(results["detections"][2]["face"]["name"], "Alice")

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_face_recognition_fail_safe(self, mock_recognize, mock_track):
        """
        Verify that if face recognition raises an exception, YOLO tracking and live capture loop do NOT crash.
        """
        mock_track.return_value = [{
            "track_id": 99,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.88,
            "bounding_box": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
            "bbox_pixels": {"x1": 10, "y1": 10, "x2": 90, "y2": 90}
        }]

        # Simulate SFace/YuNet runtime crash
        mock_recognize.side_effect = RuntimeError("OpenCV face recognition module missing or out of memory")

        frames = [(0, np.zeros((100, 100, 3), dtype=np.uint8))]

        # Run pipeline — should NOT crash!
        try:
            results = detector_instance.process_frames_with_tracking(
                frames_with_indices=frames,
                camera_id="CAM-SURV-TEST",
                conf_threshold=0.35,
                db=self.db
            )
        except Exception as e:
            self.fail(f"Pipeline crashed due to face recognition failure: {e}")

        # YOLO detections are still returned!
        self.assertEqual(len(results["detections"]), 1)
        self.assertEqual(results["detections"][0]["track_id"], 99)
        self.assertIsNone(results["detections"][0]["face"])

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    @patch('ai.fence.smart_alert_service.validate_candidate_event')
    def test_virtual_fence_with_face_metadata(self, mock_validate, mock_recognize, mock_track):
        """
        Verify that a zone breach by a known face creates an incident with identity columns correctly filled.
        """
        # Mock SmartAlert validation
        mock_validate.return_value = (True, {}, "Person: UNKNOWN PERSON DETECTED", "UNKNOWN", False, 0.30)

        # Create a restricted zone
        zone = ZoneModel(
            id="zone-surv-test-uuid",
            name="Restricted Area Alpha",
            camera_id="CAM-SURV-TEST",
            sector="Sector B",
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
        self.db.add(zone)
        self.db.commit()

        # Person detected inside the zone
        mock_track.return_value = [{
            "track_id": 777,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.95,
            "bounding_box": {"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.5},
            "bbox_pixels": {"x1": 128, "y1": 128, "x2": 192, "y2": 288}
        }]

        # Face is unrecognized (UNKNOWN)
        mock_recognize.return_value = [{
            "recognized": False,
            "person_id": None,
            "name": "UNKNOWN",
            "confidence": 0.30,
            "bounding_box": [140, 140, 20, 20]
        }]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        # Call single frame detect endpoint which triggers zone evaluation
        response = self.client.post(
            "/api/v1/cameras/CAM-SURV-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        print("DEBUG API RESPONSE:", data)
        self.assertGreaterEqual(data["incidents_created_count"], 1)

        # Inspect database IncidentModel record via self.db (already on isolated test DB)
        self.db.expire_all()  # refresh stale cache
        incident = self.db.query(IncidentModel).filter(
            IncidentModel.camera_id == "CAM-SURV-TEST"
        ).first()

        self.assertIsNotNone(incident)
        self.assertEqual(incident.track_id, "TRK#777")
        self.assertEqual(incident.person_name, "UNKNOWN")
        self.assertFalse(incident.face_recognized)
        self.assertEqual(incident.face_confidence, 0.30)
        self.assertIn("Person: UNKNOWN PERSON DETECTED", incident.explainable_reason)
