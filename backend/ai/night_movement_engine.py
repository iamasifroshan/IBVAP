import os
import math
import uuid
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

from config import settings
from database.models import IncidentModel, NightMovementModel, CameraModel

logger = logging.getLogger("ai.night_movement_engine")


class TrackNightMovementState:
    """
    Isolated state for a single ByteTrack human track for night movement analysis.
    Maintains a strictly bounded deque (max 60 samples).
    """
    __slots__ = (
        "camera_id",
        "track_id",
        "track_label",
        "samples",
        "first_seen",
        "last_seen",
        "last_update",
        "last_event_time",
        "incident_created",
        "incident_id",
        "movement_id",
    )

    def __init__(self, camera_id: str, track_id: int):
        self.camera_id: str = camera_id
        self.track_id: int = track_id
        self.track_label: str = f"TRK#{track_id}"
        self.samples: deque[Tuple[float, float, float]] = deque(maxlen=60)  # (timestamp, cx, cy)
        self.first_seen: float = 0.0
        self.last_seen: float = 0.0
        self.last_update: float = 0.0
        self.last_event_time: float = 0.0

        self.incident_created: bool = False
        self.incident_id: Optional[str] = None
        self.movement_id: Optional[str] = None

    def add_sample(self, timestamp: float, cx: float, cy: float):
        if self.first_seen == 0.0:
            self.first_seen = timestamp
        self.last_seen = timestamp
        self.last_update = timestamp
        self.samples.append((timestamp, cx, cy))

    def compute_movement(self, min_samples: int = 5) -> Tuple[float, float, int]:
        """
        Calculates net displacement and cumulative path length over recent samples.
        Returns (net_displacement, cumulative_path_length, sample_count).
        """
        n = len(self.samples)
        if n < min_samples:
            return 0.0, 0.0, n

        # Cumulative path length
        cum_path = 0.0
        for i in range(1, n):
            dx = self.samples[i][1] - self.samples[i - 1][1]
            dy = self.samples[i][2] - self.samples[i - 1][2]
            cum_path += math.sqrt(dx * dx + dy * dy)

        # Net displacement from earliest in window to current
        dx_net = self.samples[-1][1] - self.samples[0][1]
        dy_net = self.samples[-1][2] - self.samples[0][2]
        net_disp = math.sqrt(dx_net * dx_net + dy_net * dy_net)

        return net_disp, cum_path, n


