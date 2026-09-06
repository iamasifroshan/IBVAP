"""
Unified Security Events API Router.
Exposes queries and statistics for correlated security episodes.
"""

from typing import List, Optional, Dict
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from database.db import get_db
from database.models import SecurityEventModel, CameraModel
from database.schemas import SecurityEventResponse, SecurityEventStatsResponse
from ai.security_intelligence import security_intelligence_engine

router = APIRouter(tags=["Unified Security Events"])


def _map_model_to_response(m: SecurityEventModel) -> SecurityEventResponse:
    return SecurityEventResponse(
        id=m.id,
        event_id=m.event_id,
        camera_id=m.camera_id,
        camera_name=m.camera_name or m.camera_id,
        subject_type=m.subject_type or "human",
        track_id=m.track_id,
        track_label=m.track_label or f"TRK#{m.track_id}",
        threat_level=m.threat_level or "low",
        threat_score=m.threat_score or 20,
        threat_reason=m.threat_reason or "Normal subject detection.",
        status=m.status or "active",
        contributing_signals=m.contributing_signals or [],
        related_incident_ids=m.related_incident_ids or [],
        related_evidence_ids=m.related_evidence_ids or [],
        snapshot_url=m.snapshot_url or "",
        face_info=m.face_info,
        vehicle_info=m.vehicle_info,
        first_seen=m.first_seen,
        last_seen=m.last_seen,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@router.get("/security-events", response_model=List[SecurityEventResponse])
def get_security_events(
    camera_id: Optional[str] = Query(None),
    threat_level: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="active, resolved, or None for all"),
    subject_type: Optional[str] = Query(None, description="human or vehicle"),
    track_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Query unified security events with optional filters (camera, threat level, status, subject type, track).
    """
    q = db.query(SecurityEventModel)

    if camera_id:
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first()
        target_id = cam.camera_id if cam else camera_id
        q = q.filter(SecurityEventModel.camera_id == target_id)

    if threat_level:
        q = q.filter(SecurityEventModel.threat_level == threat_level.lower())

    if status:
        q = q.filter(SecurityEventModel.status == status.lower())

    if subject_type:
        q = q.filter(SecurityEventModel.subject_type == subject_type.lower())

    if track_id is not None:
        q = q.filter(SecurityEventModel.track_id == track_id)

    records = q.order_by(SecurityEventModel.last_seen.desc()).offset(offset).limit(limit).all()
    return [_map_model_to_response(r) for r in records]


@router.get("/security-events/stats", response_model=SecurityEventStatsResponse)
def get_security_events_stats(db: Session = Depends(get_db)):
    """
    Return aggregate telemetry statistics for unified security events:
    - total events
    - active events count
    - resolved events count
    - threat level breakdown (critical, high, medium, low)
    - camera breakdown
    - contributing signal breakdown
    """
    total = db.query(SecurityEventModel).count()
    active = db.query(SecurityEventModel).filter(SecurityEventModel.status == "active").count()
    resolved = db.query(SecurityEventModel).filter(SecurityEventModel.status == "resolved").count()

    # Threat level breakdown
    threat_counts = (
        db.query(SecurityEventModel.threat_level, func.count(SecurityEventModel.id))
        .group_by(SecurityEventModel.threat_level)
        .all()
    )
    threat_level_breakdown = {lvl: cnt for lvl, cnt in threat_counts}
    for lvl in ["critical", "high", "medium", "low"]:
        if lvl not in threat_level_breakdown:
            threat_level_breakdown[lvl] = 0

    # Camera breakdown
    cam_counts = (
        db.query(SecurityEventModel.camera_id, func.count(SecurityEventModel.id))
        .group_by(SecurityEventModel.camera_id)
        .all()
    )
    camera_breakdown = {cid: cnt for cid, cnt in cam_counts}

    # Contributing signals breakdown (from stored JSON lists)
    all_events = db.query(SecurityEventModel.contributing_signals).all()
    signal_counts: Dict[str, int] = {}
    for (signals,) in all_events:
        if signals and isinstance(signals, list):
            for sig in signals:
                signal_counts[sig] = signal_counts.get(sig, 0) + 1

    return {
        "total_events": total,
        "active_events": active,
        "resolved_events": resolved,
        "threat_level_breakdown": threat_level_breakdown,
        "camera_breakdown": camera_breakdown,
        "contributing_signal_breakdown": signal_counts,
    }


@router.get("/security-events/{event_id}", response_model=SecurityEventResponse)
def get_security_event_by_id(event_id: str, db: Session = Depends(get_db)):
    """
    Fetch a single unified security event by its human-readable event_id (e.g. SEC-EVT-...) or UUID.
    """
    ev = db.query(SecurityEventModel).filter(
        (SecurityEventModel.event_id == event_id) | (SecurityEventModel.id == event_id)
    ).first()
    if not ev:
        raise HTTPException(status_code=404, detail=f"Security event '{event_id}' not found")
    return _map_model_to_response(ev)


@router.get("/cameras/{camera_id}/security-events", response_model=List[SecurityEventResponse])
def get_camera_security_events(
    camera_id: str,
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get security events for a specific camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    q = db.query(SecurityEventModel).filter(SecurityEventModel.camera_id == target_id)
    if status:
        q = q.filter(SecurityEventModel.status == status.lower())

    records = q.order_by(SecurityEventModel.last_seen.desc()).limit(limit).all()
    return [_map_model_to_response(r) for r in records]
