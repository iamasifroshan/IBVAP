from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from database.db import get_db
from database.models import CameraModel
from database.schemas import CameraResponse, CameraCreate
from video.stream_manager import stream_manager

router = APIRouter(prefix="/cameras", tags=["Cameras"])

def map_camera_to_response(c: CameraModel) -> CameraResponse:
    return CameraResponse(
        id=c.id,
        camera_id=c.camera_id,
        name=c.name,
        sector=c.sector,
        outpost=c.outpost,
        source_type=c.source_type,
        source_url=c.source_url,
        status=c.status,
        health_score=c.health_score,
        visibility_score=c.visibility_score,
        lighting_lux=c.lighting_lux,
        ai_reliability=c.ai_reliability,
        adaptive_processing_mode=c.adaptive_processing_mode,
        human_verification_required=c.human_verification_required,
        verification_recommendation=c.verification_recommendation,
        active_zone=c.active_zone,
        last_activity=c.last_activity,
        night_vision_mode=c.night_vision_mode,
        dehaze_enabled=c.dehaze_enabled,
        created_at=c.created_at,
        # CamelCase Aliases for Frontend
        protocol=c.source_type,
        streamUrl=c.source_url,
        healthScore=c.health_score,
        visibilityScore=c.visibility_score,
        lightingLux=c.lighting_lux,
        aiReliability=c.ai_reliability,
        adaptiveProcessingMode=c.adaptive_processing_mode,
        humanVerificationRequired=c.human_verification_required,
        verificationRecommendation=c.verification_recommendation,
        activeZone=c.active_zone,
        lastActivity=c.last_activity,
        nightVisionMode=c.night_vision_mode,
        dehazeEnabled=c.dehaze_enabled,
        auto_start_inference=c.auto_start_inference,
        autoStartInference=c.auto_start_inference
    )

@router.get("", response_model=List[CameraResponse])
def get_cameras(db: Session = Depends(get_db)):
    cameras = db.query(CameraModel).all()
    return [map_camera_to_response(c) for c in cameras]

@router.get("/{camera_id}", response_model=CameraResponse)
def get_camera_by_id(camera_id: str, db: Session = Depends(get_db)):
    c = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
    return map_camera_to_response(c)

@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
def create_camera(camera_in: CameraCreate, db: Session = Depends(get_db)):
    existing = db.query(CameraModel).filter(CameraModel.camera_id == camera_in.camera_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Camera with ID '{camera_in.camera_id}' already exists")

    # Verify source if one is provided — report real status, never fake ONLINE
    source_status = "offline"
    health_score = camera_in.health_score
    resolution = camera_in.resolution if hasattr(camera_in, 'resolution') else "Unknown"
    last_activity = camera_in.last_activity

    if camera_in.source_url:
        verify = stream_manager.verify_camera_source(camera_in.source_url, camera_in.source_type)
        source_status = verify["status"]
        health_score = verify["health_score"]
        if verify["resolution"] and verify["resolution"] != "N/A":
            resolution = verify["resolution"]
        if source_status.upper() == "ONLINE":
            last_activity = "Stream verified online"
        elif source_status.upper() == "DEGRADED":
            last_activity = "Stream degraded - limited frames"
        else:
            last_activity = f"Offline: {verify.get('error', 'Stream unavailable')[:80]}"

    cam_id = camera_in.id or str(uuid.uuid4())
    db_cam = CameraModel(
        id=cam_id,
        camera_id=camera_in.camera_id,
        name=camera_in.name,
        sector=camera_in.sector,
        outpost=camera_in.outpost,
        source_type="SIMULATED_FILE" if camera_in.source_type == "MP4_FILE" else camera_in.source_type,
        source_url=camera_in.source_url,
        status=source_status,
        health_score=health_score,
        visibility_score=camera_in.visibility_score,
        lighting_lux=camera_in.lighting_lux,
        ai_reliability=camera_in.ai_reliability,
        adaptive_processing_mode=camera_in.adaptive_processing_mode,
        human_verification_required=camera_in.human_verification_required,
        verification_recommendation=camera_in.verification_recommendation,
        active_zone=camera_in.active_zone,
        last_activity=last_activity,
        night_vision_mode=camera_in.night_vision_mode,
        dehaze_enabled=camera_in.dehaze_enabled,
        auto_start_inference=camera_in.auto_start_inference,
    )
    db.add(db_cam)
    db.commit()
    db.refresh(db_cam)
    return map_camera_to_response(db_cam)

@router.post("/{camera_id}/test-source")
def test_camera_source(camera_id: str, db: Session = Depends(get_db)):
    """
    Tests whether the camera's current source URL is reachable.
    Updates camera status to reflect real backend source state.
    Never fakes ONLINE status.
    """
    c = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    verify = stream_manager.verify_camera_source(c.source_url, c.source_type)

    # Persist real verified state into DB
    c.status = verify["status"]
    c.health_score = verify["health_score"]
    if verify.get("resolution") and verify["resolution"] not in ("N/A", "Unknown", "0x0"):
        c.resolution = verify["resolution"]
    if verify.get("fps") and verify["fps"] > 0:
        c.fps = int(verify["fps"])

    status_upper = verify["status"].upper()
    if status_upper == "ONLINE":
        c.last_activity = f"Source verified — {verify['resolution']} @ {verify['fps']:.0f}fps"
    elif status_upper == "DEGRADED":
        c.last_activity = "Source degraded — limited frame response"
    else:
        c.last_activity = f"Offline: {verify.get('error', 'Stream unavailable')[:100]}"

    db.commit()

    return {
        "camera_id": c.camera_id,
        "source_type": verify["source_type"],
        "source_url_sanitized": verify["sanitized_url"],
        "status": verify["status"],
        "health_score": verify["health_score"],
        "resolution": verify.get("resolution", "N/A"),
        "fps": verify.get("fps", 0.0),
        "error": verify.get("error"),
        "message": f"Camera source test complete. Status: {verify['status'].upper()}"
    }

@router.patch("/{camera_id}/source")
def update_camera_source(
    camera_id: str,
    source_url: str,
    source_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Update camera source URL and verify the new source.
    Reflects real backend status — does not claim ONLINE if stream is unavailable.
    """
    c = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    verify = stream_manager.verify_camera_source(source_url, source_type)

    c.source_url = source_url
    if source_type:
        c.source_type = "SIMULATED_FILE" if source_type == "MP4_FILE" else source_type
    c.status = verify["status"]
    c.health_score = verify["health_score"]
    if verify.get("resolution") and verify["resolution"] not in ("N/A", "Unknown", "0x0"):
        c.resolution = verify["resolution"]
    if verify.get("fps") and verify["fps"] > 0:
        c.fps = int(verify["fps"])
    c.last_activity = f"Source updated: {verify['status'].upper()}"

    db.commit()
    db.refresh(c)

    return {
        **map_camera_to_response(c).model_dump(),
        "source_verification": {
            "status": verify["status"],
            "error": verify.get("error"),
            "resolution": verify.get("resolution"),
            "sanitized_url": verify["sanitized_url"]
        }
    }

@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_camera(camera_id: str, db: Session = Depends(get_db)):
    c = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
    db.delete(c)
    db.commit()
    return None

@router.patch("/{camera_id}/inference-auto-start", response_model=CameraResponse)
def update_camera_inference_auto_start(
    camera_id: str,
    auto_start: bool,
    db: Session = Depends(get_db)
):
    c = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
    c.auto_start_inference = auto_start
    db.commit()
    db.refresh(c)
    return map_camera_to_response(c)