class NightMovementEngine:
    """
    Explainable, track-based Night-Time Movement Detection Engine.
    Combines deterministic frame luminance analysis with ByteTrack human trajectory tracking.
    Never uses hardcoded video timings, filenames, camera IDs, or manual toggles.
    """

    def __init__(self):
        # camera_id -> dict of {track_id: TrackNightMovementState}
        self.camera_tracks: Dict[str, Dict[int, TrackNightMovementState]] = {}
        self.last_created_incidents: List[IncidentModel] = []

    def get_track_state(self, camera_id: str, track_id: int) -> TrackNightMovementState:
        if camera_id not in self.camera_tracks:
            self.camera_tracks[camera_id] = {}
        if track_id not in self.camera_tracks[camera_id]:
            self.camera_tracks[camera_id][track_id] = TrackNightMovementState(camera_id, track_id)
        return self.camera_tracks[camera_id][track_id]

    def reset(self, camera_id: Optional[str] = None):
        if camera_id:
            self.camera_tracks.pop(camera_id, None)
        else:
            self.camera_tracks.clear()
        self.last_created_incidents = []

    def analyze_frame_lighting(self, frame: Any) -> Tuple[float, float, bool]:
        """
        Calculates average luminance and dark pixel ratio strictly from incoming raw frame pixels.
        Returns: (avg_luma, dark_pixel_ratio, is_night)
        """
        if frame is None or not hasattr(frame, "shape"):
            return 128.0, 0.0, False

        try:
            import cv2
            if len(frame.shape) == 3:
                # Standard BGR frame -> grayscale
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            else:
                gray = frame

            avg_luma = float(np.mean(gray))
            # Proportion of pixels with luminance < 50
            dark_pixels = int(np.count_nonzero(gray < 50))
            dark_pixel_ratio = float(dark_pixels / max(1, gray.size))

            luma_thresh = getattr(settings, "NIGHT_AVG_LUMA_THRESHOLD", 65.0)
            dark_ratio_thresh = getattr(settings, "NIGHT_MIN_DARK_PIXEL_RATIO", 0.40)

            is_night = (avg_luma < luma_thresh) and (dark_pixel_ratio >= dark_ratio_thresh)
            return round(avg_luma, 2), round(dark_pixel_ratio, 4), is_night
        except Exception as e:
            logger.warning(f"Error analyzing frame lighting: {e}")
            return 128.0, 0.0, False

    def cleanup_inactive_tracks(
        self,
        camera_id: str,
        active_track_ids: List[int],
        timeout_sec: float = 60.0,
        current_ts: float = 0.0,
    ):
        if camera_id not in self.camera_tracks:
            return

        tracks_to_delete = []
        for tid, state in self.camera_tracks[camera_id].items():
            if tid not in active_track_ids:
                if current_ts - state.last_seen > timeout_sec:
                    tracks_to_delete.append(tid)

        for tid in tracks_to_delete:
            del self.camera_tracks[camera_id][tid]

    def process_frame(
        self,
        camera_id: str,
        human_tracks: List[Dict[str, Any]],
        timestamp_sec: float,
        db: Any,
        frame_image: Optional[Any] = None,
        video_path: Optional[str] = None,
        frame_index: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Processes active human tracks under current frame illumination.
        Vehicles are strictly filtered out and never enter this pipeline.
        Creates exactly ONE IncidentModel + ONE NightMovementModel per movement episode.
        """
        self.last_created_incidents = []

        if not getattr(settings, "NIGHT_MOVEMENT_ENABLED", True):
            return []

        avg_luma, dark_ratio, is_night = self.analyze_frame_lighting(frame_image)

        # If lighting is not night/low-light, do not evaluate movement
        if not is_night:
            return []

        min_samples = getattr(settings, "NIGHT_MOVEMENT_MIN_SAMPLES", 5)
        min_disp = getattr(settings, "NIGHT_MOVEMENT_MIN_DISPLACEMENT", 0.03)
        min_path = getattr(settings, "NIGHT_MOVEMENT_MIN_PATH_LENGTH", 0.04)
        cooldown_sec = getattr(settings, "NIGHT_EVENT_COOLDOWN_SECONDS", 300.0)

        active_night_movements: List[Dict[str, Any]] = []
        active_track_ids: List[int] = []

        # Resolve camera name for incident record
        camera_name = camera_id
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first() if db else None
        if cam:
            camera_name = cam.name

        for trk in human_tracks:
            # Absolute guard against vehicle tracks
            fine_class = trk.get("fine_class", trk.get("class", ""))
            obj_type = trk.get("object_type", "human")
            if obj_type == "vehicle" or fine_class in getattr(settings, "VEHICLE_CLASSES", {"car", "motorcycle", "bus", "truck"}):
                continue
            lbl = str(trk.get("track_label", ""))
            if lbl.startswith("VTRK"):
                continue

            tid = trk.get("track_id")
            if tid is None:
                continue

            active_track_ids.append(tid)
            bbox = trk.get("bounding_box", {})
            bx = bbox.get("x", 0.0)
            by = bbox.get("y", 0.0)
            bw = bbox.get("width", 0.0)
            bh = bbox.get("height", 0.0)
            cx = bx + (bw / 2.0)
            cy = by + (bh / 2.0)

            state = self.get_track_state(camera_id, tid)
            state.add_sample(timestamp_sec, cx, cy)

            disp, path_len, count = state.compute_movement(min_samples=min_samples)

            # Movement condition: sustained meaningful movement
            has_sustained_movement = (
                count >= min_samples
                and disp >= min_disp
                and path_len >= min_path
            )

            if has_sustained_movement:
                # Check episode deduplication & cooldown
                is_new_episode = False
                if not state.incident_created:
                    time_since_last = timestamp_sec - state.last_event_time
                    if state.last_event_time == 0.0 or time_since_last >= cooldown_sec:
                        is_new_episode = True

                if is_new_episode:
                    inc_uuid = str(uuid.uuid4())
                    incident_id = f"INC-NM-{uuid.uuid4().hex[:8].upper()}"
                    movement_id = f"NM-{uuid.uuid4().hex[:8].upper()}"

                    now_utc = datetime.now(timezone.utc)
                    event_dt = (
                        datetime.fromtimestamp(timestamp_sec, timezone.utc)
                        if timestamp_sec > 1000000000
                        else now_utc
                    )

                    desc = (
                        f"Night-time movement detected for TRK#{tid}: "
                        f"Luma: {avg_luma:.1f}, Dark Ratio: {dark_ratio*100:.1f}%, "
                        f"Displacement: {disp:.3f} >= {min_disp}, Path Length: {path_len:.3f} >= {min_path}."
                    )

                    # 1. Create IncidentModel
                    incident = IncidentModel(
                        id=inc_uuid,
                        incident_id=incident_id,
                        camera_id=camera_id,
                        camera_name=camera_name,
                        sector=cam.sector if cam else "Sector B",
                        outpost=cam.outpost if cam else "Border Outpost North",
                        object_type="human",
                        track_id=f"TRK#{tid}",
                        event_type="NIGHT_MOVEMENT_DETECTED",
                        threat_score=70,
                        threat_level="high",
                        threat_factors=[
                            {
                                "category": "Night-Time Movement",
                                "scoreContribution": 70,
                                "description": desc,
                            }
                        ],
                        explainable_reason=desc,
                        environment="night",
                        ai_reliability=92,
                        visibility_score=max(10, min(90, int(avg_luma))),
                        status="active",
                        sync_status="unsynced",
                        snapshot_url="",
                        zone_name="Perimeter Surveillance",
                        loitering_duration_sec=int(max(1.0, timestamp_sec - state.first_seen)),
                        speed_kmh=round(disp * 10.0, 1),
                        direction="Perimeter Transit",
                        smart_alert_confirmed=True,
                        validation_checks={
                            "avg_luma": avg_luma,
                            "dark_pixel_ratio": dark_ratio,
                            "displacement": round(disp, 4),
                            "path_length": round(path_len, 4),
                            "samples_count": count,
                            "is_night": True,
                        },
                        synced_to_cloud=False,
                        person_name=trk.get("person_name", "UNKNOWN"),
                        face_recognized=trk.get("recognized", False),
                        face_confidence=trk.get("face_confidence", 0.0),
                        timestamp=event_dt,
                        source_video_timestamp_sec=(
                            timestamp_sec if (video_path and timestamp_sec < 86400) else None
                        ),
                    )
                    if db:
                        db.add(incident)

                    # 2. Create NightMovementModel
                    night_movement_rec = NightMovementModel(
                        id=str(uuid.uuid4()),
                        movement_id=movement_id,
                        camera_id=camera_id,
                        track_id=tid,
                        track_label=f"TRK#{tid}",
                        avg_luma=avg_luma,
                        dark_pixel_ratio=dark_ratio,
                        displacement=round(disp, 4),
                        path_length=round(path_len, 4),
                        samples_count=count,
                        incident_id=incident_id,
                        detected_at=now_utc,
                        created_at=now_utc,
                    )
                    if db:
                        db.add(night_movement_rec)
                        db.commit()
                        db.refresh(incident)

                    self.last_created_incidents.append(incident)

                    # 3. Snapshot Evidence creation
                    if frame_image is not None and hasattr(frame_image, "shape") and db:
                        try:
                            snap_url = self._create_evidence_from_frame(
                                frame=frame_image,
                                incident=incident,
                                bbox=bbox,
                                db=db,
                            )
                            if snap_url:
                                incident.snapshot_url = snap_url
                                db.commit()
                        except Exception as ev_err:
                            logger.warning(f"Failed to generate frame evidence for {incident_id}: {ev_err}")
                    elif video_path and os.path.exists(video_path) and db:
                        try:
                            from ai.evidence_generator import evidence_generator
                            snap_url, _ = evidence_generator.generate_incident_evidence(
                                video_path=video_path,
                                frame_index=frame_index,
                                incident=incident,
                                bounding_box=bbox,
                                confidence=trk.get("confidence", 0.95),
                                db=db,
                            )
                            if snap_url:
                                incident.snapshot_url = snap_url
                                db.commit()
                        except Exception as ev_err:
                            logger.warning(f"Failed to generate video evidence for {incident_id}: {ev_err}")

                    # 4. Enqueue in edge sync
                    if db:
                        try:
                            from ai.edge_sync import edge_sync
                            edge_sync.enqueue_incident(incident, db)
                        except Exception:
                            pass

                    # 5. Broadcast WebSocket event once per episode
                    try:
                        from api.ws import broadcast_event_sync
                        broadcast_event_sync("NIGHT_MOVEMENT_DETECTED", {
                            "camera_id": camera_id,
                            "track_id": tid,
                            "track_label": f"TRK#{tid}",
                            "avg_luma": avg_luma,
                            "dark_pixel_ratio": dark_ratio,
                            "displacement": round(disp, 4),
                            "path_length": round(path_len, 4),
                            "incident_id": incident_id,
                            "movement_id": movement_id,
                            "timestamp": event_dt.isoformat(),
                            "snapshot_url": incident.snapshot_url,
                        })
                    except Exception as ws_err:
                        logger.warning(f"Failed to broadcast night movement event: {ws_err}")

                    # Mark episode state
                    state.incident_created = True
                    state.incident_id = incident_id
                    state.movement_id = movement_id
                    state.last_event_time = timestamp_sec

                # Append to active movement list for frame response
                active_night_movements.append({
                    "movement_id": state.movement_id,
                    "track_id": tid,
                    "track_label": f"TRK#{tid}",
                    "avg_luma": avg_luma,
                    "dark_pixel_ratio": dark_ratio,
                    "displacement": round(disp, 4),
                    "path_length": round(path_len, 4),
                    "incident_id": state.incident_id,
                    "first_seen": state.first_seen,
                    "last_seen": state.last_seen,
                })

        # Clean disappeared tracks
        self.cleanup_inactive_tracks(camera_id, active_track_ids, timeout_sec=60.0, current_ts=timestamp_sec)

        return active_night_movements

    def _create_evidence_from_frame(
        self,
        frame: Any,
        incident: IncidentModel,
        bbox: Dict[str, float],
        db: Any,
    ) -> Optional[str]:
        """Draws overlay on in-memory frame, hashes image, and saves EvidenceModel record."""
        import cv2
        import hashlib
        from database.models import EvidenceModel

        storage_dir = getattr(settings, "STORAGE_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage"))
        evidence_dir = os.path.join(storage_dir, "evidence")
        os.makedirs(evidence_dir, exist_ok=True)

        h_img, w_img = frame.shape[:2]
        vis_frame = frame.copy()

        if bbox:
            bx = bbox.get("x", 0.0)
            by = bbox.get("y", 0.0)
            bw = bbox.get("width", 0.0)
            bh = bbox.get("height", 0.0)

            x1 = int(bx * w_img) if bx <= 1.0 else int(bx)
            y1 = int(by * h_img) if by <= 1.0 else int(by)
            x2 = int((bx + bw) * w_img) if bx <= 1.0 else int(bx + bw)
            y2 = int((by + bh) * h_img) if by <= 1.0 else int(by + bh)

            x1 = max(0, min(w_img - 1, x1))
            y1 = max(0, min(h_img - 1, y1))
            x2 = max(x1 + 5, min(w_img - 1, x2))
            y2 = max(y1 + 5, min(h_img - 1, y2))

            # Cyan / Indigo box for Night Movement
            color = (235, 140, 52)  # BGR
            cv2.rectangle(vis_frame, (x1, y1), (x2, y2), color, 2)
            label = f"NIGHT MOVEMENT | {incident.track_id}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            label_y1 = max(0, y1 - th - 6)
            cv2.rectangle(vis_frame, (x1, label_y1), (x1 + tw + 8, y1), color, -1)
            cv2.putText(vis_frame, label, (x1 + 4, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

        filename = f"{incident.incident_id}_snapshot.jpg"
        file_path = os.path.join(evidence_dir, filename)
        cv2.imwrite(file_path, vis_frame)

        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256.update(chunk)
        sha256_hash = sha256.hexdigest()

        db_ev = EvidenceModel(
            id=str(uuid.uuid4()),
            incident_id=incident.incident_id,
            evidence_type="snapshot",
            file_path=file_path,
            sha256_hash=sha256_hash,
            created_at=datetime.now(timezone.utc),
        )
        db.add(db_ev)
        db.commit()

        return f"/storage/evidence/{filename}"


# Singleton engine instance
night_movement_engine = NightMovementEngine()
