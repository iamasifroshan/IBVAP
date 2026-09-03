import unittest
import sys
import os
import io
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

class TestFaceRecognition(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Run migrations to ensure table exists
        run_migrations()
        cls.db = SessionLocal()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        # Clean up database registered_people records before each test
        self.db.query(RegisteredPersonModel).delete()
        self.db.commit()

    def test_migration_safety(self):
        """
        Verify that running db migrations is idempotent and does not drop tables or columns.
        """
        # Ensure we have some test camera data
        cam = self.db.query(CameraModel).first()
        cam_count_before = self.db.query(CameraModel).count()

        # Run migration again
        run_migrations()

        # Verify cameras count is unchanged
        cam_count_after = self.db.query(CameraModel).count()
        self.assertEqual(cam_count_before, cam_count_after)

        # Check if registered_people table is accessible
        count = self.db.query(RegisteredPersonModel).count()
        self.assertGreaterEqual(count, 0)

    @patch('services.face_recognition.face_recognition_service.detect_faces')
    @patch('services.face_recognition.face_recognition_service.extract_embedding')
    def test_registration(self, mock_extract, mock_detect):
        """
        Test registering a new person with face detection and embedding extraction.
        """
        # Mock detection to return 1 face
        mock_detect.return_value = (True, np.array([[10, 20, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95]]))
        # Mock embedding extraction to return a list of 128 floats
        mock_extract.return_value = [0.05] * 128

        # Create dummy image bytes
        img = np.zeros((300, 300, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/faces/register",
            data={"name": "John Doe", "identity_code": "EMP-001"},
            files={"file": ("test.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["name"], "John Doe")
        self.assertEqual(data["identity_code"], "EMP-001")
        self.assertIsNotNone(data["person_id"])
        self.assertIsNotNone(data["image_path"])

        # Check database persistence
        person = self.db.query(RegisteredPersonModel).filter(
            RegisteredPersonModel.identity_code == "EMP-001"
        ).first()
        self.assertIsNotNone(person)
        self.assertEqual(person.name, "John Doe")
        self.assertEqual(person.face_embedding, [0.05] * 128)

    @patch('services.face_recognition.face_recognition_service.detect_faces')
    @patch('services.face_recognition.face_recognition_service.extract_embedding')
    def test_registration_invalid_image(self, mock_extract, mock_detect):
        """
        Test registration fails if no face is detected.
        """
        # Mock detection to return 0 faces
        mock_detect.return_value = (False, None)

        img = np.zeros((300, 300, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/faces/register",
            data={"name": "No Face Person"},
            files={"file": ("test.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("No face detected", response.json()["detail"])

    @patch('services.face_recognition.face_recognition_service.detect_faces')
    def test_registration_multiple_faces(self, mock_detect):
        """
        Test registration fails if multiple faces are detected in a registration frame.
        """
        # Mock detection to return 2 faces
        mock_detect.return_value = (True, np.array([
            [10, 20, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95],
            [150, 150, 80, 80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.91]
        ]))

        img = np.zeros((300, 300, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/faces/register",
            data={"name": "Multi Face Person"},
            files={"file": ("test.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Multiple faces detected", response.json()["detail"])

    def test_retrieval_and_list(self):
        """
        Test retrieving and listing registered people.
        """
        # Manually seed database
        p1 = RegisteredPersonModel(
            person_id="person_p1",
            name="Alice Smith",
            identity_code="EMP-101",
            face_embedding=[0.1] * 128,
            image_path=None,
            is_active=True
        )
        p2 = RegisteredPersonModel(
            person_id="person_p2",
            name="Bob Jones",
            identity_code="EMP-102",
            face_embedding=[0.2] * 128,
            image_path=None,
            is_active=False
        )
        self.db.add_all([p1, p2])
        self.db.commit()

        # List all active
        res_list_active = self.client.get("/api/v1/faces/?active_only=true")
        self.assertEqual(res_list_active.status_code, 200)
        active_data = res_list_active.json()
        self.assertEqual(len(active_data), 1)
        self.assertEqual(active_data[0]["name"], "Alice Smith")

        # List all including inactive
        res_list_all = self.client.get("/api/v1/faces/?active_only=false")
        self.assertEqual(res_list_all.status_code, 200)
        all_data = res_list_all.json()
        self.assertEqual(len(all_data), 2)

        # Get single person
        res_get = self.client.get("/api/v1/faces/person_p1")
        self.assertEqual(res_get.status_code, 200)
        self.assertEqual(res_get.json()["name"], "Alice Smith")

        # Get invalid
        res_get_invalid = self.client.get("/api/v1/faces/person_invalid")
        self.assertEqual(res_get_invalid.status_code, 404)

    def test_update_and_deactivate(self):
        """
        Test updating metadata and active status of a registered person.
        """
        p = RegisteredPersonModel(
            person_id="person_p3",
            name="Charlie Brown",
            identity_code="EMP-103",
            face_embedding=[0.3] * 128,
            is_active=True
        )
        self.db.add(p)
        self.db.commit()

        # Update name and deactivate
        response = self.client.put(
            "/api/v1/faces/person_p3",
            data={"name": "Charlie Brown Jr.", "is_active": "false"}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "Charlie Brown Jr.")
        self.assertEqual(data["is_active"], False)

        # Check database
        person = self.db.query(RegisteredPersonModel).filter(
            RegisteredPersonModel.person_id == "person_p3"
        ).first()
        self.assertEqual(person.name, "Charlie Brown Jr.")
        self.assertEqual(person.is_active, False)

    def test_delete_person(self):
        """
        Test deleting a registered person record.
        """
        p = RegisteredPersonModel(
            person_id="person_p4",
            name="Dave Miller",
            identity_code="EMP-104",
            face_embedding=[0.4] * 128,
            is_active=True
        )
        self.db.add(p)
        self.db.commit()

        response = self.client.delete("/api/v1/faces/person_p4")
        self.assertEqual(response.status_code, 200)

        # Verify DB deletion
        person = self.db.query(RegisteredPersonModel).filter(
            RegisteredPersonModel.person_id == "person_p4"
        ).first()
        self.assertIsNone(person)

    @patch('services.face_recognition.face_recognition_service.detect_faces')
    @patch('services.face_recognition.face_recognition_service.extract_embedding')
    @patch('services.face_recognition.face_recognition_service.compare_embeddings')
    def test_known_unknown_recognition(self, mock_compare, mock_extract, mock_detect):
        """
        Test face recognition endpoint for known and unknown faces.
        """
        # Register a person in DB
        p = RegisteredPersonModel(
            person_id="person_john",
            name="John Watson",
            identity_code="EMP-800",
            face_embedding=[0.5] * 128,
            is_active=True
        )
        self.db.add(p)
        self.db.commit()

        # Mock detects 2 faces
        mock_detect.return_value = (True, np.array([
            [10, 10, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.95],
            [100, 100, 60, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.92]
        ]))
        # Mock embeddings
        mock_extract.side_effect = [
            [0.5] * 128,  # First face (will match John Watson)
            [0.9] * 128   # Second face (will not match)
        ]
        # Mock comparison similarity scores
        # We compare face 1 to John Watson -> high match (0.91)
        # We compare face 2 to John Watson -> low match (0.12)
        mock_compare.side_effect = [0.91, 0.12]

        img = np.zeros((300, 300, 3), dtype=np.uint8)
        _, img_encoded = cv2.imencode('.jpg', img)
        img_bytes = img_encoded.tobytes()

        response = self.client.post(
            "/api/v1/faces/recognize",
            files={"file": ("test.jpg", img_bytes, "image/jpeg")}
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data), 2)

        # First face should be KNOWN
        self.assertEqual(data[0]["person_id"], "person_john")
        self.assertEqual(data[0]["name"], "John Watson")
        self.assertEqual(data[0]["recognized"], True)
        self.assertEqual(data[0]["confidence"], 0.91)
        self.assertEqual(data[0]["bounding_box"], [10, 10, 50, 50])

        # Second face should be UNKNOWN
        self.assertIsNone(data[1]["person_id"])
        self.assertEqual(data[1]["name"], "UNKNOWN")
        self.assertEqual(data[1]["recognized"], False)
        self.assertEqual(data[1]["confidence"], 0.12)
        self.assertEqual(data[1]["bounding_box"], [100, 100, 60, 60])

if __name__ == "__main__":
    unittest.main()
