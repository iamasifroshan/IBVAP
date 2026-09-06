"""
Unified Security Intelligence Engine for IBVAP.
Correlates existing AI signals (FRS, ByteTrack, Virtual Fence, Suspicious Behavior, Night Movement, ANPR)
around the same camera-local tracked subject into a coherent, explainable Security Event.

Strict Rules:
- No new AI/ML model.
- Primary key for humans: camera_id + TRK#track_id.
- Primary key for vehicles: camera_id + VTRK#vehicle_track_id.
- Never cross-correlate across cameras or between human and vehicle tracks.
- Preserve identity semantics: KNOWN, UNKNOWN, FACE_UNAVAILABLE, FACE_PROCESSING_ERROR.
- Deterministic, explainable threat scoring (low / medium / high / critical).
- Prevents duplicate events and WebSocket spam across video frames.
"""

import time
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from sqlalchemy.orm import Session

from database.models import SecurityEventModel, CameraModel
from api.ws import broadcast_event_sync

logger = logging.getLogger("ai.security_intelligence")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UnifiedEventState:
    """
    In-memory bounded tracking state for a single subject episode on a camera.
    """
    __slots__ = (
        "id",
        "event_id",
        "camera_id",
        "camera_name",
        "subject_type",
        "track_id",
        "track_label",
        "threat_level",
        "threat_score",
        "threat_reason",
        "status",
        "contributing_signals",
        "related_incident_ids",
        "related_evidence_ids",
        "snapshot_url",
        "face_info",
        "vehicle_info",
        "first_seen_ts",
        "last_seen_ts",
        "first_seen_dt",
        "last_seen_dt",
        "last_db_sync_ts",
        "last_ws_broadcast_ts",
        "last_threat_state_key",
        "frames_seen",
        "zone_name",
    )

    def __init__(
        self,
        event_id: str,
        camera_id: str,
        camera_name: str,
        subject_type: str,
        track_id: int,
        track_label: str,
        db_id: Optional[str] = None,
    ):
        now_ts = time.time()
        now_dt = _utcnow()
        self.id: str = db_id or str(uuid.uuid4())
        self.event_id: str = event_id
        self.camera_id: str = camera_id
        self.camera_name: str = camera_name
        self.subject_type: str = subject_type
        self.track_id: int = track_id
        self.track_label: str = track_label
        self.threat_level: str = "low"
        self.threat_score: int = 20
        self.threat_reason: str = "Normal subject detection."
        self.status: str = "active"
        self.contributing_signals: List[str] = []
        self.related_incident_ids: List[str] = []
        self.related_evidence_ids: List[str] = []
        self.snapshot_url: str = ""
        self.face_info: Optional[Dict[str, Any]] = None
        self.vehicle_info: Optional[Dict[str, Any]] = None
        self.first_seen_ts: float = now_ts
        self.last_seen_ts: float = now_ts
        self.first_seen_dt: datetime = now_dt
        self.last_seen_dt: datetime = now_dt
        self.last_db_sync_ts: float = 0.0
        self.last_ws_broadcast_ts: float = 0.0
        self.last_threat_state_key: str = ""
        self.frames_seen: int = 1
        self.zone_name: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "event_id": self.event_id,
            "camera_id": self.camera_id,
            "camera_name": self.camera_name,
            "subject_type": self.subject_type,
            "track_id": self.track_id,
            "track_label": self.track_label,
            "threat_level": self.threat_level,
            "threat_score": self.threat_score,
            "threat_reason": self.threat_reason,
            "status": self.status,
            "contributing_signals": list(self.contributing_signals),
            "related_incident_ids": list(self.related_incident_ids),
            "related_evidence_ids": list(self.related_evidence_ids),
            "snapshot_url": self.snapshot_url,
            "face_info": self.face_info,
            "vehicle_info": self.vehicle_info,
            "first_seen": self.first_seen_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "last_seen": self.last_seen_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "frames_seen": self.frames_seen,
            "zone_name": self.zone_name,
        }


