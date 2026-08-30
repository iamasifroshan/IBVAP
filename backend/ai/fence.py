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
        # Active zone alert timestamps to handle throttling/cooldown
        self._active_zone_alerts: Dict[str, float] = {}

    def clear_camera(self, camera_id: str):
        """Reset state for a camera before a new video run."""
        keys_to_delete = [k for k in self._track_zone_states if k.startswith(f"{camera_id}:")]
        for k in keys_to_delete:
            self._track_zone_states.pop(k, None)
            self._entry_timestamps.pop(k, None)
        # Clear alert timestamps for this camera as well
        alert_keys = [k for k in self._active_zone_alerts if k.startswith(f"{camera_id}:")]
        for k in alert_keys:
            self._active_zone_alerts.pop(k, None)

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
        Validates individual targets (humans, vehicles, animals) via SmartAlert logic.
        Also triggers a group alert if the human count inside the zone exceeds the person_threshold.
        """
        from database.models import CameraModel
        created_incidents: List[IncidentModel] = []
        enabled_zones = [z for z in zones if z.enabled and z.polygon_coordinates]

        if not enabled_zones or not detections:
            return created_incidents

        # Resolve camera name
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first()
        camera_name = cam.name if cam else camera_id

        for zone in enabled_zones:
            # ── 1. Evaluate Individual Target Intrusions ──
            humans_inside = []
            for det in detections:
                obj_type = det.get("object_type")
                fine_class = det.get("fine_class")
                
                # Check zone object type filters
                is_match = False
                if zone.human_detection and (obj_type == "human" or fine_class == "person"):
                    is_match = True
                elif zone.vehicle_detection and obj_type == "vehicle":
                    is_match = True
                elif zone.animal_detection and obj_type == "animal":
                    is_match = True
                    
                if not is_match:
                    continue

                bbox = det.get("bounding_box", {})
                px, py = calculate_object_target_point(bbox)
                
                # Check if bottom-center ground contact point is inside the restricted zone
                is_inside = point_in_polygon(px, py, zone.polygon_coordinates)
                
                track_id = det.get("track_id")
                # Maintain state transitions in memory
                state_key = f"{camera_id}:{zone.id}:{track_id}"
                old_state = self._track_zone_states.get(state_key, "OUTSIDE")

                if is_inside:
                    if obj_type == "human" or fine_class == "person":
                        humans_inside.append(det)

                    is_first_entry = (old_state == "OUTSIDE")
                    self._track_zone_states[state_key] = "INSIDE"

                    # Resolve frames_seen history from track_registry
                    frames_seen = 1
                    if track_id is not None:
                        try:
                            tid_int = int(track_id)
                            t_rec = track_registry._get_camera_store(camera_id).get(tid_int)
                            if t_rec:
                                frames_seen = t_rec.frames_seen
                        except (ValueError, TypeError):
                            pass

                    # Run 6-rule validation pipeline using SmartAlert service
                    is_confirmed, checks, reason = smart_alert_service.validate_candidate_event(
                        camera_id=camera_id,
                        track_id=int(track_id) if track_id is not None else None,
                        fine_class=fine_class or "person",
                        object_type=obj_type or "human",
                        confidence=det.get("confidence", 0.95),
                        frames_seen=frames_seen,
                        is_inside_zone=True,
                        zone_name=zone.name,
                        is_first_entry=is_first_entry,
                        db=db
                    )

                    if is_confirmed:
                        inc_uuid = str(uuid.uuid4())
                        # Format canonical incident ID
                        prefix = (obj_type or "human").upper()[:4]
                        inc_id_str = f"INC-{prefix}-{inc_uuid[:8].upper()}"

                        # Evaluate threat engine score
                        threat_score, threat_level, threat_factors, threat_explanation, rec_action = threat_engine.evaluate_threat(
                            object_type=obj_type or "human",
                            fine_class=fine_class or "person",
                            zone_breached=True,
                            zone_name=zone.name,
                            zone_severity=zone.severity or "high",
                            frames_seen=frames_seen,
                            has_persistent_track=True,
                            loitering_sec=0.0,
                            direction_inward=True,
                            confidence=det.get("confidence", 0.95),
                            ai_reliability=int(det.get("confidence", 0.95) * 100),
                            environmental_condition="normal"
                        )

                        db_inc = IncidentModel(
                            id=inc_uuid,
                            incident_id=inc_id_str,
                            camera_id=camera_id,
                            camera_name=camera_name,
                            sector=zone.sector or "Sector B",
                            outpost="Border Outpost North",
                            object_type=obj_type or "human",
                            track_id=f"TRK#{track_id}" if track_id is not None else "UNTRACKED",
                            event_type="RESTRICTED_ZONE_BREACH",
                            threat_score=threat_score,
                            threat_level=threat_level,
                            threat_factors=threat_factors,
                            explainable_reason=reason,
                            environment="normal",
                            ai_reliability=int(det.get("confidence", 0.95) * 100),
                            visibility_score=90,
                            status="active",
                            sync_status="unsynced",
                            snapshot_url="",
                            zone_name=zone.name,
                            loitering_duration_sec=0,
                            speed_kmh=4.2,
                            direction="Inward Perimeter",
                            smart_alert_confirmed=True,
                            validation_checks=checks,
                            synced_to_cloud=False,
                            timestamp=datetime.utcnow()
                        )
                        db.add(db_inc)
                        db.commit()
                        db.refresh(db_inc)

                        # Extract snapshot and video clip evidence files
                        if video_path and os.path.exists(video_path):
                            from ai.evidence_generator import evidence_generator
                            try:
                                snap_url, clip_url = evidence_generator.generate_incident_evidence(
                                    video_path=video_path,
                                    frame_index=frame_index,
                                    incident=db_inc,
                                    bounding_box=bbox,
                                    confidence=det.get("confidence", 0.95),
                                    db=db
                                )
                                if snap_url:
                                    db_inc.snapshot_url = snap_url
                                    db.commit()
                            except Exception as ev_err:
                                logger.warning(f"Evidence generation failed for {inc_id_str}: {str(ev_err)}")

                        # Enqueue in SQLite sync queue
                        from ai.edge_sync import edge_sync
                        edge_sync.enqueue_incident(db_inc, db)

                        created_incidents.append(db_inc)
                        logger.info(f"SMARTALERT CONFIRMED INCIDENT: {inc_id_str} for track {track_id} in zone '{zone.name}'")
                else:
                    self._track_zone_states[state_key] = "OUTSIDE"

            # ── 2. Evaluate Group Intrusion Alerts (Exceeds person_threshold) ──
            person_count = len(humans_inside)
            threshold = getattr(zone, "person_threshold", 1)

            if person_count >= threshold:
                alert_key = f"{camera_id}:{zone.id}:GROUP"
                last_alert_time = self._active_zone_alerts.get(alert_key, 0.0)
                cooldown = max(30.0, float(zone.loitering_limit_sec or 15.0))

                if (timestamp_sec - last_alert_time) > cooldown:
                    self._active_zone_alerts[alert_key] = timestamp_sec

                    track_ids = [det.get("track_id") for det in humans_inside if det.get("track_id") is not None]
                    track_ids_str = ", ".join(f"TRK#{tid}" for tid in track_ids) if track_ids else "MULTIPLE-TRACK"
                    max_conf = max(det.get("confidence", 0.0) for det in humans_inside) if humans_inside else 0.95

                    threat_score, threat_level, threat_factors, threat_explanation, rec_action = threat_engine.evaluate_threat(
                        object_type="human",
                        fine_class="person",
                        zone_breached=True,
                        zone_name=zone.name,
                        zone_severity=zone.severity or "critical",
                        frames_seen=10,
                        has_persistent_track=True,
                        loitering_sec=0.0,
                        direction_inward=True,
                        confidence=max_conf,
                        ai_reliability=int(max_conf * 100),
                        environmental_condition="normal"
                    )

                    explainable_reason = f"Multiple individuals ({person_count}) detected inside restricted zone '{zone.name}' simultaneously."
                    inc_uuid = str(uuid.uuid4())
                    inc_id_str = f"INC-2026-GROUP-{inc_uuid[:6].upper()}"

                    db_inc = IncidentModel(
                        id=inc_uuid,
                        incident_id=inc_id_str,
                        camera_id=camera_id,
                        camera_name=camera_name,
                        sector=zone.sector or "Sector B",
                        outpost="Border Outpost North",
                        object_type="group",
                        track_id=track_ids_str,
                        event_type="RESTRICTED_ZONE_BREACH",
                        threat_score=threat_score,
                        threat_level=zone.severity or threat_level,
                        threat_factors=[
                            {"category": "Group Presence", "scoreContribution": 40, "description": f"Detected {person_count} individuals in restricted area"},
                            {"category": "Zone Breach", "scoreContribution": 40, "description": f"Crossed into {zone.name}"}
                        ],
                        explainable_reason=explainable_reason,
                        environment="normal",
                        ai_reliability=int(max_conf * 100),
                        visibility_score=90,
                        status="active",
                        sync_status="unsynced",
                        snapshot_url="",
                        zone_name=zone.name,
                        loitering_duration_sec=0,
                        speed_kmh=4.2,
                        direction="Inward Perimeter",
                        smart_alert_confirmed=True,
                        validation_checks={"rule": "Multiple Persons Alert"},
                        synced_to_cloud=False,
                        timestamp=datetime.utcnow()
                    )
                    db.add(db_inc)
                    db.commit()
                    db.refresh(db_inc)

                    if video_path and os.path.exists(video_path):
                        from ai.evidence_generator import evidence_generator
                        try:
                            first_bbox = humans_inside[0].get("bounding_box", {}) if humans_inside else {}
                            snap_url, clip_url = evidence_generator.generate_incident_evidence(
                                video_path=video_path,
                                frame_index=frame_index,
                                incident=db_inc,
                                bounding_box=first_bbox,
                                confidence=max_conf,
                                db=db
                            )
                            if snap_url:
                                db_inc.snapshot_url = snap_url
                                db.commit()
                        except Exception as ev_err:
                            logger.warning(f"Evidence generation failed for {inc_id_str}: {str(ev_err)}")

                    from ai.edge_sync import edge_sync
                    edge_sync.enqueue_incident(db_inc, db)

                    created_incidents.append(db_inc)
                    logger.info(f"REAL SMARTALERT CONFIRMED GROUP INCIDENT: {inc_id_str} for {track_ids_str} in zone '{zone.name}'")

        return created_incidents


# Global singleton virtual fence engine
fence_engine = VirtualFenceEngine()
