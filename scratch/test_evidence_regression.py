import sys
import os
import unittest
import urllib.request
import json
from datetime import datetime, timezone
import cv2
import numpy as np

# Use memory database for isolated model tests
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, 'backend')
from database.db import Base
from database.models import IncidentModel, EvidenceModel
from ai.evidence_generator import EvidenceGenerator, EVIDENCE_DIR
from api.incidents import normalize_snapshot_url

class TestEvidenceRegression(unittest.TestCase):
    def setUp(self):
        # Isolated in-memory database - NEVER touch real DB
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_normalize_snapshot_url(self):
        """Test URL normalization handles bare filenames, Windows paths, and relative paths."""
        self.assertEqual(normalize_snapshot_url(""), "")
        self.assertEqual(normalize_snapshot_url("http://localhost:8000/test.jpg"), "http://localhost:8000/test.jpg")
        self.assertEqual(normalize_snapshot_url("https://cdn.example.com/test.jpg"), "https://cdn.example.com/test.jpg")
        self.assertEqual(normalize_snapshot_url("webcam_evidence_123.jpg"), "/storage/evidence/webcam_evidence_123.jpg")
        self.assertEqual(normalize_snapshot_url("storage/evidence/snap.jpg"), "/storage/evidence/snap.jpg")
        self.assertEqual(normalize_snapshot_url("/storage/evidence/snap.jpg"), "/storage/evidence/snap.jpg")
        self.assertEqual(normalize_snapshot_url("E:\\IBVAP\\backend\\storage\\evidence\\snap.jpg"), "/storage/evidence/snap.jpg")
        self.assertEqual(normalize_snapshot_url("C:\\some\\folder\\snap.jpg"), "/storage/evidence/snap.jpg")

    def test_isolated_evidence_creation_and_linkage(self):
        """Test creating evidence with hash and DB linkage in memory."""
        test_video = os.path.join(EVIDENCE_DIR, "test_synth_unit.mp4")
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(test_video, fourcc, 30.0, (320, 240))
        for _ in range(10):
            writer.write(np.zeros((240, 320, 3), dtype=np.uint8))
        writer.release()

        try:
            inc = IncidentModel(
                incident_id="INC-UNIT-TEST-99",
                camera_id="BORDER-CAM-07",
                track_id="TRK#99",
                object_type="human",
                smart_alert_confirmed=True,
                timestamp=datetime.now(timezone.utc)
            )
            self.db.add(inc)
            self.db.commit()

            snap_url = EvidenceGenerator.create_snapshot(
                video_path=test_video,
                frame_index=2,
                incident=inc,
                bounding_box={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
                confidence=0.95,
                db=self.db
            )
            self.assertIsNotNone(snap_url)
            self.assertTrue(snap_url.startswith("/storage/evidence/"))

            records = self.db.query(EvidenceModel).filter(EvidenceModel.incident_id == inc.incident_id).all()
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].evidence_type, "snapshot")
            self.assertIsNotNone(records[0].sha256_hash)
            self.assertTrue(os.path.exists(records[0].file_path))

            # Clean up generated test snapshot file
            if os.path.exists(records[0].file_path):
                os.remove(records[0].file_path)
        finally:
            if os.path.exists(test_video):
                os.remove(test_video)

    def test_live_backend_incident_and_evidence_endpoints(self):
        """Test live FastAPI endpoints on localhost:8000 for incidents and evidence."""
        req = urllib.request.Request("http://localhost:8000/api/v1/incidents")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode())
            self.assertIsInstance(data, list)
            self.assertGreater(len(data), 0)

            # Find an incident with a snapshot
            inc_with_snap = next((i for i in data if i.get("snapshotUrl")), None)
            self.assertIsNotNone(inc_with_snap, "Should have at least one incident with a snapshot")
            snap_url = inc_with_snap["snapshotUrl"]
            self.assertTrue(snap_url.startswith("/storage/evidence/"))

            # Test fetching the incident's evidence list endpoint
            inc_id = inc_with_snap["id"]
            ev_req = urllib.request.Request(f"http://localhost:8000/api/v1/incidents/{inc_id}/evidence")
            with urllib.request.urlopen(ev_req) as ev_resp:
                self.assertEqual(ev_resp.status, 200)

            # Test fetching the physical image
            full_img_url = f"http://localhost:8000{snap_url}"
            img_req = urllib.request.Request(full_img_url)
            with urllib.request.urlopen(img_req) as img_resp:
                self.assertEqual(img_resp.status, 200)
                self.assertEqual(img_resp.headers.get("Content-Type"), "image/jpeg")
                raw = img_resp.read()
                self.assertGreater(len(raw), 0)
                self.assertEqual(raw[:2], b'\xff\xd8') # Valid JPEG

if __name__ == "__main__":
    unittest.main()
