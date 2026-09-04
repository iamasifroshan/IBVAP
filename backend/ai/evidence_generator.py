"""
Evidence Generation Service for IBVAP.
Generates real detection snapshots with target bounding box overlays, labels, and watermarks,
extracts ~5s pre-event/post-event MP4 video clips, calculates SHA-256 hashes,
and persists Evidence records into SQLite.
"""

import os
import cv2
import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session

from database.models import EvidenceModel, IncidentModel

logger = logging.getLogger("ibvap.evidence_generator")

STORAGE_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE_DIR = os.path.join(STORAGE_BASE, "storage", "evidence")
os.makedirs(EVIDENCE_DIR, exist_ok=True)


class EvidenceGenerator:
    """
    Generates real image snapshots and video clips for security incidents.
    """

    @staticmethod
    def generate_incident_evidence(
        video_path: str,
        frame_index: int,
        incident: IncidentModel,
        bounding_box: Dict[str, float],
        confidence: float,
        db: Session
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Generates snapshot and MP4 video clip for a confirmed incident.

        Returns:
          (snapshot_relative_url: str, clip_relative_url: str)
        """
        if not video_path or not os.path.exists(video_path):
            logger.warning(f"Video file '{video_path}' not found. Cannot extract evidence.")
            return None, None

        snapshot_url = EvidenceGenerator.create_snapshot(
            video_path=video_path,
            frame_index=frame_index,
            incident=incident,
            bounding_box=bounding_box,
            confidence=confidence,
            db=db
        )

        clip_url = EvidenceGenerator.create_video_clip(
            video_path=video_path,
            frame_index=frame_index,
            incident=incident,
            db=db
        )

        if snapshot_url:
            incident.snapshot_url = snapshot_url
            db.commit()

        return snapshot_url, clip_url

    @staticmethod
    def create_snapshot(
        video_path: str,
        frame_index: int,
        incident: IncidentModel,
        bounding_box: Dict[str, float],
        confidence: float,
        db: Session
    ) -> Optional[str]:
        """
        Extracts the target frame, draws red bounding box overlay and watermark,
        saves JPEG image, calculates SHA-256 hash, and inserts EvidenceModel record.
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None

        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            logger.warning(f"Failed to read frame #{frame_index} from '{video_path}'")
            return None

        h_img, w_img = frame.shape[:2]

        # Draw Target Bounding Box Overlay if coordinates exist
        if bounding_box:
            bx = bounding_box.get("x", 0.0)
            by = bounding_box.get("y", 0.0)
            bw = bounding_box.get("width", 0.0)
            bh = bounding_box.get("height", 0.0)

            # Convert normalized 0.0-1.0 to pixel coordinates
            x1 = int(bx * w_img) if bx <= 1.0 else int(bx)
            y1 = int(by * h_img) if by <= 1.0 else int(by)
            x2 = int((bx + bw) * w_img) if bx <= 1.0 else int(bx + bw)
            y2 = int((by + bh) * h_img) if by <= 1.0 else int(by + bh)

            # Clamp coordinates to frame boundaries
            x1 = max(0, min(w_img - 1, x1))
            y1 = max(0, min(h_img - 1, y1))
            x2 = max(x1 + 5, min(w_img - 1, x2))
            y2 = max(y1 + 5, min(h_img - 1, y2))

            # Red bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 230), 2)

            # Header tag label box
            label_text = f"{incident.object_type.upper()} {incident.track_id} | CONF: {int(confidence * 100)}%"
            (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            label_y1 = max(0, y1 - th - 6)
            cv2.rectangle(frame, (x1, label_y1), (x1 + tw + 8, y1), (0, 0, 230), -1)
            cv2.putText(frame, label_text, (x1 + 4, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

        # Watermark Header
        watermark = f"EVIDENCE SNAPSHOT RAW | INCIDENT: {incident.incident_id} | FRAME #{frame_index:05d}"
        cv2.putText(frame, watermark, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)

        # Save snapshot file locally
        filename = f"{incident.incident_id}_snapshot.jpg"
        file_path = os.path.join(EVIDENCE_DIR, filename)
        cv2.imwrite(file_path, frame)

        # Compute SHA-256 hash
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256.update(chunk)
        sha256_hash = sha256.hexdigest()

        # Insert Evidence DB record
        db_ev = EvidenceModel(
            id=str(uuid.uuid4()),
            incident_id=incident.incident_id,
            evidence_type="snapshot",
            file_path=file_path,
            sha256_hash=sha256_hash,
            created_at=datetime.now(timezone.utc)
        )
        db.add(db_ev)
        db.commit()

        relative_url = f"/storage/evidence/{filename}"
        logger.info(f"Generated snapshot evidence for {incident.incident_id}: {file_path}")
        return relative_url

    @staticmethod
    def create_video_clip(
        video_path: str,
        frame_index: int,
        incident: IncidentModel,
        db: Session
    ) -> Optional[str]:
        """
        Extracts a ~5s incident clip around the intrusion frame.

        Buffering Note:
        When processing video files without rolling circular RAM buffers,
        pre-event frames are captured by seeking backwards by `max(0, frame_index - int(fps * 2))` frames.
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Seek backwards 2 seconds for pre-event buffer
        pre_event_frames = int(fps * 2.0)
        start_frame = max(0, frame_index - pre_event_frames)
        total_clip_frames = int(fps * 5.0)  # 5 second clip

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        filename = f"{incident.incident_id}_clip.mp4"
        file_path = os.path.join(EVIDENCE_DIR, filename)

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(file_path, fourcc, fps, (width, height))

        written_count = 0
        while cap.isOpened() and written_count < total_clip_frames:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            writer.write(frame)
            written_count += 1

        writer.release()
        cap.release()

        if written_count == 0 or not os.path.exists(file_path):
            return None

        # Calculate SHA-256 hash of clip
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256.update(chunk)
        sha256_hash = sha256.hexdigest()

        # Insert Evidence DB record
        db_ev = EvidenceModel(
            id=str(uuid.uuid4()),
            incident_id=incident.incident_id,
            evidence_type="clip",
            file_path=file_path,
            sha256_hash=sha256_hash,
            created_at=datetime.now(timezone.utc)
        )
        db.add(db_ev)
        db.commit()

        relative_url = f"/storage/evidence/{filename}"
        logger.info(f"Generated MP4 clip evidence for {incident.incident_id}: {file_path}")
        return relative_url


# Global singleton generator instance
evidence_generator = EvidenceGenerator()