class UnifiedSecurityIntelligenceEngine:
    """
    Central correlation manager for IBVAP security episodes.
    Maintains active unified security events per camera and track ID.
    Deduplicates writes, evaluates deterministic threat levels, and dispatches WebSocket updates.
    """

    RESOLUTION_TIMEOUT_SEC: float = 12.0  # seconds without detection before resolving track episode
    DB_SYNC_INTERVAL_SEC: float = 3.0    # minimum seconds between periodic DB updates for active tracks
    MAX_TRACKS_PER_CAMERA: int = 150     # bounded in-memory state

    def __init__(self):
        # camera_id -> {track_id: UnifiedEventState}
        self._human_events: Dict[str, Dict[int, UnifiedEventState]] = {}
        self._vehicle_events: Dict[str, Dict[int, UnifiedEventState]] = {}

    def _get_camera_name(self, camera_id: str, db: Optional[Session] = None) -> str:
        if db:
            cam = db.query(CameraModel).filter(
                (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
            ).first()
            if cam:
                return cam.name
        return camera_id

    # ─────────────────────────────────────────────────────────────────────────
    # DETERMINISTIC THREAT ASSESSMENT
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def evaluate_human_threat(
        signals: List[str],
        face_info: Optional[Dict[str, Any]],
        zone_name: Optional[str] = None,
        frames_seen: int = 1
    ) -> Tuple[str, int, str]:
        """
        Calculates explainable, deterministic threat level, score, and explanation.
        Rules:
        - KNOWN PERSON: normal / low threat (no arbitrary escalation)
        - FACE_UNAVAILABLE / FACE_PROCESSING_ERROR: NOT UNKNOWN! Does not increase threat alone.
        - UNKNOWN PERSON alone: MEDIUM threat
        - Isolated suspicious loitering / unusual stop: MEDIUM threat
        - Night movement alone: MEDIUM threat
        - Fence breach / restricted zone breach: HIGH / CRITICAL
        - Compound combinations:
            UNKNOWN + RESTRICTED ZONE -> CRITICAL
            UNKNOWN + NIGHT MOVEMENT -> HIGH
            UNKNOWN + SUSPICIOUS + NIGHT -> CRITICAL
            FENCE + SUSPICIOUS + NIGHT -> CRITICAL
            SUSPICIOUS + NIGHT -> CRITICAL
        """
        signal_set = set(signals)
        reasons: List[str] = []

        identity_status = "FACE_UNAVAILABLE"
        is_known = False
        is_unknown = False
        person_name = None

        if face_info:
            identity_status = face_info.get("identity_status", "FACE_UNAVAILABLE")
            is_known = face_info.get("recognized", False) or (identity_status == "KNOWN")
            is_unknown = (identity_status == "UNKNOWN")
            person_name = face_info.get("name")

        # 1. Identity contribution
        if is_known:
            reasons.append(f"Recognized known personnel ({person_name or 'Authorized'})")
        elif is_unknown:
            reasons.append("Unidentified subject (face verified without enrolled profile match)")
        elif identity_status == "FACE_PROCESSING_ERROR":
            reasons.append("Face processing anomaly (non-threatening)")

        # 2. Behavior & Movement contributions
        has_fence_breach = any("FENCE" in s or "RESTRICTED_ZONE_BREACH" in s for s in signal_set)
        has_loitering = any("LOITERING" in s for s in signal_set)
        has_unusual_stop = any("UNUSUAL_STOP" in s for s in signal_set)
        has_rapid_movement = any("RAPID_MOVEMENT" in s for s in signal_set)
        has_restricted_behavior = any("RESTRICTED_ZONE_BEHAVIOR" in s for s in signal_set)
        has_night_movement = any("NIGHT_MOVEMENT" in s for s in signal_set)

        if has_fence_breach:
            reasons.append("Perimeter restricted zone breached")
        if has_loitering:
            reasons.append("Prolonged loitering detected")
        if has_unusual_stop:
            reasons.append("Unusual stationary stop detected")
        if has_rapid_movement:
            reasons.append("High-velocity rapid trajectory detected")
        if has_restricted_behavior:
            reasons.append("Prolonged presence inside restricted perimeter")
        if has_night_movement:
            reasons.append("Active movement under dark/night conditions")

        # 3. Rule Evaluation
        # Compound Critical Scenarios
        if (has_fence_breach and is_unknown) or (has_fence_breach and has_night_movement and has_loitering):
            score = 98 if has_night_movement else 92
            level = "critical"
            explanation = "Critical: Unidentified intruder breached perimeter boundary." if is_unknown else "Critical: Perimeter intrusion detected with active maneuvers."
            return level, score, explanation

        if is_unknown and has_night_movement and (has_loitering or has_unusual_stop or has_rapid_movement):
            score = 95
            level = "critical"
            explanation = "Critical: Unidentified subject exhibiting suspicious behavior during night hours."
            return level, score, explanation

        if has_fence_breach or has_restricted_behavior or (has_loitering and has_night_movement):
            score = 85
            level = "high"
            explanation = "High Threat: Restricted perimeter breach or multi-signal activity detected."
            return level, score, explanation

        if is_unknown and has_night_movement:
            score = 80
            level = "high"
            explanation = "High Threat: Unidentified subject moving during restricted night hours."
            return level, score, explanation

        if has_rapid_movement:
            score = 75
            level = "high"
            explanation = "High Threat: Rapid evasive movement detected in perimeter area."
            return level, score, explanation

        # Medium Scenarios
        if has_loitering or has_unusual_stop:
            score = 65
            level = "medium"
            explanation = "Medium Threat: Suspicious stationary or loitering behavior detected."
            return level, score, explanation

        if has_night_movement:
            score = 60
            level = "medium"
            explanation = "Medium Threat: Night-time human trajectory detected."
            return level, score, explanation

        if is_unknown:
            score = 50
            level = "medium"
            explanation = "Medium Threat: Unidentified subject detected in border monitoring zone."
            return level, score, explanation

        # Low / Normal Scenarios
        if is_known:
            score = 15
            level = "low"
            explanation = f"Normal: Authorized individual ({person_name or 'Known'}) conducting standard movements."
            return level, score, explanation

        score = 25
        level = "low"
        explanation = "Low Threat: Standard isolated subject movement logged."
        return level, score, explanation

    @staticmethod
    def evaluate_vehicle_threat(
        vehicle_class: str,
        plate_text: Optional[str] = None,
        format_valid: bool = False,
    ) -> Tuple[str, int, str]:
        """
        Deterministic vehicle threat assessment.
        Ordinary vehicles remain low threat.
        """
        score = 20
        level = "low"
        if plate_text:
            fmt_str = "valid format" if format_valid else "non-standard format"
            explanation = f"Low Threat: Motor vehicle transit ({vehicle_class.capitalize()}, Plate: {plate_text} [{fmt_str}]) logged."
        else:
            explanation = f"Low Threat: Motor vehicle transit ({vehicle_class.capitalize()}) logged."
        return level, score, explanation

    # ─────────────────────────────────────────────────────────────────────────
    # INGESTION METHODS (HUMAN SUBJECTS)
    # ─────────────────────────────────────────────────────────────────────────

    def ingest_human_frame_signals(
        self,
        camera_id: str,
        track_id: int,
        confidence: float,
        bounding_box: Dict[str, float],
        face_info: Optional[Dict[str, Any]],
        zone_name: Optional[str],
        timestamp_sec: float,
        db: Session,
        camera_name: Optional[str] = None,
    ) -> UnifiedEventState:
        """
        Ingests per-frame human detection and tracking telemetry for camera_id + TRK#track_id.
        Creates exactly ONE active UnifiedEventState, updating it continuously on subsequent frames.
        """
        now_ts = time.time()
        now_dt = datetime.fromtimestamp(timestamp_sec, timezone.utc) if timestamp_sec > 1000000000 else _utcnow()

        if camera_id not in self._human_events:
            self._human_events[camera_id] = {}

        cam_store = self._human_events[camera_id]
        state = cam_store.get(track_id)

        # Signal identification from current frame
        signals_to_add: List[str] = []
        normalized_face_info = dict(face_info) if face_info else None
        if normalized_face_info:
            if "name" in normalized_face_info and "person_name" not in normalized_face_info:
                normalized_face_info["person_name"] = normalized_face_info["name"]
            status_raw = normalized_face_info.get("identity_status")
            if status_raw == "UNKNOWN":
                signals_to_add.append("UNKNOWN_PERSON")
            elif status_raw == "KNOWN" or normalized_face_info.get("recognized"):
                signals_to_add.append("KNOWN_PERSON")

        if zone_name and any(term in zone_name.lower() for term in ["restricted", "buffer", "fence", "exclusion", "danger"]):
            signals_to_add.append("RESTRICTED_ZONE_PRESENCE")

        if state is None:
            # First time seeing this track episode: create UnifiedEventState and DB record
            event_id = f"SEC-EVT-{uuid.uuid4().hex[:8].upper()}"
            cam_name = camera_name or self._get_camera_name(camera_id, db)
            state = UnifiedEventState(
                event_id=event_id,
                camera_id=camera_id,
                camera_name=cam_name,
                subject_type="human",
                track_id=track_id,
                track_label=f"TRK#{track_id}",
            )
            state.first_seen_ts = now_ts
            state.first_seen_dt = now_dt
            state.last_seen_ts = now_ts
            state.last_seen_dt = now_dt
            state.face_info = normalized_face_info
            state.zone_name = zone_name or "General Surveillance"
            for sig in signals_to_add:
                if sig not in state.contributing_signals:
                    state.contributing_signals.append(sig)

            # Evaluate threat
            lvl, scr, rsn = self.evaluate_human_threat(
                signals=state.contributing_signals,
                face_info=state.face_info,
                zone_name=state.zone_name,
                frames_seen=state.frames_seen
            )
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn
            state.last_threat_state_key = f"{lvl}_{scr}_{len(state.contributing_signals)}"

            # Save initial DB row
            try:
                db_event = SecurityEventModel(
                    id=state.id,
                    event_id=state.event_id,
                    camera_id=state.camera_id,
                    camera_name=state.camera_name,
                    subject_type="human",
                    track_id=state.track_id,
                    track_label=state.track_label,
                    threat_level=state.threat_level,
                    threat_score=state.threat_score,
                    threat_reason=state.threat_reason,
                    status="active",
                    contributing_signals=state.contributing_signals,
                    related_incident_ids=[],
                    related_evidence_ids=[],
                    snapshot_url=state.snapshot_url,
                    face_info=state.face_info,
                    vehicle_info=None,
                    first_seen=state.first_seen_dt,
                    last_seen=state.last_seen_dt,
                    created_at=state.first_seen_dt,
                    updated_at=state.last_seen_dt,
                )
                db.add(db_event)
                db.commit()
                state.last_db_sync_ts = now_ts
            except Exception as db_err:
                logger.error(f"[SecurityIntelligence] Failed to insert initial security_event for TRK#{track_id}: {db_err}")

            # Register in bounded in-memory store
            if len(cam_store) >= self.MAX_TRACKS_PER_CAMERA:
                oldest_tid = min(cam_store.keys(), key=lambda k: cam_store[k].last_seen_ts)
                cam_store.pop(oldest_tid, None)

            cam_store[track_id] = state

            # Broadcast creation
            self._broadcast_event("SECURITY_EVENT_UPDATED", state)
            self._notify_c2(state, db)

        else:
            # Subsequent frame for existing track episode: update existing state
            state.last_seen_ts = now_ts
            state.last_seen_dt = now_dt
            state.frames_seen += 1
            if normalized_face_info:
                state.face_info = normalized_face_info
            if zone_name:
                state.zone_name = zone_name

            signals_changed = False
            for sig in signals_to_add:
                if sig not in state.contributing_signals:
                    state.contributing_signals.append(sig)
                    signals_changed = True

            # Re-evaluate threat
            lvl, scr, rsn = self.evaluate_human_threat(
                signals=state.contributing_signals,
                face_info=state.face_info,
                zone_name=state.zone_name,
                frames_seen=state.frames_seen
            )
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn

            current_key = f"{lvl}_{scr}_{len(state.contributing_signals)}_{len(state.related_incident_ids)}"
            needs_db_flush = (
                signals_changed or
                current_key != state.last_threat_state_key or
                (now_ts - state.last_db_sync_ts >= self.DB_SYNC_INTERVAL_SEC)
            )

            if needs_db_flush:
                state.last_threat_state_key = current_key
                state.last_db_sync_ts = now_ts
                self._flush_to_db(state, db)
                if signals_changed or current_key != state.last_threat_state_key:
                    self._broadcast_event("SECURITY_EVENT_UPDATED", state)

        return state

    # ─────────────────────────────────────────────────────────────────────────
    # SIGNAL & INCIDENT ATTACHMENT
    # ─────────────────────────────────────────────────────────────────────────

    def attach_incident(
        self,
        camera_id: str,
        track_id: int,
        incident_id: str,
        event_type: str,
        snapshot_url: Optional[str],
        db: Session,
    ):
        """
        Attaches an authorized IncidentModel to the active security event for camera_id + TRK#track_id.
        Updates contributing signals without creating duplicate security events.
        """
        if not incident_id:
            return

        cam_store = self._human_events.get(camera_id, {})
        state = cam_store.get(track_id)
        if not state:
            return

        changed = False
        if incident_id not in state.related_incident_ids:
            state.related_incident_ids.append(incident_id)
            changed = True

        if snapshot_url and not state.snapshot_url:
            state.snapshot_url = snapshot_url
            changed = True

        # Map event_type to contributing signal tag
        sig_map = {
            "RESTRICTED_ZONE_BREACH": "RESTRICTED_ZONE_BREACH",
            "SUSPICIOUS_UNUSUAL_STOP": "UNUSUAL_STOP",
            "SUSPICIOUS_LOITERING": "LOITERING",
            "SUSPICIOUS_RAPID_MOVEMENT": "RAPID_MOVEMENT",
            "SUSPICIOUS_RESTRICTED_ZONE_BEHAVIOR": "RESTRICTED_ZONE_BEHAVIOR",
            "NIGHT_MOVEMENT_DETECTED": "NIGHT_MOVEMENT",
        }
        mapped_sig = sig_map.get(event_type, event_type)
        if mapped_sig and mapped_sig not in state.contributing_signals:
            state.contributing_signals.append(mapped_sig)
            changed = True

        if changed:
            lvl, scr, rsn = self.evaluate_human_threat(
                signals=state.contributing_signals,
                face_info=state.face_info,
                zone_name=state.zone_name,
                frames_seen=state.frames_seen
            )
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn
            self._flush_to_db(state, db)
            self._broadcast_event("SECURITY_EVENT_UPDATED", state)

    def attach_evidence(
        self,
        camera_id: str,
        track_id: int,
        evidence_id: str,
        snapshot_url: Optional[str] = None,
        db: Optional[Session] = None,
    ) -> Optional[UnifiedEventState]:
        """
        Attaches evidence record to the active unified security event for camera_id + TRK#track_id.
        Deduplicates evidence IDs and records snapshot URL.
        """
        if not evidence_id:
            return None

        cam_store = self._human_events.get(camera_id, {})
        state = cam_store.get(track_id)
        if not state:
            return None

        changed = False
        if evidence_id not in state.related_evidence_ids:
            state.related_evidence_ids.append(evidence_id)
            changed = True

        if snapshot_url and not state.snapshot_url:
            state.snapshot_url = snapshot_url
            changed = True

        if changed and db:
            self._flush_to_db(state, db)

        return state

    def attach_suspicious_activity(
        self,
        camera_id: str,
        track_id: int,
        activity_type: str,
        severity: str,
        description: str,
        incident_id: Optional[str],
        db: Session,
    ):
        """Attaches a suspicious activity signal to the unified security event."""
        cam_store = self._human_events.get(camera_id, {})
        state = cam_store.get(track_id)
        if not state:
            return

        changed = False
        sig_tag = activity_type  # e.g. LOITERING, UNUSUAL_STOP, RAPID_MOVEMENT
        if sig_tag not in state.contributing_signals:
            state.contributing_signals.append(sig_tag)
            changed = True

        if incident_id and incident_id not in state.related_incident_ids:
            state.related_incident_ids.append(incident_id)
            changed = True

        if changed:
            lvl, scr, rsn = self.evaluate_human_threat(
                signals=state.contributing_signals,
                face_info=state.face_info,
                zone_name=state.zone_name,
                frames_seen=state.frames_seen
            )
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn
            self._flush_to_db(state, db)
            self._broadcast_event("SECURITY_EVENT_UPDATED", state)

    def attach_night_movement(
        self,
        camera_id: str,
        track_id: int,
        avg_luma: float,
        dark_pixel_ratio: float,
        displacement: float,
        path_length: float,
        incident_id: Optional[str],
        db: Session,
    ):
        """Attaches a night movement signal to the unified security event."""
        cam_store = self._human_events.get(camera_id, {})
        state = cam_store.get(track_id)
        if not state:
            return

        changed = False
        if "NIGHT_MOVEMENT" not in state.contributing_signals:
            state.contributing_signals.append("NIGHT_MOVEMENT")
            changed = True

        if incident_id and incident_id not in state.related_incident_ids:
            state.related_incident_ids.append(incident_id)
            changed = True

        if changed:
            lvl, scr, rsn = self.evaluate_human_threat(
                signals=state.contributing_signals,
                face_info=state.face_info,
                zone_name=state.zone_name,
                frames_seen=state.frames_seen
            )
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn
            self._flush_to_db(state, db)
            self._broadcast_event("SECURITY_EVENT_UPDATED", state)

    # ─────────────────────────────────────────────────────────────────────────
    # INGESTION METHODS (VEHICLE SUBJECTS)
    # ─────────────────────────────────────────────────────────────────────────

    def ingest_vehicle_signals(
        self,
        camera_id: str,
        track_id: int,
        vehicle_class: str,
        plate_text: Optional[str],
        plate_confidence: float,
        format_valid: bool,
        direction: str,
        timestamp_sec: float,
        db: Session,
        camera_name: Optional[str] = None,
    ) -> UnifiedEventState:
        """
        Ingests vehicle telemetry for camera_id + VTRK#track_id.
        Strictly isolated from human security events. Vehicles never trigger human incidents.
        """
        now_ts = time.time()
        now_dt = datetime.fromtimestamp(timestamp_sec, timezone.utc) if timestamp_sec > 1000000000 else _utcnow()

        if camera_id not in self._vehicle_events:
            self._vehicle_events[camera_id] = {}

        cam_store = self._vehicle_events[camera_id]
        state = cam_store.get(track_id)

        v_info = {
            "vehicle_class": vehicle_class,
            "plate_text": plate_text,
            "plate_confidence": plate_confidence,
            "format_valid": format_valid,
            "direction": direction,
        }

        if state is None:
            event_id = f"SEC-EVT-V-{uuid.uuid4().hex[:8].upper()}"
            cam_name = camera_name or self._get_camera_name(camera_id, db)
            state = UnifiedEventState(
                event_id=event_id,
                camera_id=camera_id,
                camera_name=cam_name,
                subject_type="vehicle",
                track_id=track_id,
                track_label=f"VTRK#{track_id}",
            )
            state.first_seen_ts = now_ts
            state.first_seen_dt = now_dt
            state.last_seen_ts = now_ts
            state.last_seen_dt = now_dt
            state.vehicle_info = v_info
            state.contributing_signals = ["VEHICLE_TRANSIT"]
            if plate_text:
                state.contributing_signals.append("PLATE_RECOGNIZED")

            lvl, scr, rsn = self.evaluate_vehicle_threat(vehicle_class, plate_text, format_valid)
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn

            try:
                db_event = SecurityEventModel(
                    id=state.id,
                    event_id=state.event_id,
                    camera_id=state.camera_id,
                    camera_name=state.camera_name,
                    subject_type="vehicle",
                    track_id=state.track_id,
                    track_label=state.track_label,
                    threat_level=state.threat_level,
                    threat_score=state.threat_score,
                    threat_reason=state.threat_reason,
                    status="active",
                    contributing_signals=state.contributing_signals,
                    related_incident_ids=[],
                    related_evidence_ids=[],
                    snapshot_url="",
                    face_info=None,
                    vehicle_info=v_info,
                    first_seen=state.first_seen_dt,
                    last_seen=state.last_seen_dt,
                    created_at=state.first_seen_dt,
                    updated_at=state.last_seen_dt,
                )
                db.add(db_event)
                db.commit()
                state.last_db_sync_ts = now_ts
            except Exception as db_err:
                logger.error(f"[SecurityIntelligence] Failed to insert vehicle security_event for VTRK#{track_id}: {db_err}")

            if len(cam_store) >= self.MAX_TRACKS_PER_CAMERA:
                oldest_tid = min(cam_store.keys(), key=lambda k: cam_store[k].last_seen_ts)
                cam_store.pop(oldest_tid, None)

            cam_store[track_id] = state
            self._broadcast_event("SECURITY_EVENT_UPDATED", state)
            self._notify_c2(state, db)
        else:
            state.last_seen_ts = now_ts
            state.last_seen_dt = now_dt
            state.frames_seen += 1
            state.vehicle_info = v_info
            if plate_text and "PLATE_RECOGNIZED" not in state.contributing_signals:
                state.contributing_signals.append("PLATE_RECOGNIZED")

            lvl, scr, rsn = self.evaluate_vehicle_threat(vehicle_class, plate_text, format_valid)
            state.threat_level = lvl
            state.threat_score = scr
            state.threat_reason = rsn

            if now_ts - state.last_db_sync_ts >= self.DB_SYNC_INTERVAL_SEC:
                state.last_db_sync_ts = now_ts
                self._flush_to_db(state, db)

        return state

    # ─────────────────────────────────────────────────────────────────────────
    # LIFECYCLE & STALE TRACK REAPING
    # ─────────────────────────────────────────────────────────────────────────

    def reap_stale_events(
        self,
        camera_id: str,
        active_human_track_ids: List[int],
        active_vehicle_track_ids: Optional[List[int]] = None,
        timeout_sec: Optional[float] = None,
        db: Optional[Session] = None,
    ) -> List[UnifiedEventState]:
        """
        Transitions tracks that have disappeared or exceeded timeout from ACTIVE to RESOLVED.
        Frees memory and updates database status.
        """
        now_ts = time.time()
        timeout = timeout_sec or self.RESOLUTION_TIMEOUT_SEC
        resolved_list: List[UnifiedEventState] = []

        # 1. Human tracks
        if camera_id in self._human_events:
            active_set = set(active_human_track_ids)
            cam_store = self._human_events[camera_id]
            to_remove = []

            for tid, state in cam_store.items():
                is_missing = tid not in active_set
                is_timed_out = (now_ts - state.last_seen_ts) >= timeout
                if is_missing and is_timed_out and state.status == "active":
                    state.status = "resolved"
                    resolved_list.append(state)
                    to_remove.append(tid)
                    if db:
                        self._flush_to_db(state, db)
                    self._broadcast_event("SECURITY_EVENT_RESOLVED", state)

            for tid in to_remove:
                cam_store.pop(tid, None)

        # 2. Vehicle tracks
        if active_vehicle_track_ids is not None and camera_id in self._vehicle_events:
            active_vset = set(active_vehicle_track_ids)
            cam_vstore = self._vehicle_events[camera_id]
            to_remove_v = []

            for tid, state in cam_vstore.items():
                is_missing = tid not in active_vset
                is_timed_out = (now_ts - state.last_seen_ts) >= timeout
                if is_missing and is_timed_out and state.status == "active":
                    state.status = "resolved"
                    resolved_list.append(state)
                    to_remove_v.append(tid)
                    if db:
                        self._flush_to_db(state, db)

            for tid in to_remove_v:
                cam_vstore.pop(tid, None)

        return resolved_list

    # ─────────────────────────────────────────────────────────────────────────
    # QUERIES / GETTERS
    # ─────────────────────────────────────────────────────────────────────────

    def get_active_events(self, camera_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns all currently active unified security events across all or one camera."""
        results: List[Dict[str, Any]] = []
        cams = [camera_id] if camera_id else list(self._human_events.keys())
        for c in cams:
            for state in self._human_events.get(c, {}).values():
                if state.status == "active":
                    results.append(state.to_dict())
            for state in self._vehicle_events.get(c, {}).values():
                if state.status == "active":
                    results.append(state.to_dict())
        return results

    def get_active_states(self, camera_id: Optional[str] = None) -> List[UnifiedEventState]:
        """Returns all currently active UnifiedEventState objects across all or one camera."""
        results: List[UnifiedEventState] = []
        cams = [camera_id] if camera_id else list(self._human_events.keys())
        for c in cams:
            for state in self._human_events.get(c, {}).values():
                if state.status == "active":
                    results.append(state)
            for state in self._vehicle_events.get(c, {}).values():
                if state.status == "active":
                    results.append(state)
        return results

    def get_subject_context(self, camera_id: str, track_id: int) -> Optional[Dict[str, Any]]:
        """Returns subject context for a specific human track."""
        state = self._human_events.get(camera_id, {}).get(track_id)
        if state:
            return state.to_dict()
        return None

    def get_vehicle_context(self, camera_id: str, track_id: int) -> Optional[Dict[str, Any]]:
        """Returns context for a specific vehicle track."""
        state = self._vehicle_events.get(camera_id, {}).get(track_id)
        if state:
            return state.to_dict()
        return None

    def reset_camera(self, camera_id: str):
        """Clears in-memory store for a camera feed."""
        self._human_events.pop(camera_id, None)
        self._vehicle_events.pop(camera_id, None)

    # ─────────────────────────────────────────────────────────────────────────
    # INTERNAL HELPERS
    # ─────────────────────────────────────────────────────────────────────────

    def _flush_to_db(self, state: UnifiedEventState, db: Session):
        """Synchronizes in-memory UnifiedEventState fields with existing SecurityEventModel row."""
        try:
            db_rec = db.query(SecurityEventModel).filter(SecurityEventModel.id == state.id).first()
            if db_rec:
                db_rec.threat_level = state.threat_level
                db_rec.threat_score = state.threat_score
                db_rec.threat_reason = state.threat_reason
                db_rec.status = state.status
                db_rec.contributing_signals = list(state.contributing_signals)
                db_rec.related_incident_ids = list(state.related_incident_ids)
                db_rec.related_evidence_ids = list(state.related_evidence_ids)
                db_rec.snapshot_url = state.snapshot_url
                db_rec.face_info = state.face_info
                db_rec.vehicle_info = state.vehicle_info
                db_rec.last_seen = state.last_seen_dt
                db_rec.updated_at = _utcnow()
                db.commit()
            else:
                db_rec = SecurityEventModel(
                    id=state.id,
                    event_id=state.event_id,
                    camera_id=state.camera_id,
                    camera_name=state.camera_name,
                    subject_type=state.subject_type,
                    track_id=state.track_id,
                    track_label=state.track_label,
                    threat_level=state.threat_level,
                    threat_score=state.threat_score,
                    threat_reason=state.threat_reason,
                    status=state.status,
                    contributing_signals=list(state.contributing_signals),
                    related_incident_ids=list(state.related_incident_ids),
                    related_evidence_ids=list(state.related_evidence_ids),
                    snapshot_url=state.snapshot_url,
                    face_info=state.face_info,
                    vehicle_info=state.vehicle_info,
                    first_seen=state.first_seen_dt,
                    last_seen=state.last_seen_dt,
                    created_at=state.first_seen_dt,
                    updated_at=_utcnow(),
                )
                db.add(db_rec)
                db.commit()
        except Exception as err:
            logger.error(f"[SecurityIntelligence] Failed to flush event {state.event_id} to DB: {err}")

        # Non-blocking C2 notification
        self._notify_c2(state, db)

    def _broadcast_event(self, event_type: str, state: UnifiedEventState):
        """Dispatches thread-safe WebSocket broadcast with deduplication."""
        now_ts = time.time()
        # Rate-limit WebSocket updates to at most once per 1.5 seconds per track unless resolving
        if event_type != "SECURITY_EVENT_RESOLVED" and (now_ts - state.last_ws_broadcast_ts < 1.5):
            return

        state.last_ws_broadcast_ts = now_ts
        try:
            broadcast_event_sync(event_type, state.to_dict())
        except Exception as ws_err:
            logger.warning(f"[SecurityIntelligence] WebSocket broadcast failed for {state.event_id}: {ws_err}")

    def _notify_c2(self, state: UnifiedEventState, db: Optional[Session] = None):
        """Dispatches unified security event to C2 integration layer asynchronously without blocking."""
        try:
            from integrations.c2 import c2_adapter
            c2_adapter.notify_security_event(state, db=db)
        except Exception as c2_err:
            logger.debug(f"[SecurityIntelligence] C2 notification skipped/failed: {c2_err}")


# Global singleton instance
security_intelligence_engine = UnifiedSecurityIntelligenceEngine()
