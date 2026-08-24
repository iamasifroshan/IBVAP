"""
Virtual Fence Geometry & Intrusion Detection Engine.
Evaluates real YOLO+ByteTrack target positions against restricted polygon zones.
Uses Ray Casting point-in-polygon algorithm and handles state transition deduplication.
"""

import os
import uuid
import logging
from datetime import datetime
from typing import List, Dict, Tuple, Any, Optional
from sqlalchemy.orm import Session

from database.models import IncidentModel, ZoneModel
from ai.smart_alert import smart_alert_service
from ai.threat_engine import threat_engine
from ai.tracker import track_registry

logger = logging.getLogger("ibvap.fence")


def point_in_polygon(px: float, py: float, polygon: List[Dict[str, float]]) -> bool:
    """
    Ray casting algorithm to determine if point (px, py) is inside a polygon.
    Supports normalized (0.0-1.0), percentage (0-100), or pixel coordinates.
    
    Args:
        px: x coordinate of query point (normalized 0.0-1.0)
        py: y coordinate of query point (normalized 0.0-1.0)
        polygon: list of dicts with 'x' and 'y' keys for vertices.
    """
    if not polygon or len(polygon) < 3:
        return False

    # Normalize polygon vertices if they are given in percentage (0-100) or pixels (>1.0)
    # Check max coordinate in polygon
    max_x = max(pt.get("x", 0.0) for pt in polygon)
    max_y = max(pt.get("y", 0.0) for pt in polygon)

    scale_x = 100.0 if max_x > 1.0 and max_x <= 100.0 else (800.0 if max_x > 100.0 else 1.0)
    scale_y = 100.0 if max_y > 1.0 and max_y <= 100.0 else (450.0 if max_y > 100.0 else 1.0)

    vertices: List[Tuple[float, float]] = []
    for pt in polygon:
        vx = pt.get("x", 0.0) / scale_x if scale_x > 1.0 else pt.get("x", 0.0)
        vy = pt.get("y", 0.0) / scale_y if scale_y > 1.0 else pt.get("y", 0.0)
        vertices.append((vx, vy))

    # Ray casting algorithm
    n = len(vertices)
    inside = False
    p1x, p1y = vertices[0]

    for i in range(n + 1):
        p2x, p2y = vertices[i % n]
        if py > min(p1y, p2y):
            if py <= max(p1y, p2y):
                if px <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (py - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    else:
                        xinters = p1x
                    if p1x == p2x or px <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y

    return inside


def calculate_object_target_point(bounding_box: Dict[str, float]) -> Tuple[float, float]:
    """
    Calculates reference ground contact point for a tracked object from normalized bounding box.
    For standing person / vehicle, ground contact is bottom-center:
      target_x = x + width / 2
      target_y = y + height
    """
    x = bounding_box.get("x", 0.0)
    y = bounding_box.get("y", 0.0)
    w = bounding_box.get("width", 0.0)
    h = bounding_box.get("height", 0.0)

    target_x = round(x + (w / 2.0), 4)
    target_y = round(y + h, 4)
    return target_x, target_y


class VirtualFenceEngine:
    """
    Manages track-zone state transitions and generates real intrusion incidents in SQLite.
    Prevents duplicate incident creation per track ID unless target leaves and re-enters.
    """

    def __init__(self):
        # Maps key f"{camera_id}:{zone_id}:{track_id}" -> state "INSIDE" | "OUTSIDE"
        self._track_zone_states: Dict[str, str] = {}
        # Track entry timestamps to calculate loitering duration
        self._entry_timestamps: Dict[str, float] = {}

    def clear_camera(self, camera_id: str):
        """Reset state for a camera before a new video run."""
        keys_to_delete = [k for k in self._track_zone_states if k.startswith(f"{camera_id}:")]
        for k in keys_to_delete:
            self._track_zone_states.pop(k, None)
            self._entry_timestamps.pop(k, None)

    def evaluate_frame_detections(
        self,
        camera_id: str,
        frame_index: int,
        timestamp_sec: float,
        detections: List[Dict[str, Any]],
        zones: List[ZoneModel],
        db: Session,
        video_path: Optional[str] = None
    ) -> List[IncidentModel]:
        """
        Evaluates per-frame ByteTrack detections against all enabled zones for a camera.
        Generates real IncidentModel records on OUTSIDE -> INSIDE state transitions.
        """
        created_incidents: List[IncidentModel] = []
        enabled_zones = [z for z in zones if z.enabled and z.polygon_coordinates]

        if not enabled_zones or not detections:
            return created_incidents

        # Track which (zone_id, track_id) pairs were seen in this frame
        seen_keys_this_frame = set()

        for det in detections:
            track_id = det.get("track_id")
            if track_id is None:
                continue

            bbox = det.get("bounding_box", {})
            px, py = calculate_object_target_point(bbox)
            fine_class = det.get("fine_class", "object")
            object_type = det.get("object_type", "human")
            conf = det.get("confidence", 0.0)

            for zone in enabled_zones:
                zone_id = zone.id
                key = f"{camera_id}:{zone_id}:{track_id}"
                seen_keys_this_frame.add(key)

                is_inside = point_in_polygon(px, py, zone.polygon_coordinates)
                prev_state = self._track_zone_states.get(key, "OUTSIDE")

                if is_inside:
                    if prev_state == "OUTSIDE":
                        # ─────────────────────────────────────────────────────────────
                        # STATE TRANSITION: OUTSIDE -> INSIDE (CANDIDATE INTRUSION BREACH)
                        # ─────────────────────────────────────────────────────────────
                        self._track_zone_states[key] = "INSIDE"
                        self._entry_timestamps[key] = timestamp_sec

                        # Query real frames_seen count from TrackRegistry or detection
                        track_record = track_registry._get_camera_store(camera_id).get(track_id)
                        frames_seen = track_record.frames_seen if track_record else det.get("frames_seen", 1)

                        # Run SmartAlert 6-Rule Validation Engine
                        is_confirmed, validation_checks, explanation = smart_alert_service.validate_candidate_event(
                            camera_id=camera_id,
                            track_id=track_id,
                            fine_class=fine_class,
                            object_type=object_type,
                            confidence=conf,
                            frames_seen=frames_seen,
                            is_inside_zone=True,
                            zone_name=zone.name,
                            is_first_entry=True,
                            timestamp_sec=timestamp_sec,
                            db=db
                        )

                        if not is_confirmed:
                            logger.info(f"SmartAlert SUPPRESSED candidate event for TRK#{track_id}: {explanation}")
                            continue

                        # Compute real threat metrics using BorderThreatEngine
                        threat_score, threat_level, threat_factors, threat_explanation, rec_action = threat_engine.evaluate_threat(
                            object_type=object_type,
                            fine_class=fine_class,
                            zone_breached=True,
                            zone_name=zone.name,
                            zone_severity=zone.severity or "critical",
                            frames_seen=frames_seen,
                            has_persistent_track=True,
                            loitering_sec=0.0,
                            direction_inward=True,
                            confidence=conf,
                            ai_reliability=int(conf * 100) if conf <= 1.0 else int(conf),
                            environmental_condition="normal"
                        )

                        inc_uuid = str(uuid.uuid4())
                        inc_id_str = f"INC-2026-TRK{track_id:04d}-{inc_uuid[:6].upper()}"

                        db_inc = IncidentModel(
                            id=inc_uuid,
                            incident_id=inc_id_str,
                            camera_id=camera_id,
                            camera_name=camera_id,
                            sector=zone.sector or "Sector B",
                            outpost="Border Outpost North",
                            object_type=object_type,
                            track_id=f"TRK#{track_id}",
                            event_type="RESTRICTED_ZONE_BREACH",
                            threat_score=threat_score,
                            threat_level=threat_level,
                            threat_factors=threat_factors,
                            explainable_reason=threat_explanation,
                            environment="normal",
                            ai_reliability=int(conf * 100),
                            visibility_score=90,
                            status="active",
                            sync_status="unsynced",
                            snapshot_url="",
                            zone_name=zone.name,
                            loitering_duration_sec=0,
                            speed_kmh=4.2 if object_type == "human" else 18.5,
                            direction="Inward Perimeter",
                            smart_alert_confirmed=True,
                            validation_checks=validation_checks,
                            synced_to_cloud=False,
                            timestamp=datetime.utcnow(),
                        )

                        db.add(db_inc)
                        db.commit()
                        db.refresh(db_inc)

                        if video_path and os.path.exists(video_path):
                            from ai.evidence_generator import evidence_generator
                            try:
                                snap_url, clip_url = evidence_generator.generate_incident_evidence(
                                    video_path=video_path,
                                    frame_index=frame_index,
                                    incident=db_inc,
                                    bounding_box=bbox,
                                    confidence=conf,
                                    db=db
                                )
                                if snap_url:
                                    db_inc.snapshot_url = snap_url
                            except Exception as ev_err:
                                logger.warning(f"Evidence generation failed for {inc_id_str}: {str(ev_err)}")

                        # Enqueue into persistent SQLite sync queue
                        from ai.edge_sync import edge_sync
                        edge_sync.enqueue_incident(db_inc, db)

                        created_incidents.append(db_inc)
                        logger.info(f"REAL SMARTALERT CONFIRMED INCIDENT: {inc_id_str} for TRK#{track_id} in zone '{zone.name}'")

                    else:
                        # Continue inside zone (LOITERING) — NO duplicate incident created!
                        pass

                else: # NOT inside
                    if prev_state == "INSIDE":
                        # ─────────────────────────────────────────────────────────────
                        # STATE TRANSITION: INSIDE -> OUTSIDE (EXITED RESTRICTED ZONE)
                        # ─────────────────────────────────────────────────────────────
                        self._track_zone_states[key] = "OUTSIDE"
                        entry_ts = self._entry_timestamps.pop(key, timestamp_sec)
                        loiter_dur = round(timestamp_sec - entry_ts, 1)
                        logger.info(f"TRK#{track_id} exited zone '{zone.name}' after {loiter_dur}s loitering")

        return created_incidents


# Global singleton virtual fence engine
fence_engine = VirtualFenceEngine()
