"""
SmartAlert Real Backend Decision & Validation Service.
Consumes real YOLO+ByteTrack detection and tracking telemetry.
Applies 6-rule decision logic to confirm real incidents and suppress transient noise & duplicate alerts.
Calculates actual false alarm reduction rate from real database data.
"""

import logging
from typing import Dict, Any, Tuple, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from database.models import IncidentModel, DetectionModel

logger = logging.getLogger("ibvap.smart_alert")


from datetime import datetime
from config import settings

class SmartAlertConfig:
    """Configurable decision thresholds for SmartAlert engine."""
    def __init__(
        self,
        min_conf_threshold: Optional[float] = None,
        min_valid_frames: Optional[int] = None,
        duplicate_suppression_window_sec: Optional[float] = None,
        loitering_alert_threshold_sec: float = 15.0,
    ):
        self.min_conf_threshold = min_conf_threshold if min_conf_threshold is not None else settings.SMART_ALERT_MIN_CONF
        self.min_valid_frames = min_valid_frames if min_valid_frames is not None else settings.SMART_ALERT_MIN_FRAMES
        self.duplicate_suppression_window_sec = duplicate_suppression_window_sec if duplicate_suppression_window_sec is not None else settings.SMART_ALERT_DUPLICATE_WINDOW
        self.loitering_alert_threshold_sec = loitering_alert_threshold_sec


class SmartAlertService:
    """
    Real AI Decision Validation Engine for IBVAP.
    Validates candidate target detections against 6 strict rules before confirming an incident.
    """

    def __init__(self, config: Optional[SmartAlertConfig] = None):
        self.config = config or SmartAlertConfig()

    def validate_candidate_event(
        self,
        camera_id: str,
        track_id: Optional[int],
        fine_class: str,
        object_type: str,
        confidence: float,
        frames_seen: int,
        is_inside_zone: bool,
        zone_name: str,
        is_first_entry: bool,
        timestamp_sec: float = 0.0,
        db: Optional[Session] = None
    ) -> Tuple[bool, Dict[str, Any], str]:
        """
        Runs 6-rule decision pipeline on candidate target detection.

        Rules:
          1. Detection Confidence Threshold (conf >= min_conf)
          2. Same Track ID Confirmation (valid ByteTrack int ID)
          3. Multi-Frame Persistence (frames_seen >= min_valid_frames)
          4. Virtual Fence Relevance (is_inside_zone == True)
          5. Duplicate Suppression (no recent duplicate incident)
          6. Final SmartAlert Decision

        Returns:
          (is_confirmed: bool, validation_checks: dict, explanation: str)
        """
        checks: Dict[str, Any] = {}

        # ── Rule 1: Detection Confidence Threshold ──
        conf_passed = confidence >= self.config.min_conf_threshold
        checks["rule1_confidence_threshold"] = {
            "passed": conf_passed,
            "rule": f"Confidence >= {self.config.min_conf_threshold * 100:.1f}%",
            "actual": f"{(confidence * 100):.1f}%",
            "status": "PASSED" if conf_passed else "FAILED"
        }

        # ── Rule 2: Same Track ID Confirmation ──
        track_id_passed = track_id is not None and track_id > 0
        checks["rule2_same_track_id"] = {
            "passed": track_id_passed,
            "rule": "Valid ByteTrack Persistent Integer ID",
            "actual": f"TRK#{track_id}" if track_id_passed else "UNTRACKED_FLICKER",
            "status": "PASSED" if track_id_passed else "FAILED"
        }

        # ── Rule 3: Multi-Frame Persistence ──
        persistence_passed = frames_seen >= self.config.min_valid_frames
        checks["rule3_multiframe_persistence"] = {
            "passed": persistence_passed,
            "rule": f"Frames Seen >= {self.config.min_valid_frames} min frames",
            "actual": f"{frames_seen} frames",
            "status": "PASSED" if persistence_passed else "SUPPRESSED_TRANSIENT_NOISE"
        }

        # ── Rule 4: Virtual Fence Relevance ──
        zone_passed = is_inside_zone
        checks["rule4_virtual_fence_relevance"] = {
            "passed": zone_passed,
            "rule": "Ground contact point inside restricted polygon",
            "actual": f"Inside '{zone_name}'" if zone_passed else "Outside restricted zone",
            "status": "PASSED" if zone_passed else "FAILED"
        }

        # ── Rule 5: Duplicate Suppression ──
        duplicate_passed = is_first_entry
        if duplicate_passed and db is not None and track_id is not None:
            from datetime import timedelta
            time_threshold = datetime.utcnow() - timedelta(seconds=self.config.duplicate_suppression_window_sec)
            # Check if there is an existing active incident for this camera and track within the duplicate window
            existing_inc = db.query(IncidentModel).filter(
                IncidentModel.camera_id == camera_id,
                (IncidentModel.track_id == f"TRK#{track_id}") | (IncidentModel.track_id == str(track_id)),
                IncidentModel.timestamp >= time_threshold
            ).first()
            if existing_inc is not None:
                duplicate_passed = False

        checks["rule5_duplicate_suppression"] = {
            "passed": duplicate_passed,
            "rule": "First entry state transition for target",
            "actual": "First entry" if duplicate_passed else "Already inside (loitering)",
            "status": "PASSED" if duplicate_passed else "SUPPRESSED_DUPLICATE"
        }

        # ── Rule 6: Final Decision ──
        all_passed = (
            conf_passed and
            track_id_passed and
            persistence_passed and
            zone_passed and
            duplicate_passed
        )

        checks["decision"] = "CONFIRMED_INCIDENT" if all_passed else "REJECTED_UNCONFIRMED"

        # Generate human-readable explainable reason
        if all_passed:
            explanation = (
                f"SmartAlert CONFIRMED: ByteTrack TRK#{track_id} ({fine_class}) "
                f"passed 5/5 validation checks. Confidence: {(confidence * 100):.1f}%, "
                f"Persistence: {frames_seen} frames, Zone: '{zone_name}'."
            )
        elif not persistence_passed:
            explanation = (
                f"SmartAlert REJECTED (Transient Noise): Single-frame flicker "
                f"({frames_seen} frame < {self.config.min_valid_frames} min required)."
            )
        elif not duplicate_passed:
            explanation = (
                f"SmartAlert SUPPRESSED (Duplicate): TRK#{track_id} already has an active "
                f"intrusion incident in '{zone_name}'."
            )
        else:
            failed_rules = [k for k, v in checks.items() if isinstance(v, dict) and not v.get("passed")]
            explanation = f"SmartAlert REJECTED: Failed validation rules: {', '.join(failed_rules)}."

        return all_passed, checks, explanation


    def calculate_false_alarm_reduction_rate(self, db: Session) -> float:
        """
        Calculates actual false alarm reduction percentage from real database data.
        Formula: ((Total Candidate Detections - Confirmed Incidents) / Total Candidate Detections) * 100
        Returns 0.0 if no detections exist yet.
        """
        total_detections = db.query(DetectionModel).count()
        if total_detections == 0:
            return 0.0

        confirmed_incidents = db.query(IncidentModel).filter(IncidentModel.smart_alert_confirmed == True).count()

        reduction_rate = max(0.0, ((total_detections - confirmed_incidents) / total_detections) * 100.0)
        return round(reduction_rate, 1)


# Global singleton SmartAlert service instance
smart_alert_service = SmartAlertService()
