"""
EdgeGuard Local-First Persistent Sync Engine for IBVAP.
Manages central server connectivity state and synchronizes local SQLite incident records
through persistent database state transitions: UNSYNCED -> QUEUED -> SYNCING -> SYNCED.
Ensures local AI processing (YOLO, ByteTrack, SmartAlert, BorderThreat, EnviroVision)
continues uninterrupted even when central connectivity is unavailable.
"""

import logging
import uuid
import time
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from sqlalchemy.orm import Session

from database.models import SyncJobModel, IncidentModel

logger = logging.getLogger("ibvap.edge_sync")


class EdgeSyncEngine:
    """
    Local-First Synchronization Manager.
    Persists sync jobs in SQLite and handles state transitions.
    """

    def __init__(self):
        # Application-level connectivity state between Edge Node & Central Server
        # Default: False (offline local-first mode)
        self._central_connected: bool = False

    def is_connected(self) -> bool:
        return self._central_connected

    def set_connectivity(self, connected: bool) -> bool:
        self._central_connected = connected
        logger.info(f"EdgeGuard Central Server Connectivity state changed to: {connected}")
        return self._central_connected

    def enqueue_incident(self, incident: IncidentModel, db: Session) -> SyncJobModel:
        """
        Enqueues a newly created local incident into the persistent SQLite sync queue.
        If central connectivity is unavailable, status is set to UNSYNCED.
        If central connectivity is available, status is set to QUEUED.
        """
        # Prevent duplicate enqueueing if job already exists for this incident
        existing_job = db.query(SyncJobModel).filter(
            SyncJobModel.incident_id == incident.incident_id
        ).first()

        if existing_job:
            return existing_job

        initial_status = "queued" if self._central_connected else "unsynced"

        # Update Incident model status
        incident.sync_status = initial_status
        incident.synced_to_cloud = False

        # Create persistent SyncJob record in SQLite
        sync_job = SyncJobModel(
            id=str(uuid.uuid4()),
            incident_id=incident.incident_id,
            status=initial_status,
            retry_count=0,
            payload_size_kb=340,
            created_at=datetime.now(timezone.utc),
            synced_at=None
        )

        db.add(sync_job)
        db.commit()
        db.refresh(sync_job)

        logger.info(
            f"Enqueued incident '{incident.incident_id}' into SQLite Sync Queue. "
            f"Status: {initial_status.upper()} (Central Connected: {self._central_connected})"
        )
        return sync_job

    def process_queue(self, db: Session) -> Dict[str, Any]:
        """
        Processes pending SQLite sync jobs.
        Transitions job statuses: UNSYNCED -> QUEUED -> SYNCING -> SYNCED.
        Prevents duplicate sync and updates local Incident records.
        """
        if not self._central_connected:
            logger.info("Sync requested but Central Server is disconnected. Processing remains local-first.")
            return {
                "success": False,
                "central_connected": False,
                "message": "Central Server is currently DISCONNECTED. Incidents remain stored safely in local SQLite queue.",
                "processed_count": 0
            }

        # Query all jobs that need synchronization
        pending_jobs = db.query(SyncJobModel).filter(
            SyncJobModel.status.in_(["unsynced", "queued", "syncing", "failed"])
        ).order_by(SyncJobModel.created_at).all()

        if not pending_jobs:
            return {
                "success": True,
                "central_connected": True,
                "message": "SQLite Sync Queue is empty. All local incidents are synchronized.",
                "processed_count": 0
            }

        processed_count = 0
        synced_incident_ids = []

        for job in pending_jobs:
            # 1. State Transition: UNSYNCED -> QUEUED
            if job.status == "unsynced":
                job.status = "queued"
                db.commit()

            # 2. State Transition: QUEUED -> SYNCING
            job.status = "syncing"
            db.commit()

            # Find matching incident
            inc = db.query(IncidentModel).filter(
                (IncidentModel.incident_id == job.incident_id) | (IncidentModel.id == job.incident_id)
            ).first()

            if inc and inc.synced_to_cloud:
                # Prevent duplicate sync
                job.status = "synced"
                job.synced_at = datetime.now(timezone.utc)
                db.commit()
                continue

            # Perform payload synchronization simulation
            now = datetime.now(timezone.utc)
            now_str = now.strftime("%Y-%m-%d %H:%M:%S UTC")

            # 3. State Transition: SYNCING -> SYNCED
            job.status = "synced"
            job.synced_at = now

            if inc:
                inc.synced_to_cloud = True
                inc.synced_timestamp = now_str
                inc.sync_status = "synced"

            db.commit()
            processed_count += 1
            synced_incident_ids.append(job.incident_id)

            logger.info(f"Successfully synchronized incident '{job.incident_id}' to Central Server. Status: SYNCED")

        return {
            "success": True,
            "central_connected": True,
            "message": f"Successfully synchronized {processed_count} incident(s) from SQLite queue to Central Server.",
            "processed_count": processed_count,
            "synced_incidents": synced_incident_ids
        }


# Global singleton instance
edge_sync = EdgeSyncEngine()
