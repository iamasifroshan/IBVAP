"""
BorderThreat Engine — Transparent Rule-Based Scoring Service.
Calculates threat score (0-100), severity level (low/medium/high/critical),
structured threat factors, and human-explainable justification text.
Does NOT pretend to be an unexplainable black-box machine learning model.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Any, Optional
from config import settings

logger = logging.getLogger("ibvap.threat_engine")


class BorderThreatEngine:
    """
    Transparent, rule-based threat assessment service for IBVAP.
    Evaluates real detection & tracking telemetry against configurable scoring weights.
    """

    def __init__(self):
        self.weights = {
            "human": settings.THREAT_HUMAN_WEIGHT,
            "vehicle": settings.THREAT_VEHICLE_WEIGHT,
            "group": settings.THREAT_GROUP_WEIGHT,
            "animal": 5,
            "unknown": 10,
            "zone_breach": settings.THREAT_ZONE_BREACH_WEIGHT,
            "night": settings.THREAT_NIGHT_WEIGHT,
            "persistent_track": settings.THREAT_PERSISTENT_TRACK_WEIGHT,
            "repeated_approach": settings.THREAT_REPEATED_APPROACH_WEIGHT,
        }

    def evaluate_threat(
        self,
        object_type: str = "human",
        fine_class: Optional[str] = None,
        zone_breached: bool = True,
        zone_name: str = "Restricted Area",
        zone_severity: str = "critical",
        time_hour_utc: Optional[int] = None,
        frames_seen: int = 1,
        has_persistent_track: bool = True,
        loitering_sec: float = 0.0,
        direction_inward: bool = True,
        repeated_approach_count: int = 1,
        confidence: float = 0.90,
        ai_reliability: int = 90,
        environmental_condition: str = "normal"
    ) -> Tuple[int, str, List[Dict[str, Any]], str, str]:
        """
        Evaluates real target parameters to compute threat metrics.

        Returns:
          (score: int, level: str, factors: List[dict], explainable_reason: str, recommended_action: str)
        """
        factors: List[Dict[str, Any]] = []
        raw_score = 0.0

        # Resolve time of day
        if time_hour_utc is None:
            time_hour_utc = datetime.now(timezone.utc).hour

        # 1. Object Type Scoring
        obj_type_lower = (object_type or "human").lower()
        fine_class_lower = (fine_class or "").lower()

        if fine_class_lower in ["person", "human"] or obj_type_lower in ["human", "person"]:
            obj_score = self.weights["human"]
            obj_desc = "Human target class identified (+20)"
        elif fine_class_lower in ["car", "bus", "truck", "motorcycle"] or obj_type_lower == "vehicle":
            obj_score = self.weights["vehicle"]
            obj_desc = f"Vehicle target class ({fine_class or 'vehicle'}) identified (+30)"
        elif obj_type_lower == "group":
            obj_score = self.weights["group"]
            obj_desc = "Group intrusion (multiple individuals) identified (+35)"
        elif obj_type_lower == "animal" or fine_class_lower in ["cat", "dog", "cow", "horse", "sheep"]:
            obj_score = self.weights["animal"]
            obj_desc = "Biological quadruped / non-threat animal movement (+5)"
        else:
            obj_score = self.weights["unknown"]
            obj_desc = f"Unclassified object target ({fine_class or 'unknown'}) (+10)"

        factors.append({
            "category": "Object Classification",
            "scoreContribution": obj_score,
            "description": obj_desc
        })
        raw_score += obj_score

        # 2. Restricted Zone Crossing
        if zone_breached:
            zone_score = self.weights["zone_breach"]
            if zone_severity == "critical":
                zone_score += 5
            
            factors.append({
                "category": "Restricted Zone Breach",
                "scoreContribution": zone_score,
                "description": f"Direct boundary crossing into {zone_name} (+{zone_score})"
            })
            raw_score += zone_score

        # 3. Night-Time Activity (Dark Hours: 22:00 - 05:00 UTC)
        is_night_hours = time_hour_utc >= 22 or time_hour_utc <= 5
        if is_night_hours:
            night_score = self.weights["night"]
            factors.append({
                "category": "Restricted Hours Vector",
                "scoreContribution": night_score,
                "description": f"Perimeter movement during dark hours ({time_hour_utc:02d}:00 UTC) (+{night_score})"
            })
            raw_score += night_score

        # 4. Multi-Frame Persistent Tracking
        if has_persistent_track and frames_seen >= 3:
            track_score = self.weights["persistent_track"]
            factors.append({
                "category": "Persistent Tracking Confirmation",
                "scoreContribution": track_score,
                "description": f"ByteTrack persistent ID confirmed across {frames_seen} frames (+{track_score})"
            })
            raw_score += track_score

        # 5. Inward Trajectory Vector
        if direction_inward:
            dir_score = 10
            factors.append({
                "category": "Direction Vector",
                "scoreContribution": dir_score,
                "description": "Target vector directed inward toward protected outpost line (+10)"
            })
            raw_score += dir_score

        # 6. Stationary Loitering
        if loitering_sec > 10.0:
            loiter_score = min(20, int(loitering_sec // 3))
            factors.append({
                "category": "Loitering Duration",
                "scoreContribution": loiter_score,
                "description": f"Stationary loitering inside zone for {int(loitering_sec)}s (+{loiter_score})"
            })
            raw_score += loiter_score

        # 7. Repeated Approach Attempts
        if repeated_approach_count > 1:
            repeat_score = min(15, (repeated_approach_count - 1) * self.weights["repeated_approach"])
            factors.append({
                "category": "Repeated Boundary Approach",
                "scoreContribution": repeat_score,
                "description": f"Target re-approached perimeter boundary {repeated_approach_count} times (+{repeat_score})"
            })
            raw_score += repeat_score

        # 8. Environmental Reliability Penalty
        if ai_reliability < 70:
            penalty = round((70 - ai_reliability) * 0.25)
            factors.append({
                "category": "Environmental Reliability Penalty",
                "scoreContribution": -penalty,
                "description": f"{environmental_condition.upper()} degraded AI reliability to {ai_reliability}% (-{penalty})"
            })
            raw_score -= penalty

        # Normalize score between 0 and 100
        score = max(0, min(100, int(round(raw_score))))

        # Classify Threat Level
        if score >= 80:
            level = "critical"
            recommended_action = "CRITICAL THREAT: Dispatch Quick Reaction Force (QRF) and illuminate perimeter searchlights."
        elif score >= 60:
            level = "high"
            recommended_action = "HIGH THREAT: Command post alert. Maintain active continuous tracking."
        elif score >= 30:
            level = "medium"
            recommended_action = "MEDIUM THREAT: Monitor target trajectory. Operator verification requested."
        else:
            level = "low"
            recommended_action = "LOW THREAT: Nominal observation. Event recorded in EdgeGuard log."

        # Construct Transparent Explainable Reason
        positive_descriptions = [f["description"] for f in factors if f["scoreContribution"] > 0]
        why_str = ", ".join(positive_descriptions) if positive_descriptions else "Baseline activity"

        explainable_reason = (
            f"BorderThreat Score: {score}/100 ({level.upper()}). "
            f"WHY: {why_str}."
        )

        return score, level, factors, explainable_reason, recommended_action


# Global singleton instance
threat_engine = BorderThreatEngine()
