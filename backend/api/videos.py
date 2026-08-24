import os
import uuid
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Form
from sqlalchemy.orm import Session
from typing import List, Optional

from database.db import get_db
from database.models import VideoModel, CameraModel
from video.processor import VideoProcessor

router = APIRouter(tags=["Videos & Streams"])

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "videos")
os.makedirs(STORAGE_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mov"}

@router.post("/videos/upload", status_code=status.HTTP_201_CREATED)
async def upload_video(
    file: UploadFile = File(...),
    camera_id: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """
    Upload an MP4 video file, store it locally, and extract metadata using OpenCV.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided in upload")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Generate safe unique filename
    video_uuid = str(uuid.uuid4())
    safe_filename = f"{video_uuid}_{file.filename}"
    saved_path = os.path.join(STORAGE_DIR, safe_filename)

    try:
        with open(saved_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save video to storage: {str(e)}")

    file_size_bytes = os.path.getsize(saved_path)

    # Process & Inspect Video with OpenCV
    try:
        meta = VideoProcessor.inspect_and_process_video(saved_path)
    except ValueError as val_err:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=400, detail=f"Invalid video file: {str(val_err)}")
    except Exception as err:
        if os.path.exists(saved_path):
            os.remove(saved_path)
        raise HTTPException(status_code=500, detail=f"OpenCV processing failure: {str(err)}")

    # Save record to Database
    db_video = VideoModel(
        id=video_uuid,
        filename=file.filename,
        file_path=saved_path,
        file_size_bytes=file_size_bytes,
        camera_id=camera_id,
        fps=meta["fps"],
        width=meta["width"],
        height=meta["height"],
        total_frames=meta["total_frames"],
        duration_sec=meta["duration_sec"],
        status="processed"
    )
    db.add(db_video)
    db.commit()
    db.refresh(db_video)

    return {
        "video_id": db_video.id,
        "filename": db_video.filename,
        "file_path": db_video.file_path,
        "file_size_mb": round(file_size_bytes / (1024 * 1024), 2),
        "camera_id": db_video.camera_id,
        "fps": db_video.fps,
        "resolution": f"{db_video.width}x{db_video.height}",
        "width": db_video.width,
        "height": db_video.height,
        "total_frames": db_video.total_frames,
        "duration_sec": db_video.duration_sec,
        "status": db_video.status,
        "sampled_frames_read": meta.get("sampled_frames_read", 0)
    }

@router.post("/cameras/{camera_id}/process-video")
def process_camera_video(
    camera_id: str,
    video_id: Optional[str] = None,
    file_path: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Associate an uploaded video file with a camera and run OpenCV frame processing.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()

    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found in database")

    target_path = file_path
    video_rec = None

    if video_id:
        video_rec = db.query(VideoModel).filter(VideoModel.id == video_id).first()
        if not video_rec:
            raise HTTPException(status_code=404, detail=f"Video ID '{video_id}' not found")
        target_path = video_rec.file_path

    if not target_path or not os.path.exists(target_path):
        raise HTTPException(status_code=400, detail="Valid video file path or video_id required")

    # Run OpenCV Processing Service
    try:
        meta = VideoProcessor.inspect_and_process_video(target_path)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"OpenCV processing failed: {str(err)}")

    # Update Camera DB Record
    cam.source_type = "SIMULATED_FILE"
    cam.source_url = target_path
    cam.fps = int(meta["fps"])
    cam.resolution = f"{meta['width']}x{meta['height']}"
    cam.status = "online"
    cam.last_activity = "Live Video Stream Active"

    env_meta = meta.get("environment", {})
    if env_meta:
        cam.visibility_score = env_meta.get("visibility_score", cam.visibility_score)
        cam.lighting_lux = env_meta.get("lighting_lux", cam.lighting_lux)
        cam.ai_reliability = env_meta.get("ai_reliability", cam.ai_reliability)
        cam.adaptive_processing_mode = env_meta.get("adaptive_processing_mode", cam.adaptive_processing_mode)
        cam.human_verification_required = env_meta.get("human_verification_required", cam.human_verification_required)
        cam.verification_recommendation = env_meta.get("recommendation", cam.verification_recommendation)

    # Disassociate previous videos for this camera
    db.query(VideoModel).filter(VideoModel.camera_id == cam.camera_id).update({"camera_id": None})

    if video_rec:
        video_rec.camera_id = cam.camera_id
        video_rec.status = "processed"
    elif target_path:
        v_match = db.query(VideoModel).filter(VideoModel.file_path == target_path).first()
        if v_match:
            v_match.camera_id = cam.camera_id
            v_match.status = "processed"

    db.commit()

    return {
        "message": f"Video successfully associated with camera '{cam.camera_id}'",
        "camera_id": cam.camera_id,
        "camera_name": cam.name,
        "video_path": target_path,
        "fps": meta["fps"],
        "resolution": meta["resolution"],
        "total_frames": meta["total_frames"],
        "duration_sec": meta["duration_sec"],
        "sampled_frames_read": meta["sampled_frames_read"],
        "status": "active_processing"
    }

@router.get("/cameras/{camera_id}/stream-status")
def get_camera_stream_status(camera_id: str, db: Session = Depends(get_db)):
    """
    Get current live stream / video processing status for a camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()

    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    video = db.query(VideoModel).filter(VideoModel.camera_id == cam.camera_id).first()

    return {
        "camera_id": cam.camera_id,
        "camera_name": cam.name,
        "status": cam.status,
        "source_type": cam.source_type,
        "source_url": cam.source_url,
        "fps": cam.fps,
        "resolution": cam.resolution,
        "health_score": cam.health_score,
        "visibility_score": cam.visibility_score,
        "ai_reliability": cam.ai_reliability,
        "has_active_video": video is not None,
        "active_video_filename": video.filename if video else None,
        "total_frames": video.total_frames if video else 0,
        "duration_sec": video.duration_sec if video else 0.0,
        "last_activity": cam.last_activity
    }

@router.get("/videos")
def list_available_videos():
    """
    List all available MP4 files in the backend storage directory.
    """
    videos_list = []
    if os.path.exists(STORAGE_DIR):
        for f in os.listdir(STORAGE_DIR):
            if f.lower().endswith(".mp4"):
                full_path = os.path.join(STORAGE_DIR, f)
                size_mb = round(os.path.getsize(full_path) / (1024 * 1024), 2)
                videos_list.append({
                    "filename": f,
                    "url": f"/videos/{f}",
                    "size_mb": size_mb
                })
    return {"videos": videos_list}

