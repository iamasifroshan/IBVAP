import unittest
import sys
import os
import numpy as np
import cv2
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, run_migrations
from database.models import CameraModel, ZoneModel, IncidentModel
from main import app

class TestIncidentPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run_migrations()
        cls.db = SessionLocal()
        cls.client = TestClient(app)

        cls.camera = cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-PIPE-TEST").first()
        if not cls.camera:
            cls.camera = CameraModel(
                id="cam-pipe-test-uuid",
                camera_id="CAM-PIPE-TEST",
                name="Pipeline Test Camera",
                source_url="webcam",
                source_type="WEBCAM",
                status="ONLINE",
                sector="Sector A",
                fps=30
            )
            cls.db.add(cls.camera)
            cls.db.commit()
            cls.db.refresh(cls.camera)

    @classmethod
    def tearDownClass(cls):
        cls.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-PIPE-TEST").delete()
        cls.db.commit()
        cls.db.close()

    def setUp(self):
        self.db.query(IncidentModel).filter(IncidentModel.camera_id.in_(["CAM-PIPE-TEST", "CAM-PIPE-TEST-2"])).delete()
        self.db.query(ZoneModel).filter(ZoneModel.camera_id.in_(["CAM-PIPE-TEST", "CAM-PIPE-TEST-2"])).delete()
        self.db.commit()

        from api.detections import _webcam_frame_counters
        _webcam_frame_counters.clear()
        
        from ai.tracker import track_registry
        track_registry._store.clear()

        from ai.fence import fence_engine
        fence_engine._track_zone_states.clear()

        from ai.smart_alert import _recent_alerts
        _recent_alerts.clear()


        self.zone = ZoneModel(
            id=str(uuid.uuid4()),
            name="Webcam Global Zone",
            camera_id="CAM-PIPE-TEST",
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

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_A_two_known_people(self, mock_recognize, mock_track):
        mock_track.return_value = [
            {"track_id": 1, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.4}, "bbox_pixels": {"x1": 50, "y1": 50, "x2": 100, "y2": 150}},
            {"track_id": 2, "fine_class": "person", "object_type": "human", "confidence": 0.92, "bounding_box": {"x": 0.6, "y": 0.2, "width": 0.2, "height": 0.4}, "bbox_pixels": {"x1": 150, "y1": 50, "x2": 200, "y2": 150}}
        ]
        mock_recognize.side_effect = lambda frame, boxes: [
            {"recognized": True, "person_id": "p1", "name": "ASIF", "confidence": 0.9, "bounding_box": [60, 60, 20, 20]},
            {"recognized": True, "person_id": "p2", "name": "AFRITH", "confidence": 0.9, "bounding_box": [160, 60, 20, 20]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        response = self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["person_count"], 2)
        self.assertEqual(data["incidents_created_count"], 0)
        self.assertEqual(len(data.get("incident_ids", [])), 0)

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_B_one_unknown_person(self, mock_recognize, mock_track):
        mock_track.return_value = [
            {"track_id": 10, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.1}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 120, "y2": 120}}
        ]
        mock_recognize.return_value = [
            {"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.8, "face_detection_confidence": 0.8, "bounding_box": [110, 110, 20, 20]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        for _ in range(6):
            response = self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        self.assertEqual(response.status_code, 200)
        print("TEST_B RESPONSE DATA:", response.json())
        
        all_inc = self.db.query(IncidentModel).all()
        for i in all_inc:
            print(f"INC IN DB: {i.camera_id} {i.track_id}")
            
        total_incidents = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").count()
        self.assertEqual(total_incidents, 1)
        
        incident = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").first()
        self.assertIn("Identity: UNKNOWN (Face Verified)", incident.explainable_reason)

    @patch('ai.detector.YoloDetector.track_frame')
    def test_I_false_positive_background_cloud(self, mock_track):
        # TEST 11: YOLO false-positive/background/cloud-like detection
        # e.g., bounding box is extremely wide and short (aspect ratio 4.0)
        mock_track.return_value = [
            {"track_id": 99, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.5, "y": 0.2, "width": 0.8, "height": 0.2}, "bbox_pixels": {"x1": 50, "y1": 50, "x2": 250, "y2": 100}}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)

        for _ in range(6): # Enough frames to pass persistence
            response = self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
            self.assertEqual(response.status_code, 200)

        # 0 incidents created because bbox aspect ratio is 4.0 > 2.80
        total_incidents = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").count()
        self.assertEqual(total_incidents, 0)

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_C_same_unknown_track_multiple_frames(self, mock_recognize, mock_track):
        mock_track.return_value = [
            {"track_id": 912, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.1}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 120, "y2": 120}}
        ]
        mock_recognize.return_value = [
            {"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.8, "face_detection_confidence": 0.8, "bounding_box": [110, 110, 20, 20]}
        ]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        
        for _ in range(6):
            response = self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
            self.assertEqual(response.status_code, 200)
            
        total_incidents = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").count()
        self.assertEqual(total_incidents, 1)

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_D_different_unknown_track(self, mock_recognize, mock_track):
        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        mock_recognize.return_value = [{"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.8, "face_detection_confidence": 0.8, "bounding_box": [110, 110, 20, 20]}]
        
        mock_track.return_value = [{"track_id": 10, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.1}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 120, "y2": 120}}]
        for _ in range(6):
            self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        mock_track.return_value = [{"track_id": 11, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.1}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 120, "y2": 120}}]
        for _ in range(6):
            self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})

        total_incidents = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").count()
        self.assertEqual(total_incidents, 2)

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_E_same_track_on_different_cameras(self, mock_recognize, mock_track):
        cam2 = CameraModel(id="cam-pipe-test-2-uuid", camera_id="CAM-PIPE-TEST-2", name="Pipeline Test Camera 2", source_url="webcam", source_type="WEBCAM", status="ONLINE", sector="Sector A", fps=30)
        self.db.add(cam2)
        zone2 = ZoneModel(id=str(uuid.uuid4()), name="Zone 2", camera_id="CAM-PIPE-TEST-2", sector="Sector A", zone_type="restricted_fence", polygon_coordinates=[{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0}, {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}], enabled=True, human_detection=True)
        self.db.add(zone2)
        self.db.commit()

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        mock_recognize.return_value = [{"recognized": False, "person_id": None, "name": "UNKNOWN", "confidence": 0.8, "face_detection_confidence": 0.8, "bounding_box": [110, 110, 20, 20]}]
        mock_track.return_value = [{"track_id": 10, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.3, "y": 0.3, "width": 0.1, "height": 0.1}, "bbox_pixels": {"x1": 100, "y1": 100, "x2": 120, "y2": 120}}]
        
        for _ in range(6):
            self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        for _ in range(6):
            self.client.post("/api/v1/cameras/CAM-PIPE-TEST-2/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})

        i1 = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST").count()
        i2 = self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST-2").count()
        self.assertEqual(i1, 1)
        self.assertEqual(i2, 1)
        
        self.db.query(IncidentModel).filter(IncidentModel.camera_id == "CAM-PIPE-TEST-2").delete()
        self.db.query(ZoneModel).filter(ZoneModel.camera_id == "CAM-PIPE-TEST-2").delete()
        self.db.query(CameraModel).filter(CameraModel.camera_id == "CAM-PIPE-TEST-2").delete()
        self.db.commit()

    def test_F_evidence_without_incident_id(self):
        img = np.zeros((10, 10, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        response = self.client.post("/api/v1/evidence", data={
            "camera_id": "CAM-PIPE-TEST", "sector": "Sector A", "timestamp": "2026", 
            "event_type": "TEST", "person_count": 1, "threat_level": "ALERT"
        }, files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Real incident_id is required", response.json()["detail"])

    def test_G_evidence_with_invalid_incident_id(self):
        img = np.zeros((10, 10, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        response = self.client.post("/api/v1/evidence", data={
            "camera_id": "CAM-PIPE-TEST", "sector": "Sector A", "timestamp": "2026", 
            "event_type": "TEST", "person_count": 1, "threat_level": "ALERT",
            "incident_id": "fake-incident-id"
        }, files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Real incident_id is required", response.json()["detail"])

    @patch('ai.detector.YoloDetector.track_frame')
    @patch('services.face_recognition.face_recognition_service.recognize_faces')
    def test_H_known_person_evidence(self, mock_recognize, mock_track):
        mock_track.return_value = [{"track_id": 1, "fine_class": "person", "object_type": "human", "confidence": 0.95, "bounding_box": {"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.4}, "bbox_pixels": {"x1": 50, "y1": 50, "x2": 100, "y2": 150}}]
        mock_recognize.side_effect = lambda frame, boxes: [{"recognized": True, "person_id": "p1", "name": "ASIF", "confidence": 0.9, "bounding_box": [60, 60, 20, 20]}]

        img = np.zeros((320, 320, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        response = self.client.post("/api/v1/cameras/CAM-PIPE-TEST/detect-frame", files={"file": ("frame.jpg", img_encoded.tobytes(), "image/jpeg")})
        
        data = response.json()
        self.assertEqual(data["incidents_created_count"], 0)
