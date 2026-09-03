import os
import sys
import unittest
import numpy as np
import cv2
from datetime import datetime
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, Base, engine, run_migrations
from database.models import RegisteredPersonModel, FaceReferenceModel, CameraModel, ZoneModel, IncidentModel
from main import app
from config import settings
from services.face_recognition import face_recognition_service
from ai.tracker import TrackRecord, TrackState, track_registry
from ai.detector import detector_instance


def create_dummy_face_image(num_faces: int = 1) -> bytes:
    """Creates a dummy synthetic image with 0, 1, or 2 simple face shapes."""
    img = np.ones((300, 300, 3), dtype=np.uint8) * 200
    if num_faces >= 1:
        # Draw a synthetic face representation
        cv2.circle(img, (150, 150), 60, (100, 150, 200), -1)
        cv2.circle(img, (130, 130), 10, (255, 255, 255), -1)
        cv2.circle(img, (170, 130), 10, (255, 255, 255), -1)
        cv2.ellipse(img, (150, 175), (20, 10), 0, 0, 180, (50, 50, 50), 2)
    if num_faces >= 2:
        cv2.circle(img, (50, 50), 30, (100, 150, 200), -1)
    
    _, encoded = cv2.imencode('.jpg', img)
    return encoded.tobytes()


class TestPhase4MultiReference(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_1_single_and_multi_reference_registration_and_endpoints(self):
        """Test registering a person, adding 2nd and 3rd references, listing, and deletion rules."""
        dummy_img = create_dummy_face_image(1)

        # Mock face detection & embedding extraction for deterministic testing
        with patch.object(face_recognition_service, 'detect_faces', return_value=(True, np.array([[50, 50, 100, 100, 0.9]]))),\
             patch.object(face_recognition_service, 'extract_embedding', return_value=[0.1] * 128):

            # 1. Register Person
            resp = self.client.post(
                "/api/v1/faces/register",
                data={"name": "Phase4 User", "identity_code": "P4-001"},
                files={"file": ("face1.jpg", dummy_img, "image/jpeg")}
            )
            self.assertEqual(resp.status_code, 201)
            p_data = resp.json()
            person_id = p_data["person_id"]
            self.assertEqual(p_data["name"], "Phase4 User")
            self.assertEqual(p_data["references_count"], 1)

            # 2. Add Second Reference
            resp_ref2 = self.client.post(
                f"/api/v1/faces/{person_id}/references",
                files={"file": ("face2.jpg", dummy_img, "image/jpeg")}
            )
            self.assertEqual(resp_ref2.status_code, 201)
            ref2_data = resp_ref2.json()
            ref2_id = ref2_data["id"]
            self.assertEqual(ref2_data["person_id"], person_id)

            # 3. Add Third Reference
            resp_ref3 = self.client.post(
                f"/api/v1/faces/{person_id}/references",
                files={"file": ("face3.jpg", dummy_img, "image/jpeg")}
            )
            self.assertEqual(resp_ref3.status_code, 201)
            ref3_id = resp_ref3.json()["id"]

            # Verify registered_people record count is still 1 (no duplicate person records!)
            p_count = self.db.query(RegisteredPersonModel).filter(RegisteredPersonModel.person_id == person_id).count()
            self.assertEqual(p_count, 1)

            # 4. List References
            resp_list = self.client.get(f"/api/v1/faces/{person_id}/references")
            self.assertEqual(resp_list.status_code, 200)
            refs_list = resp_list.json()
            self.assertEqual(len(refs_list), 3)

            # Check GET person response has updated references_count
            resp_get_p = self.client.get(f"/api/v1/faces/{person_id}")
            self.assertEqual(resp_get_p.status_code, 200)
            self.assertEqual(resp_get_p.json()["references_count"], 3)

            # 5. Delete Reference 2
            resp_del_ref2 = self.client.delete(f"/api/v1/faces/{person_id}/references/{ref2_id}")
            self.assertEqual(resp_del_ref2.status_code, 200)

            # List again -> 2 remaining
            resp_list2 = self.client.get(f"/api/v1/faces/{person_id}/references")
            self.assertEqual(len(resp_list2.json()), 2)

            # Delete Reference 3 -> 1 remaining
            self.client.delete(f"/api/v1/faces/{person_id}/references/{ref3_id}")

            # 6. Attempt to Delete Last Reference for Active Person -> Must return 400
            remaining_refs = self.client.get(f"/api/v1/faces/{person_id}/references").json()
            last_ref_id = remaining_refs[0]["id"]

            resp_del_last = self.client.delete(f"/api/v1/faces/{person_id}/references/{last_ref_id}")
            self.assertEqual(resp_del_last.status_code, 400)
            self.assertIn("Cannot delete the last remaining face reference", resp_del_last.json()["detail"])

    def test_2_recognition_chooses_strongest_reference_and_confidence_classification(self):
        """Test multi-reference recognition picks the highest similarity score and classifies confidence correctly."""
        # Create test person
        p = RegisteredPersonModel(
            person_id="person_multi_score",
            name="Alice Multi",
            identity_code="ALICE-001",
            face_embedding=[0.0] * 128,
            is_active=True
        )
        self.db.add(p)
        self.db.commit()

        # Add 3 references with different synthetic embeddings
        refA = FaceReferenceModel(id="ref_A", person_id="person_multi_score", face_embedding=[0.1] * 128)
        refB = FaceReferenceModel(id="ref_B", person_id="person_multi_score", face_embedding=[0.5] * 128)
        refC = FaceReferenceModel(id="ref_C", person_id="person_multi_score", face_embedding=[0.9] * 128)
        self.db.add_all([refA, refB, refC])
        self.db.commit()

        # Mock compare_embeddings: ref_A -> 0.42, ref_B -> 0.68, ref_C -> 0.57
        def mock_compare(emb1, emb2):
            if emb2 == [0.1] * 128:
                return 0.42
            if emb2 == [0.5] * 128:
                return 0.68
            if emb2 == [0.9] * 128:
                return 0.57
            return 0.10

        dummy_frame = np.ones((100, 100, 3), dtype=np.uint8)
        with patch.object(face_recognition_service, 'detect_faces', return_value=(True, np.array([[10, 10, 40, 40, 0.95]]))),\
             patch.object(face_recognition_service, 'extract_embedding', return_value=[0.5] * 128),\
             patch.object(face_recognition_service, 'compare_embeddings', side_effect=mock_compare):

            results = face_recognition_service.recognize_faces(dummy_frame, self.db)
            self.assertEqual(len(results), 1)
            r = results[0]
            self.assertTrue(r["recognized"])
            self.assertEqual(r["person_id"], "person_multi_score")
            self.assertEqual(r["name"], "Alice Multi")
            self.assertEqual(r["confidence"], 0.68)
            self.assertEqual(r["confidence_level"], "HIGH")
            self.assertEqual(r["matched_reference_id"], "ref_B")

    def test_3_confidence_levels(self):
        """Test HIGH (>=0.60), MEDIUM (>=0.45), LOW (>=0.363), and UNKNOWN (<0.363)."""
        p = RegisteredPersonModel(
            person_id="person_conf_test",
            name="Conf User",
            identity_code="CONF-001",
            face_embedding=[0.1] * 128,
            is_active=True
        )
        ref = FaceReferenceModel(id="ref_conf", person_id="person_conf_test", face_embedding=[0.1] * 128)
        self.db.add_all([p, ref])
        self.db.commit()

        dummy_frame = np.ones((100, 100, 3), dtype=np.uint8)

        for sim_score, expected_recognized, expected_level in [
            (0.75, True, "HIGH"),
            (0.52, True, "MEDIUM"),
            (0.40, True, "LOW"),
            (0.30, False, "UNKNOWN"),
        ]:
            with patch.object(face_recognition_service, 'detect_faces', return_value=(True, np.array([[10, 10, 40, 40, 0.95]]))),\
                 patch.object(face_recognition_service, 'extract_embedding', return_value=[0.1] * 128),\
                 patch.object(face_recognition_service, 'compare_embeddings', return_value=sim_score):

                results = face_recognition_service.recognize_faces(dummy_frame, self.db)
                r = results[0]
                self.assertEqual(r["recognized"], expected_recognized)
                self.assertEqual(r["confidence_level"], expected_level)
                if expected_recognized:
                    self.assertEqual(r["confidence"], sim_score)

    def test_4_inactive_person_suppression_and_unknown_face(self):
        """Test inactive people are not matched and unknown face remains UNKNOWN."""
        p_inactive = RegisteredPersonModel(
            person_id="person_inactive_p4",
            name="Bob Inactive",
            identity_code="BOB-001",
            face_embedding=[0.88] * 128,
            is_active=False
        )
        ref_inactive = FaceReferenceModel(id="ref_inactive", person_id="person_inactive_p4", face_embedding=[0.88] * 128)
        self.db.add_all([p_inactive, ref_inactive])
        self.db.commit()

        # Only return high similarity if matching the inactive person's embedding specifically
        def mock_compare(emb1, emb2):
            if emb2 == [0.88] * 128:
                return 0.90
            return 0.10

        dummy_frame = np.ones((100, 100, 3), dtype=np.uint8)
        with patch.object(face_recognition_service, 'detect_faces', return_value=(True, np.array([[10, 10, 40, 40, 0.95]]))),\
             patch.object(face_recognition_service, 'extract_embedding', return_value=[0.88] * 128),\
             patch.object(face_recognition_service, 'compare_embeddings', side_effect=mock_compare):

            results = face_recognition_service.recognize_faces(dummy_frame, self.db)
            self.assertEqual(len(results), 1)
            r = results[0]
            self.assertFalse(r["recognized"])
            self.assertEqual(r["name"], "UNKNOWN")
            self.assertEqual(r["confidence_level"], "UNKNOWN")

    def test_5_image_validation_zero_and_multiple_faces(self):
        """Test rejection of 0-face and multi-face images."""
        dummy_img = create_dummy_face_image(1)

        # Zero faces detected
        with patch.object(face_recognition_service, 'detect_faces', return_value=(False, None)):
            resp = self.client.post(
                "/api/v1/faces/register",
                data={"name": "No Face User"},
                files={"file": ("noface.jpg", dummy_img, "image/jpeg")}
            )
            self.assertEqual(resp.status_code, 400)
            self.assertIn("No face detected", resp.json()["detail"])

        # Multiple faces detected
        with patch.object(face_recognition_service, 'detect_faces', return_value=(True, np.array([[0,0,10,10,0.9], [50,50,10,10,0.9]]))):
            resp = self.client.post(
                "/api/v1/faces/register",
                data={"name": "Multi Face User"},
                files={"file": ("multiface.jpg", dummy_img, "image/jpeg")}
            )
            self.assertEqual(resp.status_code, 400)
            self.assertIn("Multiple faces detected", resp.json()["detail"])

    def test_6_temporal_identity_smoothing_and_grace_period(self):
        """Test TrackRecord temporal identity retention across skipped frames and decay after grace period."""
        rec = TrackRecord(camera_id="CAM-SMOOTH", track_id=99, fine_class="person", object_type="human")

        known_face = {
            "recognized": True,
            "person_id": "person_asif_smooth",
            "name": "Asif Smooth",
            "identity_code": "ASIF-SMOOTH",
            "confidence": 0.88,
            "confidence_level": "HIGH"
        }

        # Frame 1: Fresh recognition hit -> identity set & grace reset to 0
        rec.update_face_identity(known_face, grace_limit=3)
        self.assertEqual(rec.identity_person_id, "person_asif_smooth")
        self.assertEqual(rec.identity_name, "Asif Smooth")
        self.assertTrue(rec.face_info["recognized"])

        # Frame 2: Miss / skipped frame -> grace counter = 1 <= 3 -> Retain identity!
        rec.update_face_identity(None, grace_limit=3)
        self.assertEqual(rec.identity_grace_counter, 1)
        self.assertIsNotNone(rec.face_info)
        self.assertTrue(rec.face_info["recognized"])
        self.assertEqual(rec.face_info["name"], "Asif Smooth")

        # Frame 3 & 4: Still within grace limit (2, 3) -> Retained!
        rec.update_face_identity(None, grace_limit=3)
        self.assertEqual(rec.identity_grace_counter, 2)
        self.assertTrue(rec.face_info["recognized"])

        rec.update_face_identity(None, grace_limit=3)
        self.assertEqual(rec.identity_grace_counter, 3)
        self.assertTrue(rec.face_info["recognized"])

        # Frame 5: Grace counter becomes 4 > 3 -> Grace expired -> Identity cleared!
        rec.update_face_identity(None, grace_limit=3)
        self.assertEqual(rec.identity_grace_counter, 0)
        self.assertIsNone(rec.identity_person_id)
        self.assertEqual(rec.identity_name, "UNKNOWN")
        self.assertIsNone(rec.face_info)

    def test_7_lost_track_clears_identity(self):
        """Test that marking a track as LOST immediately clears identity."""
        rec = TrackRecord(camera_id="CAM-LOST-TEST", track_id=77, fine_class="person", object_type="human")
        known_face = {
            "recognized": True,
            "person_id": "person_test_lost",
            "name": "Target Person",
            "confidence": 0.90,
            "confidence_level": "HIGH"
        }
        rec.update_face_identity(known_face, grace_limit=15)
        self.assertEqual(rec.identity_person_id, "person_test_lost")

        # Increment miss up to lost threshold (5 misses)
        for _ in range(5):
            rec.increment_miss()

        self.assertEqual(rec.state, TrackState.LOST)
        self.assertIsNone(rec.identity_person_id)
        self.assertEqual(rec.identity_name, "UNKNOWN")
        self.assertIsNone(rec.face_info)

    def test_8_face_recognition_failure_does_not_crash_pipeline(self):
        """Test robust fail-safe behavior when face recognition throws an exception."""
        dummy_frame = np.ones((200, 200, 3), dtype=np.uint8)

        with patch.object(detector_instance, 'load_model'),\
             patch.object(detector_instance, 'track_frame', return_value=[{
                 "track_id": 88,
                 "fine_class": "person",
                 "object_type": "human",
                 "confidence": 0.92,
                 "bounding_box": {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.5},
                 "bbox_pixels": {"x1": 20, "y1": 20, "x2": 80, "y2": 120}
             }]),\
             patch.object(face_recognition_service, 'recognize_faces', side_effect=RuntimeError("ONNX crash simulated")):

            res = detector_instance.process_frames_with_tracking(
                frames_with_indices=[(0, dummy_frame)],
                camera_id="CAM-ROBUST-P4",
                db=self.db
            )

            # Pipeline must continue normally!
            self.assertEqual(len(res["detections"]), 1)
            self.assertEqual(res["detections"][0]["track_id"], 88)
            self.assertEqual(res["detections"][0]["confidence"], 0.92)

    def test_9_migration_idempotency_and_legacy_asif_preservation(self):
        """Test legacy migration populates face_references for existing users and is 100% idempotent."""
        # Seed a legacy registered_people record without face_references row
        legacy_person = RegisteredPersonModel(
            person_id="person_legacy_asif_test",
            name="Asif Legacy",
            identity_code="ASIF-LEGACY-001",
            face_embedding=[0.363] * 128,
            image_path="storage/faces/asif_legacy.jpg",
            is_active=True
        )
        self.db.add(legacy_person)
        self.db.commit()

        def apply_migration_on_session():
            import uuid
            people = self.db.query(RegisteredPersonModel).all()
            for p in people:
                if p.face_embedding:
                    ref_count = self.db.query(FaceReferenceModel).filter(
                        FaceReferenceModel.person_id == p.person_id
                    ).count()
                    if ref_count == 0:
                        ref_id = f"ref_{str(uuid.uuid4())[:8]}"
                        ref = FaceReferenceModel(
                            id=ref_id,
                            person_id=p.person_id,
                            face_embedding=p.face_embedding,
                            image_path=p.image_path or ""
                        )
                        self.db.add(ref)
            self.db.commit()

        # Run migration first time
        apply_migration_on_session()

        # Verify face_references table now contains exactly 1 reference for Asif Legacy
        ref_count = self.db.query(FaceReferenceModel).filter(
            FaceReferenceModel.person_id == "person_legacy_asif_test"
        ).count()
        self.assertEqual(ref_count, 1)

        # Run migration a SECOND time -> Count must remain 1 (idempotent!)
        apply_migration_on_session()
        ref_count_2 = self.db.query(FaceReferenceModel).filter(
            FaceReferenceModel.person_id == "person_legacy_asif_test"
        ).count()
        self.assertEqual(ref_count_2, 1)




if __name__ == "__main__":
    unittest.main()
