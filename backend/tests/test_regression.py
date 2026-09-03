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
from database.models import RegisteredPersonModel, CameraModel
from main import app
from services.face_recognition import face_recognition_service

class TestRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run_migrations()
        cls.db = SessionLocal()
        cls.client = TestClient(app)

        # Setup mock camera
        cls.camera = cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-REGRESSION-TEST").first()
        if not cls.camera:
            cls.camera = CameraModel(
                id="cam-regression-test-uuid",
                camera_id="CAM-REGRESSION-TEST",
                name="Regression Test Camera",
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
        cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-REGRESSION-TEST").delete()
        cls.db.commit()
        cls.db.close()

    def setUp(self):
        # Clear registered people database before each test
        self.db.query(RegisteredPersonModel).delete()
        self.db.commit()

    @patch('services.face_recognition.face_recognition_service.detect_faces')
    @patch('services.face_recognition.face_recognition_service.extract_embedding')
    @patch('services.face_recognition.face_recognition_service.compare_embeddings')
    def test_registered_asif_is_recognized(self, mock_compare, mock_extract, mock_detect):
        """
        Verify that a registered person Asif is recognized successfully,
        unknown faces are returned as UNKNOWN, and face recognition errors
        do not break YOLO tracking/processing.
        """
        # 1. Register Asif in database
        asif_embedding = [0.1] * 128
        asif = RegisteredPersonModel(
            person_id="person_asif_123",
            name="Asif",
            identity_code="ASIF-TEST",
            face_embedding=asif_embedding,
            is_active=True
        )
        self.db.add(asif)
        self.db.commit()

        # 2. Mock detect_faces to return 2 faces:
        # One for Asif, one for someone else
        mock_detect.return_value = (True, np.array([
            [10, 10, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95],
            [100, 100, 60, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.92]
        ]))

        # Mock embedding extraction
        mock_extract.side_effect = [
            [0.1] * 128,  # First face matches Asif
            [0.9] * 128   # Second face does not match
        ]

        # Mock comparisons
        # Asif face vs Asif registered -> 0.85 similarity (above 0.363 threshold)
        # Unknown face vs Asif registered -> 0.15 similarity (below threshold)
        mock_compare.side_effect = [0.85, 0.15]

        # Call recognition directly
        dummy_frame = np.zeros((300, 300, 3), dtype=np.uint8)
        results = face_recognition_service.recognize_faces(dummy_frame, self.db)

        self.assertEqual(len(results), 2)

        # First face is Asif
        self.assertTrue(results[0]["recognized"])
        self.assertEqual(results[0]["name"], "Asif")
        self.assertEqual(results[0]["person_id"], "person_asif_123")
        self.assertGreaterEqual(results[0]["confidence"], 0.363)

        # Second face is UNKNOWN
        self.assertFalse(results[1]["recognized"])
        self.assertEqual(results[1]["name"], "UNKNOWN")
        self.assertIsNone(results[1]["person_id"])

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_face_recognition_failure_yolo_continues(self, mock_recognize, mock_track):
        """
        Verify that if face recognition raises an exception/fails,
        YOLO person tracking and camera streaming continues normally.
        """
        # Mock YOLO detection to return 1 person
        mock_track.return_value = [{
            "track_id": 101,
            "fine_class": "person",
            "object_type": "human",
            "confidence": 0.92,
            "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.3, "height": 0.5},
            "bbox_pixels": {"x1": 64, "y1": 64, "x2": 160, "y2": 224}
        }]

        # Mock face recognition to raise an exception
        mock_recognize.side_effect = RuntimeError("YuNet model graph error")

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        # Send request to detect-frame
        response = self.client.post(
            "/api/v1/cameras/CAM-REGRESSION-TEST/detect-frame?conf_threshold=0.35",
            files={"file": ("frame.jpg", img_bytes, "image/jpeg")}
        )

        # The request must succeed (200 status code) despite face recognition failure!
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["person_count"], 1)
        self.assertEqual(data["detections"][0]["track_id"], 101)
        self.assertIsNone(data["detections"][0]["face"]) # face info is None due to failure
