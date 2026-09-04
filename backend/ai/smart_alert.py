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


from datetime import datetime, timezone, timedelta
from config import settings


class SmartAlertConfig:
    """Configurable decision thresholds for SmartAlert engine."""
    def __init__(
        self,
        min_conf_threshold: Optional[float] = None,
        min_valid_frames: Optional[int] = None,
        duplicate_suppression_window_sec: Optional[float] = None,
        loitering_alert_threshold_sec: float = 15.0,
        min_bbox_area_ratio: float = 0.0025,
        min_bbox_aspect_ratio: float = 0.35,
        max_bbox_aspect_ratio: float = 2.80,
    ):
        self.min_conf_threshold = min_conf_threshold if min_conf_threshold is not None else settings.SMART_ALERT_MIN_CONF
        self.min_valid_frames = min_valid_frames if min_valid_frames is not None else settings.SMART_ALERT_MIN_FRAMES
        self.duplicate_suppression_window_sec = duplicate_suppression_window_sec if duplicate_suppression_window_sec is not None else settings.SMART_ALERT_DUPLICATE_WINDOW
        self.loitering_alert_threshold_sec = loitering_alert_threshold_sec
        self.min_bbox_area_ratio = min_bbox_area_ratio
        self.min_bbox_aspect_ratio = min_bbox_aspect_ratio
        self.max_bbox_aspect_ratio = max_bbox_aspect_ratio
        self.strict_person_conf_threshold = 0.85
        self.strict_min_valid_frames = 15


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
        db: Optional[Session] = None,
        bbox: Optional[Dict[str, float]] = None,
        face_metadata: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Dict[str, Any], str, str, bool, float]:
        """
        Runs 7-rule decision pipeline on candidate target detection.

        Rules:
          1. Detection Confidence Threshold (conf >= min_conf)
          2. Same Track ID Confirmation (valid ByteTrack int ID)
          3. Multi-Frame Persistence (frames_seen >= min_valid_frames)
          4. Virtual Fence Relevance (is_inside_zone == True)
          5. Duplicate Suppression (no recent duplicate incident)
          6. Bounding Box Quality (area and aspect ratio checks)
          7. Final SmartAlert Decision

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
        # Gate 1: In-memory state transition (fast path — same session)
        duplicate_passed = is_first_entry
        if duplicate_passed and db is not None and track_id is not None:
            # Gate 2: DB-level check — protects across server restarts.
            # SQLite stores naive UTC strings, so we compare with naive UTC.
            now_utc_naive = datetime.now(timezone.utc).replace(tzinfo=None)
            time_threshold = now_utc_naive - timedelta(seconds=self.config.duplicate_suppression_window_sec)
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


        # ── Rule 6: Bounding Box Quality ──
        bbox_passed = True
        bbox_actual = "Not provided"

        if bbox is not None:
            w = bbox.get("width", 0.0)
            h = bbox.get("height", 0.0)
            area = w * h
            
            if h > 0:
                aspect_ratio = w / h
            else:
                aspect_ratio = 0.0

            from ai.tracker import track_registry
            track_record = track_registry._get_camera_store(camera_id).get(track_id)
            
            is_stable = True
            stability_reason = ""
            
            if track_record and len(track_record.bbox_history) >= 3:
                history = track_record.bbox_history
                # Calculate variance of width/height (size stability)
                widths = [b["width"] for b in history]
                heights = [b["height"] for b in history]
                
                w_range = max(widths) - min(widths)
                h_range = max(heights) - min(heights)
                avg_w = sum(widths) / len(widths)
                avg_h = sum(heights) / len(heights)
                
                # Calculate max single-frame displacement (velocity check).
                # Use center-x and center-y to measure frame-to-frame jump.
                # This correctly allows smooth walkers crossing 80%+ of the frame,
                # while rejecting detections that teleport across the scene in one frame.
                max_x_step = 0.0
                max_y_step = 0.0
                for i in range(1, len(history)):
                    cx_prev = history[i-1]["x"] + history[i-1]["width"] / 2
                    cy_prev = history[i-1]["y"] + history[i-1]["height"] / 2
                    cx_curr = history[i]["x"] + history[i]["width"] / 2
                    cy_curr = history[i]["y"] + history[i]["height"] / 2
                    max_x_step = max(max_x_step, abs(cx_curr - cx_prev))
                    max_y_step = max(max_y_step, abs(cy_curr - cy_prev))
                
                if avg_w > 0 and (w_range / avg_w) > 0.6:
                    is_stable = False
                    stability_reason = "Unstable Width (Flicker)"
                elif avg_h > 0 and (h_range / avg_h) > 0.6:
                    is_stable = False
                    stability_reason = "Unstable Height (Flicker)"
                elif max_x_step > 0.25 or max_y_step > 0.25:
                    # A single-frame jump of >25% of frame width/height is physically
                    # implausible for a real person. This catches tracker ID collisions
                    # and background noise without rejecting legitimate smooth walkers.
                    is_stable = False
                    stability_reason = f"Sudden Jump (max_x_step={max_x_step:.3f}, max_y_step={max_y_step:.3f})"

            if area < self.config.min_bbox_area_ratio:
                bbox_passed = False
                bbox_actual = f"Area too small ({area:.4f} < {self.config.min_bbox_area_ratio})"
            elif aspect_ratio < self.config.min_bbox_aspect_ratio:
                bbox_passed = False
                bbox_actual = f"Aspect ratio too thin ({aspect_ratio:.2f} < {self.config.min_bbox_aspect_ratio})"
            elif aspect_ratio > self.config.max_bbox_aspect_ratio:
                bbox_passed = False
                bbox_actual = f"Aspect ratio too wide ({aspect_ratio:.2f} > {self.config.max_bbox_aspect_ratio})"
            elif not is_stable:
                bbox_passed = False
                bbox_actual = f"Unstable Noise: {stability_reason}"
            else:
                bbox_actual = f"Area={area:.4f}, Aspect={aspect_ratio:.2f}"

        checks["rule6_bbox_quality"] = {
            "passed": bbox_passed,
            "rule": f"Valid geometry (area > {self.config.min_bbox_area_ratio}, {self.config.min_bbox_aspect_ratio} < aspect < {self.config.max_bbox_aspect_ratio})",
            "actual": bbox_actual,
            "status": "PASSED" if bbox_passed else "SUPPRESSED_BACKGROUND_NOISE"
        }

        # ── Rule 7: Identity Verification & Threat Gate ──
        # Identity defaults
        person_name = None
        face_recognized = False
        face_confidence = 0.0
        identity_status = "FACE_UNAVAILABLE"
        
        if face_metadata:
            identity_status = face_metadata.get("identity_status")
            face_det_conf = face_metadata.get("face_detection_confidence")
            if face_det_conf is None or face_det_conf == 0.0:
                face_det_conf = face_metadata.get("confidence", 0.0)
            
            if not identity_status:
                if face_metadata.get("recognized"):
                    identity_status = "KNOWN"
                elif face_metadata.get("confidence", 0.0) > 0.0 or face_metadata.get("name") == "UNKNOWN":
                    identity_status = "UNKNOWN"
                else:
                    identity_status = "FACE_UNAVAILABLE"
                    
            # Prevent false positive clouds: if face detection confidence is too low,
            # it's just background noise, not an UNKNOWN person's face.
            if identity_status == "UNKNOWN" and face_det_conf < settings.FACE_MIN_DETECTION_CONF_FOR_UNKNOWN:
                identity_status = "FACE_UNAVAILABLE"

            face_confidence = face_metadata.get("recognition_confidence", face_metadata.get("confidence", 0.0))
            person_name = face_metadata.get("name")
            face_recognized = face_metadata.get("recognized", False) or (identity_status == "KNOWN")

        face_passed = False
        body_passed = False
        face_actual = identity_status

        # Only apply strict human checks if it's a human/person detection
        if object_type == "human" or fine_class == "person":
            if identity_status == "KNOWN" or face_recognized:
                # PATH: Known person -> NO INCIDENT
                face_passed = False
                body_passed = False
                face_actual = f"Known Person: {person_name or 'KNOWN'}"
                checks["rule7_identity_verification"] = {
                    "passed": False,
                    "rule": "Identity must be confirmed UNKNOWN to trigger an incident",
                    "actual": face_actual,
                    "status": "SUPPRESSED_KNOWN_PERSON"
                }
            elif identity_status == "UNKNOWN":
                # PATH: Confirmed Unknown Face (face detected + SFace compared + no match)
                face_passed = True
                body_passed = True
                face_actual = f"Confirmed Unknown Person (Face Verified, Match Score: {face_confidence*100:.1f}%)"
                checks["rule7_identity_verification"] = {
                    "passed": True,
                    "rule": "Confirmed unknown person (Face detected, SFace evaluated with no enrolled match)",
                    "actual": face_actual,
                    "status": "PASSED"
                }
            elif identity_status == "FACE_PROCESSING_ERROR":
                # PATH: Face detected but embedding/matching failed technically -> NO INCIDENT
                face_passed = False
                body_passed = False
                face_actual = "Face Processing Error"
                checks["rule7_identity_verification"] = {
                    "passed": False,
                    "rule": "Face processing error must not trigger automatic threat incident",
                    "actual": face_actual,
                    "status": "SUPPRESSED_FACE_PROCESSING_ERROR"
                }
            else:
                # PATH: FACE_UNAVAILABLE (no face visible, turned away, occluded, too small) -> NO INCIDENT
                face_passed = False
                body_passed = False
                face_actual = "Face Unavailable / No Usable Face Visible"
                checks["rule7_identity_verification"] = {
                    "passed": False,
                    "rule": "Face unavailable must not trigger automatic threat incident",
                    "actual": face_actual,
                    "status": "SUPPRESSED_FACE_UNAVAILABLE"
                }
        else:
            face_passed = True
            body_passed = True
            checks["rule7_identity_verification"] = {
                "passed": True,
                "rule": "Identity check only applies to human detections",
                "actual": f"Non-human ({fine_class})",
                "status": "PASSED"
            }
                    
        # ── Final Decision ──
        all_passed = (
            conf_passed and
            track_id_passed and
            persistence_passed and
            zone_passed and
            duplicate_passed and
            bbox_passed and
            face_passed and 
            body_passed
        )

        checks["decision"] = "CONFIRMED_INCIDENT" if all_passed else "REJECTED_UNCONFIRMED"

        # Generate human-readable explainable reason
        if all_passed:
            id_text = f"UNKNOWN (Face Verified)" if (identity_status == "UNKNOWN") else f"Identity: {identity_status}"
            explanation = (
                f"SmartAlert CONFIRMED: ByteTrack TRK#{track_id} ({fine_class}) "
                f"passed all validation gates. Confidence: {(confidence * 100):.1f}%, "
                f"Persistence: {frames_seen} frames, Zone: '{zone_name}'. Identity: {id_text}."
            )
        elif not conf_passed:
            explanation = "SmartAlert SUPPRESSED: YOLO confidence below threshold."
        elif not track_id_passed:
            explanation = "SmartAlert SUPPRESSED: Object lacking persistent tracker ID."
        elif not persistence_passed:
            explanation = (
                f"SmartAlert REJECTED (Transient Noise): Single-frame flicker "
                f"({frames_seen} frame < {self.config.min_valid_frames} min required)."
            )
        elif not zone_passed:
            explanation = "SmartAlert SUPPRESSED: Target is outside restricted security zones."
        elif not duplicate_passed:
            explanation = (
                f"SmartAlert SUPPRESSED (Duplicate): TRK#{track_id} already has an active "
                f"intrusion incident in '{zone_name}'."
            )
        elif not bbox_passed:
            explanation = (
                f"SmartAlert REJECTED (False Positive): Bounding box geometry invalid. "
                f"Likely background noise/cloud ({bbox_actual})."
            )
        elif not face_passed and face_recognized:
            explanation = f"SmartAlert SUPPRESSED: Known person authorized ({person_name})."
        elif not face_passed and not body_passed:
            explanation = (
                f"SmartAlert SUPPRESSED: Face identity state is {identity_status}. "
                f"Automatic intrusion incident not triggered without confirmed UNKNOWN identity."
            )
        else:
            failed_rules = [k for k, v in checks.items() if isinstance(v, dict) and not v.get("passed")]
            explanation = f"SmartAlert REJECTED: Failed validation rules: {', '.join(failed_rules)}."

        return all_passed, checks, explanation, person_name, face_recognized, face_confidence

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
