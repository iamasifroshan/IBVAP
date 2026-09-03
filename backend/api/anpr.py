"""
ANPR API Router — License Plate Observation & Statistics Endpoints.
Zero automatic incident creation. Real database state only.
"""

from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database.db import get_db
from database.models import ANPRObservationModel, CameraModel
from database.schemas import ANPRObservationResponse, ANPRStatsResponse
from ai.tracker import track_registry

router = APIRouter(tags=["ANPR"])


# ─────────────────────────────────────────────────────────────────────────────
# GET /cameras/{camera_id}/anpr   — active/recent ANPR observations for camera
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cameras/{camera_id}/anpr", response_model=List[ANPRObservationResponse])
def get_camera_anpr_records(
    camera_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get stored ANPR observations from SQLite for a specific camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    records = (
        db.query(ANPRObservationModel)
        .filter(ANPRObservationModel.camera_id == target_id)
        .order_by(ANPRObservationModel.last_seen.desc())
        .limit(limit)
        .all()
    )
    return records


# ─────────────────────────────────────────────────────────────────────────────
# GET /anpr/stats   — aggregate ANPR plate metrics across all cameras
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anpr/stats", response_model=ANPRStatsResponse)
def get_anpr_stats(db: Session = Depends(get_db)):
    """
    Return aggregate ANPR statistics from database and active memory.
    Source: database ANPRObservationModel records.
    Returns 0 when no plates have been read.
    """
    total_reads = db.query(ANPRObservationModel).count()
    unique_plates = (
        db.query(func.count(func.distinct(ANPRObservationModel.plate_text))).scalar() or 0
    )
    valid_format_count = (
        db.query(ANPRObservationModel)
        .filter(ANPRObservationModel.format_valid == True)
        .count()
    )

    # Per-camera counts
    camera_counts = (
        db.query(ANPRObservationModel.camera_id, func.count(ANPRObservationModel.id))
        .group_by(ANPRObservationModel.camera_id)
        .all()
    )
    by_camera = {cam_id: count for cam_id, count in camera_counts}

    return {
        "total_reads": total_reads,
        "unique_plates": unique_plates,
        "valid_format_count": valid_format_count,
        "by_camera": by_camera,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /anpr/search   — search historical ANPR database records
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anpr/search", response_model=List[ANPRObservationResponse])
def search_anpr_records(
    plate: Optional[str] = Query(None, description="Partial or full plate text"),
    camera_id: Optional[str] = Query(None),
    vehicle_class: Optional[str] = Query(None),
    valid_only: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Search historical ANPR observations database by plate text, camera, or class.
    """
    query = db.query(ANPRObservationModel)

    if plate:
        clean_plate = plate.strip().upper().replace("-", "").replace(" ", "")
        query = query.filter(ANPRObservationModel.plate_text.like(f"%{clean_plate}%"))
    if camera_id:
        query = query.filter(ANPRObservationModel.camera_id == camera_id)
    if vehicle_class:
        query = query.filter(ANPRObservationModel.vehicle_class == vehicle_class.lower())
    if valid_only is not None:
        query = query.filter(ANPRObservationModel.format_valid == valid_only)

    records = query.order_by(ANPRObservationModel.last_seen.desc()).limit(limit).all()
    return records


# ─────────────────────────────────────────────────────────────────────────────
# GET /anpr/{record_id}   — single ANPR record details
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/anpr/{record_id}", response_model=ANPRObservationResponse)
def get_anpr_record_by_id(record_id: str, db: Session = Depends(get_db)):
    """
    Retrieve single ANPR observation record by record ID or ANPR ID.
    """
    rec = (
        db.query(ANPRObservationModel)
        .filter(
            (ANPRObservationModel.id == record_id)
            | (ANPRObservationModel.anpr_id == record_id)
        )
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail=f"ANPR record '{record_id}' not found")
    return rec
