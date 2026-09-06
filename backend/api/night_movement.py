"""
Night-Time Movement Detection API Router — Night Events & Analytics Endpoints.
Lightweight, explainable, track-based night movement queries.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database.db import get_db
from database.models import NightMovementModel, CameraModel
from database.schemas import NightMovementResponse, NightMovementStatsResponse

router = APIRouter(tags=["Night-Time Movement Detection"])


@router.get("/night-movements", response_model=List[NightMovementResponse])
def get_night_movements(
    camera_id: Optional[str] = Query(None),
    track_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Query recorded night-time movement events with optional filters.
    """
    q = db.query(NightMovementModel)

    if camera_id:
        cam = db.query(CameraModel).filter(
            (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
        ).first()
        target_id = cam.camera_id if cam else camera_id
        q = q.filter(NightMovementModel.camera_id == target_id)

    if track_id is not None:
        q = q.filter(NightMovementModel.track_id == track_id)

    return q.order_by(NightMovementModel.detected_at.desc()).limit(limit).all()


@router.get("/night-movements/stats", response_model=NightMovementStatsResponse)
def get_night_movement_stats(db: Session = Depends(get_db)):
    """
    Return aggregate statistics for night-time movement events:
    - total count
    - camera breakdown
    """
    total = db.query(NightMovementModel).count()

    cam_counts = (
        db.query(NightMovementModel.camera_id, func.count(NightMovementModel.id))
        .group_by(NightMovementModel.camera_id)
        .all()
    )
    camera_breakdown = {cam_id: count for cam_id, count in cam_counts}

    return {
        "total_night_movements": total,
        "camera_breakdown": camera_breakdown,
    }


@router.get("/cameras/{camera_id}/night-movements", response_model=List[NightMovementResponse])
def get_camera_night_movements(
    camera_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get recent night movements for a specific camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    return (
        db.query(NightMovementModel)
        .filter(NightMovementModel.camera_id == target_id)
        .order_by(NightMovementModel.detected_at.desc())
        .limit(limit)
        .all()
    )
