import os
import math
import uuid
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any
from sqlalchemy.orm import Session

from config import settings
from database.models import IncidentModel, SuspiciousActivityModel, ZoneModel, CameraModel
from ai.fence import point_in_polygon

logger = logging.getLogger("ai.suspicious_engine")

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────
BEHAVIOR_UNUSUAL_STOP = "UNUSUAL_STOP"
BEHAVIOR_LOITERING = "LOITERING"
BEHAVIOR_RAPID_MOVEMENT = "RAPID_MOVEMENT"
BEHAVIOR_RESTRICTED_ZONE = "RESTRICTED_ZONE_BEHAVIOR"

VALID_BEHAVIORS = {
    BEHAVIOR_UNUSUAL_STOP,
    BEHAVIOR_LOITERING,
    BEHAVIOR_RAPID_MOVEMENT,
    BEHAVIOR_RESTRICTED_ZONE,
}

EVENT_TYPE_MAP = {
    BEHAVIOR_UNUSUAL_STOP: "SUSPICIOUS_UNUSUAL_STOP",
    BEHAVIOR_LOITERING: "SUSPICIOUS_LOITERING",
    BEHAVIOR_RAPID_MOVEMENT: "SUSPICIOUS_RAPID_MOVEMENT",
    BEHAVIOR_RESTRICTED_ZONE: "SUSPICIOUS_RESTRICTED_ZONE_BEHAVIOR",
}

SEVERITY_MAP = {
    BEHAVIOR_UNUSUAL_STOP: ("MEDIUM", 60, "medium"),
    BEHAVIOR_LOITERING: ("MEDIUM", 65, "medium"),
    BEHAVIOR_RAPID_MOVEMENT: ("HIGH", 75, "high"),
    BEHAVIOR_RESTRICTED_ZONE: ("HIGH", 85, "high"),
}


class TrackSuspiciousSample:
    __slots__ = (
        "timestamp",
        "cx",
        "cy",
        "width",
        "height",
        "speed",
        "in_restricted_zone",
        "zone_name",
    )

    def __init__(
        self,
        timestamp: float,
        cx: float,
        cy: float,
        width: float,
        height: float,
        speed: float = 0.0,
        in_restricted_zone: bool = False,
        zone_name: Optional[str] = None,
    ):
        self.timestamp = timestamp
        self.cx = cx
        self.cy = cy
        self.width = width
        self.height = height
        self.speed = speed
        self.in_restricted_zone = in_restricted_zone
        self.zone_name = zone_name


class TrackSuspiciousState:
    """
    Isolated state for a single ByteTrack human track on a specific camera.
    Maintains a strictly bounded deque (max 60 samples).
    """

    def __init__(self, camera_id: str, track_id: int):
        self.camera_id: str = camera_id
        self.track_id: int = track_id
        self.track_label: str = f"TRK#{track_id}"
        self.samples: deque[TrackSuspiciousSample] = deque(maxlen=60)
        self.first_seen: float = 0.0
        self.last_seen: float = 0.0
        self.last_update: float = 0.0

        # Episode & Incident tracking (One episode = One incident)
        self.active_behavior: Optional[str] = None
        self.behavior_start: Optional[float] = None
        self.incident_created: bool = False
        self.incident_id: Optional[str] = None
        self.activity_id: Optional[str] = None

        # Behavior-specific state variables
        self.consecutive_fast_samples: int = 0
        self.restricted_zone_start: Optional[float] = None
        self.restricted_zone_name: Optional[str] = None
        self.last_event_times: Dict[str, float] = {}

    def add_sample(
        self,
        timestamp: float,
        cx: float,
        cy: float,
        width: float,
        height: float,
        in_restricted_zone: bool,
        zone_name: Optional[str],
    ) -> float:
        """
        Appends sample to bounded deque, calculates instantaneous speed relative
        to preceding sample, and updates timing. Returns calculated speed.
        """
        if self.first_seen == 0.0:
            self.first_seen = timestamp
        self.last_seen = timestamp
        self.last_update = timestamp

        speed = 0.0
        if len(self.samples) > 0:
            prev = self.samples[-1]
            dt = timestamp - prev.timestamp
            dist = math.sqrt((cx - prev.cx) ** 2 + (cy - prev.cy) ** 2)
            if dt > 0:
                speed = dist / dt
            else:
                speed = dist

        sample = TrackSuspiciousSample(
            timestamp=timestamp,
            cx=cx,
            cy=cy,
            width=width,
            height=height,
            speed=speed,
            in_restricted_zone=in_restricted_zone,
            zone_name=zone_name,
        )
        self.samples.append(sample)
        return speed


