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
        is_confirmed, checks, reason = smart_alert_service.validate_candidate_event(
            camera_id="BORDER-CAM-07",
            track_id=200,
            fine_class="person",
            object_type="human",
            confidence=0.85,
            frames_seen=1,  # < min_valid_frames (3)
            is_inside_zone=True,
            zone_name="Sector B Zero-Tolerance Zone",
            is_first_entry=True,
            db=self.db
        )
        self.assertFalse(is_confirmed)
        self.assertEqual(checks["rule3_multiframe_persistence"]["status"], "SUPPRESSED_TRANSIENT_NOISE")
        self.assertIn("Transient Noise", reason)

    def test_out_of_zone_suppression(self):
        """
        Scenario B: Persistent person detected, but outside restricted zone.
        → Should not create a confirmed alert.
        """
        is_confirmed, checks, reason = smart_alert_service.validate_candidate_event(
            camera_id="BORDER-CAM-07",
            track_id=201,
            fine_class="person",
            object_type="human",
            confidence=0.90,
            frames_seen=5,  # Persistent
            is_inside_zone=False,  # Outside virtual fence
            zone_name="Sector B Buffer Strip",
            is_first_entry=True,
            db=self.db
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
        is_confirmed, checks, reason = smart_alert_service.validate_candidate_event(
            camera_id=camera_id,
            track_id=track_id,
            fine_class="person",
            object_type="human",
            confidence=0.92,
            frames_seen=4,  # Persistent
            is_inside_zone=True,  # Inside
            zone_name=zone_name,
            is_first_entry=True,
            db=self.db
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
        is_confirmed_dup, checks_dup, reason_dup = smart_alert_service.validate_candidate_event(
            camera_id=camera_id,
            track_id=track_id,
            fine_class="person",
            object_type="human",
            confidence=0.92,
            frames_seen=5,
            is_inside_zone=True,
            zone_name=zone_name,
            is_first_entry=True,
            db=self.db
        )
        self.assertFalse(is_confirmed_dup)
        self.assertEqual(checks_dup["rule5_duplicate_suppression"]["status"], "SUPPRESSED_DUPLICATE")
        self.assertIn("SUPPRESSED (Duplicate)", reason_dup)


if __name__ == "__main__":
    unittest.main()
