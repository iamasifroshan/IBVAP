import unittest
import sys
import os
import cv2
import numpy as np
from datetime import datetime

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, Base, engine
from database.models import IncidentModel, EvidenceModel
from ai.evidence_generator import evidence_generator, EvidenceGenerator, EVIDENCE_DIR


class TestEvidenceGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.db = SessionLocal()
        cls.test_video_path = os.path.join(EVIDENCE_DIR, "test_synth_feed.mp4")

        # Create a synthetic 5-second 30fps MP4 video file for testing
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(cls.test_video_path, fourcc, 30.0, (640, 480))
        for i in range(150):
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            # Draw moving white circle to simulate target
            cv2.circle(frame, (100 + i * 2, 200), 20, (255, 255, 255), -1)
            writer.write(frame)
        writer.release()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()
        if os.path.exists(cls.test_video_path):
            os.remove(cls.test_video_path)

    def setUp(self):
        self.db.query(EvidenceModel).delete()
        self.db.query(IncidentModel).delete()
        self.db.commit()

    def test_snapshot_creation(self):
        """
        Test annotated snapshot generation with bounding box overlay and hash verification.
        """
        inc = IncidentModel(
            incident_id="INC-EVID-TEST-01",
            camera_id="BORDER-CAM-07",
            track_id="TRK#99",
            object_type="human",
            zone_name="Sector B Zero-Tolerance Zone",
            smart_alert_confirmed=True,
            explainable_reason="Test evidence snapshot generation",
            timestamp=datetime.utcnow()
        )
        self.db.add(inc)
        self.db.commit()

        bbox = {"x": 0.2, "y": 0.3, "width": 0.15, "height": 0.4}

        snap_url = EvidenceGenerator.create_snapshot(
            video_path=self.test_video_path,
            frame_index=50,
            incident=inc,
            bounding_box=bbox,
            confidence=0.94,
            db=self.db
        )

        self.assertIsNotNone(snap_url)
        self.assertIn("/storage/evidence/", snap_url)

        # Verify DB evidence record
        records = self.db.query(EvidenceModel).filter(EvidenceModel.incident_id == inc.incident_id).all()
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].evidence_type, "snapshot")
        self.assertIsNotNone(records[0].sha256_hash)
        self.assertTrue(os.path.exists(records[0].file_path))

    def test_video_clip_creation(self):
        """
        Test short video clip extraction with pre-event buffering.
        """
        inc = IncidentModel(
            incident_id="INC-EVID-TEST-02",
            camera_id="BORDER-CAM-07",
            track_id="TRK#100",
            object_type="human",
            zone_name="Sector B Zero-Tolerance Zone",
            smart_alert_confirmed=True,
            explainable_reason="Test video clip generation",
            timestamp=datetime.utcnow()
        )
        self.db.add(inc)
        self.db.commit()

        clip_url = EvidenceGenerator.create_video_clip(
            video_path=self.test_video_path,
            frame_index=60,
            incident=inc,
            db=self.db
        )

        self.assertIsNotNone(clip_url)
        self.assertIn("/storage/evidence/", clip_url)

        # Verify DB evidence record
        records = self.db.query(EvidenceModel).filter(
            EvidenceModel.incident_id == inc.incident_id,
            EvidenceModel.evidence_type == "clip"
        ).all()
        self.assertEqual(len(records), 1)
        self.assertTrue(os.path.exists(records[0].file_path))


if __name__ == "__main__":
    unittest.main()
