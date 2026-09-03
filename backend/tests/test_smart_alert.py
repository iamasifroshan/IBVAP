import unittest
import sys
import os
from datetime import datetime

# Add parent directories to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, Base, engine
from database.models import IncidentModel, DetectionModel
from ai.smart_alert import smart_alert_service, SmartAlertConfig


class TestSmartAlertDecisionEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.db = SessionLocal()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        # Clean up database tables for clean test runs
        self.db.query(IncidentModel).delete()
        self.db.query(DetectionModel).delete()
        self.db.commit()

    def test_transient_noise_suppression(self):
        """
        Scenario A: Single-frame transient flicker (flicker detected in 1 frame)
        → Should not create a confirmed alert.
        """
        is_confirmed, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="BORDER-CAM-07",
            track_id=200,
            fine_class="person",
            object_type="human",
            confidence=0.85,
            frames_seen=1,  # < min_valid_frames (3)
            is_inside_zone=True,
            zone_name="Sector B Zero-Tolerance Zone",
            is_first_entry=True,
            db=self.db,
            bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertFalse(is_confirmed)
        self.assertEqual(checks["rule3_multiframe_persistence"]["status"], "SUPPRESSED_TRANSIENT_NOISE")
        self.assertIn("Transient Noise", reason)

    def test_out_of_zone_suppression(self):
        """
        Scenario B: Persistent person detected, but outside restricted zone.
        → Should not create a confirmed alert.
        """
        is_confirmed, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="BORDER-CAM-07",
            track_id=201,
            fine_class="person",
            object_type="human",
            confidence=0.90,
            frames_seen=5,  # Persistent
            is_inside_zone=False,  # Outside virtual fence
            zone_name="Sector B Buffer Strip",
            is_first_entry=True,
            db=self.db,
            bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertFalse(is_confirmed)
        self.assertEqual(checks["rule4_virtual_fence_relevance"]["status"], "FAILED")
        self.assertIn("Failed validation rules", reason)

    def test_real_zone_crossing_and_duplicate_suppression(self):
        """
        Scenario C: Confirmed object enters restricted zone
        → Should confirm incident and store explanation.
        
        Scenario D: Same confirmed object tries to alert again within the duplicate suppression window
        → Should suppress duplicate alert.
        """
        camera_id = "BORDER-CAM-07"
        track_id = 202
        zone_name = "Sector B Zero-Tolerance Zone"

        # 1. First crossing (confirmed incident)
        is_confirmed, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id=camera_id,
            track_id=track_id,
            fine_class="person",
            object_type="human",
            confidence=0.92,
            frames_seen=4,  # Persistent
            is_inside_zone=True,  # Inside
            zone_name=zone_name,
            is_first_entry=True,
            db=self.db,
            bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertTrue(is_confirmed)
        self.assertEqual(checks["decision"], "CONFIRMED_INCIDENT")
        self.assertIn("CONFIRMED", reason)

        # Store confirmed incident in database (similar to fence_engine flow)
        inc = IncidentModel(
            incident_id=f"INC-TEST-TRK{track_id}",
            camera_id=camera_id,
            track_id=f"TRK#{track_id}",
            object_type="human",
            zone_name=zone_name,
            smart_alert_confirmed=True,
            explainable_reason=reason,
            timestamp=datetime.utcnow()
        )
        self.db.add(inc)
        self.db.commit()

        # 2. Try same object immediately again (Duplicate check)
        is_confirmed_dup, checks_dup, reason_dup, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id=camera_id,
            track_id=track_id,
            fine_class="person",
            object_type="human",
            confidence=0.92,
            frames_seen=5,
            is_inside_zone=True,
            zone_name=zone_name,
            is_first_entry=True,
            db=self.db,
            bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertFalse(is_confirmed_dup)
        self.assertEqual(checks_dup["rule5_duplicate_suppression"]["status"], "SUPPRESSED_DUPLICATE")
        self.assertIn("SUPPRESSED (Duplicate)", reason_dup)

    def test_bbox_geometry_suppression(self):
        """
        Scenario E: False positive YOLO background detection (cloud/sky).
        Bounding box is too large, too small, or extremely wide/thin.
        """
        camera_id = "BORDER-CAM-07"
        track_id = 203
        zone_name = "Sector B Zero-Tolerance Zone"

        # 1. Bbox too small (area < 0.0025)
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id=camera_id, track_id=track_id, fine_class="person", object_type="human",
            confidence=0.90, frames_seen=5, is_inside_zone=True, zone_name=zone_name, is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.02, "height": 0.05}, # area 0.001
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule6_bbox_quality"]["status"], "SUPPRESSED_BACKGROUND_NOISE")

        # 2. Bbox too wide (aspect ratio < 0.35)
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id=camera_id, track_id=track_id, fine_class="person", object_type="human",
            confidence=0.90, frames_seen=5, is_inside_zone=True, zone_name=zone_name, is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.3, "height": 0.1}, # aspect 3.0
            face_metadata={"confidence": 0.8, "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule6_bbox_quality"]["status"], "SUPPRESSED_BACKGROUND_NOISE")

    def test_path_b_face_unavailable_suppression(self):
        """
        Scenario F: YOLO person + face unavailable (no face/turned away/occluded) -> 0 incidents
        """
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM1", track_id=204, fine_class="person", object_type="human",
            confidence=0.88, frames_seen=20, is_inside_zone=True, zone_name="Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"identity_status": "FACE_UNAVAILABLE", "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule7_identity_verification"]["status"], "SUPPRESSED_FACE_UNAVAILABLE")

    def test_face_processing_error_suppression(self):
        """
        Scenario G: YOLO person + face processing error -> 0 incidents
        """
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM1", track_id=205, fine_class="person", object_type="human",
            confidence=0.88, frames_seen=20, is_inside_zone=True, zone_name="Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"identity_status": "FACE_PROCESSING_ERROR", "recognized": False}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule7_identity_verification"]["status"], "SUPPRESSED_FACE_PROCESSING_ERROR")

    def test_confirmed_unknown_person_success(self):
        """
        Scenario H: YOLO person + face detected + SFace completed with NO MATCH -> 1 incident
        """
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM1", track_id=206, fine_class="person", object_type="human",
            confidence=0.90, frames_seen=10, is_inside_zone=True, zone_name="Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"identity_status": "UNKNOWN", "confidence": 0.35, "recognition_confidence": 0.35, "recognized": False}
        )
        self.assertTrue(is_conf)
        self.assertIn("UNKNOWN (Face Verified)", reason)

    def test_path_a_known_person(self):
        """
        Scenario I: Known person with face -> 0 incidents
        """
        is_conf, checks, reason, pn, fr, fc = smart_alert_service.validate_candidate_event(
            camera_id="CAM1", track_id=207, fine_class="person", object_type="human",
            confidence=0.88, frames_seen=20, is_inside_zone=True, zone_name="Zone", is_first_entry=True,
            db=self.db, bbox={"x": 0.5, "y": 0.5, "width": 0.1, "height": 0.2},
            face_metadata={"identity_status": "KNOWN", "confidence": 0.95, "recognition_confidence": 0.95, "recognized": True, "name": "ASIF"}
        )
        self.assertFalse(is_conf)
        self.assertEqual(checks["rule7_identity_verification"]["status"], "SUPPRESSED_KNOWN_PERSON")

if __name__ == "__main__":
    unittest.main()