class SuspiciousActivityEngine:
    """
    Explainable, rule-based Suspicious Activity Detection Engine (Phase 1).
    Evaluates existing ByteTrack human tracks ONLY.
    Vehicles (VTRK#) are strictly excluded.
    """

    def __init__(self):
        # camera_id -> track_id -> TrackSuspiciousState
        self._states: Dict[str, Dict[int, TrackSuspiciousState]] = {}
        self.last_created_incidents: List[IncidentModel] = []


    def clear_camera(self, camera_id: str):
        """Clears all tracking state for a specific camera."""
        if camera_id in self._states:
            self._states[camera_id].clear()

    def get_track_state(self, camera_id: str, track_id: int) -> TrackSuspiciousState:
        """Retrieves or initializes an isolated track state."""
        if camera_id not in self._states:
            self._states[camera_id] = {}
        cam_store = self._states[camera_id]
        if track_id not in cam_store:
            cam_store[track_id] = TrackSuspiciousState(camera_id, track_id)
        return cam_store[track_id]

    def cleanup_inactive_tracks(self, camera_id: str, active_track_ids: List[int], timeout_sec: float = 60.0, current_ts: Optional[float] = None):
        """Removes track states that have disappeared and exceeded timeout."""
        if camera_id not in self._states:
            return
        cam_store = self._states[camera_id]
        active_set = set(active_track_ids)
        to_delete = []
        now = current_ts if current_ts is not None else datetime.now(timezone.utc).timestamp()
        for tid, state in cam_store.items():
            if tid not in active_set and (now - state.last_update) > timeout_sec:
                to_delete.append(tid)
        for tid in to_delete:
            cam_store.pop(tid, None)

    def evaluate_human_track(
        self,
        camera_id: str,
        track_id: int,
        bbox: Dict[str, float],
        timestamp_sec: float,
        zones: List[ZoneModel],
    ) -> Tuple[Optional[str], Optional[str], float]:
        """
        Evaluates a single human track against the 4 configured behavior criteria.
        Returns: (behavior_type, explanation, duration) or (None, None, 0.0)
        """
        state = self.get_track_state(camera_id, track_id)

        # 1. Centroid calculation from normalized bounding box
        bx = bbox.get("x", 0.0)
        by = bbox.get("y", 0.0)
        bw = bbox.get("width", 0.0)
        bh = bbox.get("height", 0.0)
        cx = round(bx + (bw / 2.0), 4)
        cy = round(by + (bh / 2.0), 4)

        # Feet position for zone evaluation
        feet_x = round(bx + (bw / 2.0), 4)
        feet_y = round(by + bh, 4)

        # 2. Check if inside any enabled restricted zone
        in_restricted_zone = False
        zone_name: Optional[str] = None
        for z in zones:
            if z.enabled and z.polygon_coordinates and z.human_detection and not (z.name and "global" in z.name.lower()):
                if point_in_polygon(feet_x, feet_y, z.polygon_coordinates):
                    in_restricted_zone = True
                    zone_name = z.name
                    break

        # 3. Add sample and compute instantaneous speed
        speed = state.add_sample(
            timestamp=timestamp_sec,
            cx=cx,
            cy=cy,
            width=bw,
            height=bh,
            in_restricted_zone=in_restricted_zone,
            zone_name=zone_name,
        )

        samples = list(state.samples)
        if len(samples) < 2:
            return None, None, 0.0

        # Update restricted zone presence timing
        if in_restricted_zone:
            if state.restricted_zone_start is None:
                state.restricted_zone_start = timestamp_sec
                state.restricted_zone_name = zone_name
        else:
            state.restricted_zone_start = None
            state.restricted_zone_name = None

        # Update fast sample counter for RAPID_MOVEMENT
        speed_thresh = getattr(settings, "SUSPICIOUS_SPEED_THRESHOLD", 0.35)
        if speed >= speed_thresh:
            state.consecutive_fast_samples += 1
        else:
            state.consecutive_fast_samples = 0

        # ── BEHAVIOR 1: RAPID_MOVEMENT ──
        min_fast_samples = getattr(settings, "SUSPICIOUS_MIN_TRACK_SAMPLES", 5)
        if state.consecutive_fast_samples >= min_fast_samples:
            duration = timestamp_sec - samples[-min_fast_samples].timestamp
            desc = (
                f"TRK#{track_id} exhibited sustained rapid movement "
                f"across {state.consecutive_fast_samples} consecutive samples (speed: {speed:.2f} >= {speed_thresh})."
            )
            return BEHAVIOR_RAPID_MOVEMENT, desc, round(duration, 1)

        # ── BEHAVIOR 2: RESTRICTED_ZONE_BEHAVIOR ──
        restricted_zone_thresh = getattr(settings, "SUSPICIOUS_RESTRICTED_ZONE_SECONDS", 10.0)
        if state.restricted_zone_start is not None:
            zone_duration = timestamp_sec - state.restricted_zone_start
            if zone_duration >= restricted_zone_thresh:
                z_name = state.restricted_zone_name or "Restricted Zone"
                desc = (
                    f"TRK#{track_id} lingered inside restricted zone '{z_name}' "
                    f"for {int(zone_duration)}s (threshold: {int(restricted_zone_thresh)}s)."
                )
                return BEHAVIOR_RESTRICTED_ZONE, desc, round(zone_duration, 1)

        # ── Window analysis for UNUSUAL_STOP and LOITERING ──
        # Find samples within the window relevant for 30s behaviors
        stat_window_sec = getattr(settings, "SUSPICIOUS_STATIONARY_SECONDS", 30.0)
        loit_window_sec = getattr(settings, "SUSPICIOUS_LOITERING_SECONDS", 30.0)

        # Total elapsed duration covered by history
        total_elapsed = samples[-1].timestamp - samples[0].timestamp

        # Calculate metrics over the qualifying window:
        # We find the slice of samples where (current_ts - sample.ts) <= 30.0s (or up to total available)
        # If total_elapsed >= 30.0, we compute cumulative path length and net displacement over that 30s window.
        if total_elapsed >= stat_window_sec:
            # Find index in samples where window starts (approx 30s ago)
            window_start_idx = 0
            for i, s in enumerate(samples):
                if samples[-1].timestamp - s.timestamp <= stat_window_sec:
                    window_start_idx = i
                    break

            window_samples = samples[window_start_idx:]
            window_duration = window_samples[-1].timestamp - window_samples[0].timestamp

            # Cumulative path length = sum of Euclidean distances between consecutive samples
            cum_path_len = 0.0
            for i in range(1, len(window_samples)):
                dx = window_samples[i].cx - window_samples[i - 1].cx
                dy = window_samples[i].cy - window_samples[i - 1].cy
                cum_path_len += math.sqrt(dx * dx + dy * dy)

            # Net displacement = Euclidean distance between window start and current position
            start_s = window_samples[0]
            curr_s = window_samples[-1]
            net_disp = math.sqrt((curr_s.cx - start_s.cx) ** 2 + (curr_s.cy - start_s.cy) ** 2)

            # ── BEHAVIOR 3: UNUSUAL_STOP ──
            # stationary >= 30.0s, path length <= 0.03, net displacement <= 0.03
            max_stat_path = getattr(settings, "SUSPICIOUS_STATIONARY_MAX_PATH_LENGTH", 0.03)
            if window_duration >= stat_window_sec and cum_path_len <= max_stat_path and net_disp <= max_stat_path:
                desc = (
                    f"TRK#{track_id} remained virtually stationary for {int(window_duration)}s "
                    f"(cumulative movement: {cum_path_len:.3f} <= {max_stat_path})."
                )
                return BEHAVIOR_UNUSUAL_STOP, desc, round(window_duration, 1)

            # ── BEHAVIOR 4: LOITERING ──
            # elapsed >= 30.0s, net displacement <= 0.12, cumulative path length >= 0.10
            max_net_disp = getattr(settings, "SUSPICIOUS_LOITERING_MAX_NET_DISPLACEMENT", 0.12)
            min_loit_path = getattr(settings, "SUSPICIOUS_LOITERING_MIN_PATH_LENGTH", 0.10)

            if (
                window_duration >= loit_window_sec
                and net_disp <= max_net_disp
                and cum_path_len >= min_loit_path
            ):
                desc = (
                    f"TRK#{track_id} loitered in local area for {int(window_duration)}s "
                    f"(net displacement: {net_disp:.3f} <= {max_net_disp}, cumulative path: {cum_path_len:.3f} >= {min_loit_path})."
                )
                return BEHAVIOR_LOITERING, desc, round(window_duration, 1)

        return None, None, 0.0

    def process_frame(
        self,
        camera_id: str,
        human_tracks: List[Dict[str, Any]],
        zones: List[ZoneModel],
        timestamp_sec: float,
        db: Session,
        frame_image: Optional[Any] = None,
        video_path: Optional[str] = None,
        frame_index: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Main pipeline integration method:
        Processes all active human tracks on a frame.
        Vehicles MUST NEVER be passed into this method.
        Creates exactly ONE IncidentModel + ONE SuspiciousActivityModel per episode.
        Updates duration for ongoing episodes without creating duplicate incidents.
        Returns list of active suspicious activity dictionaries for the frame response.
        """
        self.last_created_incidents = []
        if not getattr(settings, "SUSPICIOUS_ACTIVITY_ENABLED", True):
            return []

        active_activities: List[Dict[str, Any]] = []
        active_track_ids = []

        cooldown_sec = getattr(settings, "SUSPICIOUS_EVENT_COOLDOWN_SECONDS", 300.0)

        # Resolve camera name for incident record
        camera_name = camera_id
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first()
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

            behavior, desc, duration = self.evaluate_human_track(
                camera_id=camera_id,
                track_id=tid,
                bbox=bbox,
                timestamp_sec=timestamp_sec,
                zones=zones,
            )

            state = self.get_track_state(camera_id, tid)

            if behavior:
                severity_code, threat_score, threat_level = SEVERITY_MAP[behavior]
                event_type = EVENT_TYPE_MAP[behavior]

                # Check if this is an ongoing episode or a brand-new episode
                is_new_episode = False
                if not state.incident_created or state.active_behavior != behavior:
                    # Check cooldown
                    last_time = state.last_event_times.get(behavior, 0.0)
                    if (timestamp_sec - last_time) >= cooldown_sec or last_time == 0.0:
                        is_new_episode = True

                if is_new_episode:
                    # ── ONE EPISODE = ONE INCIDENT ──
                    inc_uuid = str(uuid.uuid4())
                    incident_id = f"INC-SUSP-{uuid.uuid4().hex[:8].upper()}"
                    activity_id = f"ACT-SUSP-{uuid.uuid4().hex[:8].upper()}"

                    now_utc = datetime.now(timezone.utc)
                    event_dt = (
                        datetime.fromtimestamp(timestamp_sec, timezone.utc)
                        if timestamp_sec > 1000000000
                        else now_utc
                    )

                    # 1. Create real IncidentModel
                    incident = IncidentModel(
                        id=inc_uuid,
                        incident_id=incident_id,
                        camera_id=camera_id,
                        camera_name=camera_name,
                        sector=cam.sector if cam else "Sector B",
                        outpost=cam.outpost if cam else "Border Outpost North",
                        object_type="human",
                        track_id=f"TRK#{tid}",
                        event_type=event_type,
                        threat_score=threat_score,
                        threat_level=threat_level,
                        threat_factors=[
                            {
                                "category": "Suspicious Behavior",
                                "scoreContribution": threat_score,
                                "description": desc,
                            }
                        ],
                        explainable_reason=desc,
                        environment="normal",
                        ai_reliability=95,
                        visibility_score=90,
                        status="active",
                        sync_status="unsynced",
                        snapshot_url="",
                        zone_name=state.restricted_zone_name or "General Surveillance",
                        loitering_duration_sec=int(duration),
                        speed_kmh=round(state.samples[-1].speed * 10.0, 1) if state.samples else 0.0,
                        direction="Stationary" if behavior == BEHAVIOR_UNUSUAL_STOP else "Local Maneuver",
                        smart_alert_confirmed=True,
                        validation_checks={
                            "behavior": behavior,
                            "duration_sec": duration,
                            "rule_verified": True,
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
                    db.add(incident)

                    # 2. Create SuspiciousActivityModel linked to incident_id
                    susp_record = SuspiciousActivityModel(
                        id=str(uuid.uuid4()),
                        activity_id=activity_id,
                        camera_id=camera_id,
                        track_id=tid,
                        track_label=f"TRK#{tid}",
                        activity_type=behavior,
                        severity=severity_code,
                        started_at=event_dt,
                        detected_at=now_utc,
                        duration_sec=duration,
                        zone_name=state.restricted_zone_name or "General Surveillance",
                        description=desc,
                        incident_id=incident_id,
                        created_at=now_utc,
                    )
                    db.add(susp_record)
                    db.commit()
                    db.refresh(incident)
                    self.last_created_incidents.append(incident)

                    # 3. Snapshot Evidence creation (if frame or video path is provided)
                    if frame_image is not None and hasattr(frame_image, "shape"):
                        try:
                            from ai.evidence_generator import evidence_generator
                            # Create snapshot from in-memory frame
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
                    elif video_path and os.path.exists(video_path):
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
                    try:
                        from ai.edge_sync import edge_sync
                        edge_sync.enqueue_incident(incident, db)
                    except Exception:
                        pass

                    # 5. Broadcast WebSocket event once per episode
                    try:
                        from api.ws import broadcast_event_sync
                        broadcast_event_sync("SUSPICIOUS_ACTIVITY_DETECTED", {
                            "camera_id": camera_id,
                            "track_id": tid,
                            "track_label": f"TRK#{tid}",
                            "activity_type": behavior,
                            "severity": severity_code,
                            "duration_sec": int(duration),
                            "zone": state.restricted_zone_name or "General Surveillance",
                            "timestamp": event_dt.strftime("%Y-%m-%d %H:%M:%S"),
                            "bounding_box": bbox,
                            "object_type": "human",
                            "incident_id": incident_id,
                        })
                    except Exception as ws_err:
                        logger.warning(f"WebSocket broadcast failed for {incident_id}: {ws_err}")

                    # Update track state to mark incident created
                    state.incident_created = True
                    state.active_behavior = behavior
                    state.behavior_start = timestamp_sec
                    state.incident_id = incident_id
                    state.activity_id = activity_id
                    state.last_event_times[behavior] = timestamp_sec

                else:
                    # Episode is ongoing: Frame 51..N -> update duration, DO NOT create another incident
                    if state.behavior_start:
                        duration = max(duration, timestamp_sec - state.behavior_start)

                active_activities.append({
                    "activity_type": behavior,
                    "track_id": tid,
                    "track_label": f"TRK#{tid}",
                    "duration_sec": int(duration),
                    "severity": severity_code,
                    "description": desc,
                    "incident_id": state.incident_id,
                    "zone_name": state.restricted_zone_name,
                })
            else:
                # If no longer exhibiting suspicious behavior, reset active state
                if state.active_behavior and state.incident_created:
                    # Keep cooldown timestamp intact, but clear active episode
                    state.incident_created = False
                    state.active_behavior = None
                    state.behavior_start = None
                    state.incident_id = None
                    state.activity_id = None

        # Clean disappeared tracks
        self.cleanup_inactive_tracks(camera_id, active_track_ids, timeout_sec=60.0, current_ts=timestamp_sec)

        return active_activities

    def _create_evidence_from_frame(
        self,
        frame: Any,
        incident: IncidentModel,
        bbox: Dict[str, float],
        db: Session,
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

            # Amber bounding box for suspicious activity
            cv2.rectangle(vis_frame, (x1, y1), (x2, y2), (0, 165, 255), 2)
            label = f"{incident.event_type} | {incident.track_id}"
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            label_y1 = max(0, y1 - th - 6)
            cv2.rectangle(vis_frame, (x1, label_y1), (x1 + tw + 8, y1), (0, 165, 255), -1)
            cv2.putText(vis_frame, label, (x1 + 4, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1, cv2.LINE_AA)

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
suspicious_engine = SuspiciousActivityEngine()
