import unittest
import sys
import os
from datetime import datetime

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.db import SessionLocal, Base, engine
from database.models import IncidentModel, SyncJobModel
from ai.edge_sync import edge_sync, EdgeSyncEngine


class TestEdgeSyncEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)
        cls.db = SessionLocal()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        self.db.query(SyncJobModel).delete()
        self.db.query(IncidentModel).delete()
        self.db.commit()
        # Reset connectivity to False (disconnected)
        edge_sync.set_connectivity(False)

    def test_offline_incident_creation_and_sync_lifecycle(self):
        """
        Full test cycle:
        1. Disable central sync (Edge Node offline).
        2. Create local incident -> confirm saved locally with sync_status="unsynced".
        3. Confirm SyncJobModel created in SQLite with status="unsynced".
        4. Enable central sync.
        5. Run process_queue -> verify transition to status="synced" and IncidentModel.synced_to_cloud=True.
        6. Re-run process_queue -> verify duplicate sync is prevented.
        """
        # Step 1: Disable central sync
        self.assertFalse(edge_sync.is_connected())

        # Step 2: Create local incident
        inc = IncidentModel(
            incident_id="INC-OFFLINE-TEST-01",
            camera_id="BORDER-CAM-01",
            track_id="TRK#201",
            object_type="human",
            zone_name="Sector B Restricted Zone",
            smart_alert_confirmed=True,
            explainable_reason="Local edge detection while offline",
            timestamp=datetime.utcnow()
        )
        self.db.add(inc)
        self.db.commit()

        # Step 3: Enqueue incident
        job = edge_sync.enqueue_incident(inc, self.db)
        self.assertIsNotNone(job)
        self.assertEqual(job.status, "unsynced")
        self.assertEqual(inc.sync_status, "unsynced")
        self.assertFalse(inc.synced_to_cloud)

        # Step 4: Attempt sync while offline -> Should fail gracefully without changing job state
        offline_res = edge_sync.process_queue(self.db)
        self.assertFalse(offline_res["success"])
        self.assertEqual(offline_res["processed_count"], 0)
        self.assertEqual(job.status, "unsynced")

        # Step 5: Restore Central Connectivity
        edge_sync.set_connectivity(True)
        self.assertTrue(edge_sync.is_connected())

        # Step 6: Process sync queue -> Should transition UNSYNCED -> QUEUED -> SYNCING -> SYNCED
        online_res = edge_sync.process_queue(self.db)
        self.assertTrue(online_res["success"])
        self.assertEqual(online_res["processed_count"], 1)

        # Step 7: Verify final database state
        self.db.refresh(job)
        self.db.refresh(inc)
        self.assertEqual(job.status, "synced")
        self.assertIsNotNone(job.synced_at)
        self.assertTrue(inc.synced_to_cloud)
        self.assertEqual(inc.sync_status, "synced")

        # Step 8: Verify duplicate sync prevention
        dup_res = edge_sync.process_queue(self.db)
        self.assertTrue(dup_res["success"])
        self.assertEqual(dup_res["processed_count"], 0)


if __name__ == "__main__":
    unittest.main()
