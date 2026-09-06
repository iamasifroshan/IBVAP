"""
Suspicious Activity API Router — Behavioral Events & Analytics Endpoints.
Lightweight, explainable, track-based suspicious activity queries.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database.db import get_db
from database.models import SuspiciousActivityModel, CameraModel
from database.schemas import SuspiciousActivityResponse, SuspiciousActivityStatsResponse

router = APIRouter(tags=["Suspicious Activity Detection"])


@router.get("/suspicious-activities", response_model=List[SuspiciousActivityResponse])
def get_suspicious_activities(
    camera_id: Optional[str] = Query(None),
    activity_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Query recorded suspicious activities with optional filters.
    """
    q = db.query(SuspiciousActivityModel)

    if camera_id:
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first()
        target_id = cam.camera_id if cam else camera_id
        q = q.filter(SuspiciousActivityModel.camera_id == target_id)

    if activity_type:
        q = q.filter(SuspiciousActivityModel.activity_type == activity_type.upper())

    if severity:
        q = q.filter(SuspiciousActivityModel.severity == severity.upper())

    return q.order_by(SuspiciousActivityModel.detected_at.desc()).limit(limit).all()


@router.get("/suspicious-activities/stats", response_model=SuspiciousActivityStatsResponse)
def get_suspicious_activity_stats(db: Session = Depends(get_db)):
    """
    Return aggregate statistics for suspicious activities:
    - total count
    - activity type breakdown
    - camera breakdown
    - severity breakdown
    """
    total = db.query(SuspiciousActivityModel).count()

    type_counts = (
        db.query(SuspiciousActivityModel.activity_type, func.count(SuspiciousActivityModel.id))
        .group_by(SuspiciousActivityModel.activity_type)
        .all()
    )
    activity_type_breakdown = {act_type: count for act_type, count in type_counts}

    cam_counts = (
        db.query(SuspiciousActivityModel.camera_id, func.count(SuspiciousActivityModel.id))
        .group_by(SuspiciousActivityModel.camera_id)
        .all()
    )
    camera_breakdown = {cam_id: count for cam_id, count in cam_counts}

    sev_counts = (
        db.query(SuspiciousActivityModel.severity, func.count(SuspiciousActivityModel.id))
        .group_by(SuspiciousActivityModel.severity)
        .all()
    )
    severity_breakdown = {sev: count for sev, count in sev_counts}

    return {
        "total_suspicious_activities": total,
        "activity_type_breakdown": activity_type_breakdown,
        "camera_breakdown": camera_breakdown,
        "severity_breakdown": severity_breakdown,
    }


@router.get("/cameras/{camera_id}/suspicious-activities", response_model=List[SuspiciousActivityResponse])
def get_camera_suspicious_activities(
    camera_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get recent suspicious activities for a specific camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    return (
        db.query(SuspiciousActivityModel)
        .filter(SuspiciousActivityModel.camera_id == target_id)
        .order_by(SuspiciousActivityModel.detected_at.desc())
        .limit(limit)
        .all()
    )
