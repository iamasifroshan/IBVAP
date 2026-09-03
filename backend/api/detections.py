import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from sqlalchemy.orm import Session
from typing import List, Optional
import numpy as np
import cv2
import time
import uuid
from datetime import datetime

logger = logging.getLogger("api.detections")

from database.db import get_db
from database.models import DetectionModel, CameraModel, VideoModel, TrackModel, ZoneModel, IncidentModel
from database.schemas import DetectionResponse, TrackResponse
from ai.detector import detector_instance
from ai.tracker import track_registry
from ai.fence import fence_engine

router = APIRouter(tags=["AI Detections & Tracking"])


# ─────────────────────────────────────────────────────────────────────────────
# POST /cameras/{camera_id}/detect   — run YOLO + ByteTrack inference
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cameras/{camera_id}/detect")
def run_yolo_detection_with_tracking(
    camera_id: str,
    conf_threshold: float = Query(0.35, ge=0.0, le=1.0),
    frame_stride: int = Query(2, ge=1, le=60),
    max_frames: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db)
):
    """
    Run real YOLOv8 + ByteTrack multi-object tracking on a camera's active MP4 video feed.
    Accepts either human-readable camera_id OR the SQLite UUID id.
    """
    logger.info(f"[IVAP] Analysis request received — camera_id='{camera_id}' conf={conf_threshold} stride={frame_stride} max_frames={max_frames}")
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not cam:
        logger.warning(f"[IVAP] Camera not found: '{camera_id}'")
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    logger.info(f"[IVAP] Camera resolved — camera_id='{cam.camera_id}' source_type='{cam.source_type}' source_url='{cam.source_url}'")
    from video.stream_manager import stream_manager, SOURCE_WEBCAM, SOURCE_RTSP

    # Classify source type
    source_type = cam.source_type or stream_manager.classify_source(cam.source_url or "")
    if source_type == "MP4_FILE":
        source_type = "SIMULATED_FILE"

    # ── Handle WEBCAM / RTSP live sources ─────────────────────────────────────
    if source_type.upper() in (SOURCE_WEBCAM, SOURCE_RTSP, "WEBCAM", "RTSP"):
        frames_with_idx, video_id, err = stream_manager.extract_live_frames(
            source_url=cam.source_url,
            source_type=source_type,
            max_frames=max_frames,
            frame_stride=frame_stride
        )
        if err or not frames_with_idx:
            # Mark camera offline and raise
            cam.status = "OFFLINE"
            cam.last_activity = f"Stream unavailable: {err or 'No frames captured'}"
            db.commit()
            raise HTTPException(
                status_code=400,
                detail=f"Cannot capture frames from {source_type} source '{cam.source_url}': {err or 'No frames returned'}"
            )

        # Run YOLO on captured live frames
        try:
            results = detector_instance.process_frames_with_tracking(
                frames_with_indices=frames_with_idx,
                camera_id=cam.camera_id,
                conf_threshold=conf_threshold,
                db=db,
            )
        except Exception as err2:
            raise HTTPException(status_code=500, detail=f"YOLO+ByteTrack failure on live frames: {str(err2)}")

        video_path = None  # Live source — no file path for evidence clips

        # Update camera to online
        cam.status = "ONLINE"
        cam.last_activity = f"Live {source_type} inference: {len(frames_with_idx)} frames"
        db.commit()

    # ── Handle MP4 / file sources ─────────────────────────────────────────────
    else:
        STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "videos")

        video_path = stream_manager.resolve_video_path(cam.source_url) if cam.source_url else None

        # Layer 2: Strip UUID prefix and match by original filename in storage dir
        if not video_path and cam.source_url:
            base_name = os.path.basename(cam.source_url)
            # If the filename starts with a UUID prefix (e.g., uuid_originalname.mp4),
            # try to find any file in storage that ENDS with the non-UUID part
            import re
            uuid_prefix_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(.+)$')
            match = uuid_prefix_pattern.match(base_name)
            original_name = match.group(1) if match else base_name
            # Search storage dir for any file that contains the original_name
            if os.path.isdir(STORAGE_DIR):
                for fname in os.listdir(STORAGE_DIR):
                    if fname == original_name or fname.endswith('_' + original_name) or original_name in fname:
                        candidate = os.path.join(STORAGE_DIR, fname)
                        if os.path.isfile(candidate):
                            video_path = candidate
                            break

        # Layer 3: VideoModel record linked to this camera
        if not video_path:
            video = db.query(VideoModel).filter(
                VideoModel.camera_id == cam.camera_id
            ).order_by(VideoModel.created_at.desc()).first()
            if video and os.path.exists(video.file_path):
                video_path = video.file_path

        # Layer 4: Any most-recent video in the DB
        if not video_path:
            latest = db.query(VideoModel).order_by(VideoModel.created_at.desc()).first()
            if latest and os.path.exists(latest.file_path):
                video_path = latest.file_path

        if not video_path:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Camera '{cam.camera_id}' has no resolvable video source. "
                    f"Registered source_url='{cam.source_url}' was not found on disk. "
                    "Please upload a video and link it to this camera via POST /api/videos/upload."
                )
            )

        logger.info(f"[IVAP] Resolved video path='{video_path}' exists={os.path.exists(video_path)}")

        # ── Run YOLO + ByteTrack ──
        try:
            logger.info(f"[IVAP] Starting YOLO+ByteTrack inference on '{os.path.basename(video_path)}'")
            results = detector_instance.process_video_with_tracking(
                file_path=video_path,
                camera_id=cam.camera_id,
                conf_threshold=conf_threshold,
                frame_stride=frame_stride,
                max_frames=max_frames,
                db=db,
            )
            human_count = sum(1 for d in results["detections"] if d.get("object_type") == "human")
            logger.info(f"[IVAP] Inference complete — frames={results['frames_analyzed']} total_detections={results['detections_count']} humans={human_count} elapsed={results['elapsed_sec']}s")
        except Exception as err:
            logger.error(f"[IVAP] YOLO+ByteTrack failure: {err}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"YOLO+ByteTrack failure: {str(err)}")

    # ── Persist detections to SQLite ──
    now = datetime.utcnow()
    det_records = []
    for det in results["detections"]:
        det_records.append(DetectionModel(
            camera_id=cam.camera_id,
            object_type=det["object_type"],
            fine_class=det["fine_class"],
            confidence=det["confidence"],
            track_id=str(det["track_id"]) if det["track_id"] is not None else None,
            frame_index=det["frame_index"],
            timestamp_sec=det["timestamp_sec"],
            bounding_box=det["bounding_box"],
            timestamp=now,
        ))
    if det_records:
        db.add_all(det_records)

    # ── Persist tracks to SQLite (replace existing tracks for this camera) ──
    db.query(TrackModel).filter(TrackModel.camera_id == cam.camera_id).delete()
    track_records = []
    for t in results["tracks"]:
        track_records.append(TrackModel(
            camera_id=cam.camera_id,
            track_id=t["track_id"],
            fine_class=t["fine_class"],
            object_type=t["object_type"],
            state=t["state"],
            confidence_max=t["confidence_max"],
            confidence_last=t["confidence_last"],
            bounding_box=t["bounding_box"],
            frame_first=t["frame_first"],
            frame_last=t["frame_last"],
            frames_seen=t["frames_seen"],
            video_ts_first_sec=t.get("video_ts_first_sec", 0.0),
            video_ts_last_sec=t.get("video_ts_last_sec", 0.0),
            created_at=now,
        ))
    if track_records:
        db.add_all(track_records)

    # ── Real Virtual Fence Polygon Zone Intrusion Evaluation ──
    zones = db.query(ZoneModel).filter(
        (ZoneModel.camera_id == cam.camera_id) | (ZoneModel.camera_id == None)
    ).all()
    if not zones:
        zones = db.query(ZoneModel).all()

    fence_engine.clear_camera(cam.camera_id)

    frames_dict = {}
    for det in results["detections"]:
        f_idx = det["frame_index"]
        if f_idx not in frames_dict:
            frames_dict[f_idx] = []
        frames_dict[f_idx].append(det)

    all_created_incidents = []
    for f_idx in sorted(frames_dict.keys()):
        frame_dets = frames_dict[f_idx]
        ts_sec = frame_dets[0]["timestamp_sec"] if frame_dets else 0.0
        incidents_created = fence_engine.evaluate_frame_detections(
            camera_id=cam.camera_id,
            frame_index=f_idx,
            timestamp_sec=ts_sec,
            detections=frame_dets,
            zones=zones,
            db=db,
            video_path=video_path
        )
        all_created_incidents.extend(incidents_created)

    db.commit()

    incidents_serialized = [
        {
            "id": inc.id,
            "incident_id": inc.incident_id,
            "camera_id": inc.camera_id,
            "object_type": inc.object_type,
            "track_id": inc.track_id,
            "event_type": inc.event_type,
            "threat_score": inc.threat_score,
            "threat_level": inc.threat_level,
            "zone_name": inc.zone_name,
            "explainable_reason": inc.explainable_reason,
            "timestamp": inc.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        }
        for inc in all_created_incidents
    ]

    from api.ws import broadcast_event_sync
    for inc_data in incidents_serialized:
        broadcast_event_sync("incident_event", inc_data)

    return {
        "success": True,
        "camera_id": cam.camera_id,
        "camera_name": cam.name,
        "video_path": video_path,
        "conf_threshold_used": conf_threshold,
        "frame_stride_used": frame_stride,
        "frames_analyzed": results["frames_analyzed"],
        "elapsed_sec": results["elapsed_sec"],
        "total_detections": results["detections_count"],
        "saved_detections_to_db": len(det_records),
        "saved_tracks_to_db": len(track_records),
        "incidents_created_count": len(all_created_incidents),
        "incidents_created": incidents_serialized,
        "track_counts": results["track_counts"],
        "detections": results["detections"],
        "tracks": results["tracks"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /cameras/{camera_id}/tracks   — all tracks (new + active + lost)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cameras/{camera_id}/tracks")
def get_camera_tracks(
    camera_id: str,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Get all ByteTrack track records for a camera (all lifecycle states).
    Source: SQLite tracks table (persisted after last detect run).
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    tracks = (
        db.query(TrackModel)
        .filter(TrackModel.camera_id == target_id)
        .order_by(TrackModel.track_id)
        .limit(limit)
        .all()
    )
    return [_track_to_dict(t) for t in tracks]


# ─────────────────────────────────────────────────────────────────────────────
# GET /cameras/{camera_id}/tracks/active   — only new + active tracks
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cameras/{camera_id}/tracks/active")
def get_camera_active_tracks(
    camera_id: str,
    db: Session = Depends(get_db),
):
    """
    Get only 'new' and 'active' tracks for a camera.
    These are the currently visible tracked objects.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    tracks = (
        db.query(TrackModel)
        .filter(
            TrackModel.camera_id == target_id,
            TrackModel.state.in_(["new", "active"])
        )
        .order_by(TrackModel.track_id)
        .all()
    )
    return [_track_to_dict(t) for t in tracks]


# ─────────────────────────────────────────────────────────────────────────────
# GET /tracks   — all tracks across all cameras
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tracks")
def get_all_tracks(
    limit: int = Query(200, ge=1, le=1000),
    state: Optional[str] = Query(None, description="Filter by state: new, active, lost"),
    db: Session = Depends(get_db),
):
    """
    Get all ByteTrack track records across all cameras.
    Optionally filter by lifecycle state.
    """
    q = db.query(TrackModel)
    if state:
        q = q.filter(TrackModel.state == state)
    tracks = q.order_by(TrackModel.camera_id, TrackModel.track_id).limit(limit).all()
    return [_track_to_dict(t) for t in tracks]


# ─────────────────────────────────────────────────────────────────────────────
# GET /cameras/{camera_id}/detections   — stored per-frame detections
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cameras/{camera_id}/detections")
def get_camera_detections(
    camera_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """
    Get stored real YOLO detections from SQLite for a specific camera.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    target_id = cam.camera_id if cam else camera_id

    dets = (
        db.query(DetectionModel)
        .filter(DetectionModel.camera_id == target_id)
        .order_by(DetectionModel.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [_detection_to_dict(d) for d in dets]


# ─────────────────────────────────────────────────────────────────────────────
# GET /detections   — all stored detections
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/detections")
def get_all_detections(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """
    Get all stored real detections across all cameras from SQLite DB.
    """
    dets = (
        db.query(DetectionModel)
        .order_by(DetectionModel.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [_detection_to_dict(d) for d in dets]
_webcam_frame_counters = {}


# ─────────────────────────────────────────────────────────────────────────────
# POST /cameras/{camera_id}/detect-frame
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/cameras/{camera_id}/detect-frame")
async def detect_single_frame(
    camera_id: str,
    file: UploadFile = File(...),
    conf_threshold: float = Query(0.35, ge=0.0, le=1.0),
    db: Session = Depends(get_db)
):
    """
    Perform YOLO + ByteTrack inference on a single uploaded frame from live webcam feed.
    Returns person detections (routed to face/incident pipeline) and vehicle detections
    (routed to vehicle tracking only — vehicles NEVER create incidents).
    Evaluates person detections against camera active zones.
    """
    # Moved lazy imports to module level
    
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
        
    try:
        file_bytes = await file.read()
        nparr = np.frombuffer(file_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image file format")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {str(e)}")

    h, w = frame.shape[:2]
    
    try:
        raw_detections = detector_instance.track_frame(frame, conf_threshold=conf_threshold)
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Inference failure: {str(err)}")

    from config import settings
    from ai.tracker import track_registry
    
    counter = _webcam_frame_counters.get(camera_id, 0)
    _webcam_frame_counters[camera_id] = counter + 1
    current_ts = datetime.utcnow().timestamp()

    # Check if there are any persons detected before running heavy Face Recognition
    has_person = any(d.get("fine_class") == "person" or d.get("object_type") == "human" for d in raw_detections)
    
    face_results = []
    if has_person:
        if counter % settings.FACE_RECOGNITION_INTERVAL == 0:
            try:
                from services.face_recognition import face_recognition_service
                face_results = face_recognition_service.recognize_faces(frame, db)
            except Exception as fe:
                logger.error(f"Face recognition failed in detect_single_frame: {fe}")

    # Filter to human/person class
    person_dets = []
    active_ids_this_frame = []
    used_face_indices = set()

    for d in raw_detections:
        if d.get("fine_class") == "person" or d.get("object_type") == "human":
            nb = d["bounding_box"]
            tid = d.get("track_id")
            if tid is not None:
                active_ids_this_frame.append(tid)
            
            # Map face recognition to this person (1-to-1 matching)
            det_face = None
            px = nb["x"] * w
            py = nb["y"] * h
            pw = nb["width"] * w
            ph = nb["height"] * h
            
            best_face_idx = None
            best_face = None
            for f_idx, face in enumerate(face_results):
                if f_idx in used_face_indices:
                    continue
                xf, yf, wf, hf = face["bounding_box"]
                fcx = xf + wf / 2
                fcy = yf + hf / 2
                if (px <= fcx <= px + pw) and (py <= fcy <= py + ph):
                    best_face = face
                    best_face_idx = f_idx
                    break
            
            if best_face is not None and best_face_idx is not None:
                used_face_indices.add(best_face_idx)
                det_face = {
                    "recognized": best_face.get("recognized", False),
                    "person_id": best_face.get("person_id"),
                    "name": best_face.get("name"),
                    "identity_code": best_face.get("identity_code"),
                    "confidence": best_face.get("confidence", 0.0),
                    "recognition_confidence": best_face.get("recognition_confidence", best_face.get("confidence", 0.0)),
                    "face_detection_confidence": best_face.get("face_detection_confidence", 0.0),
                    "confidence_level": best_face.get("confidence_level", "UNKNOWN"),
                    "identity_status": best_face.get("identity_status", "KNOWN" if best_face.get("recognized") else "UNKNOWN"),
                    "bounding_box": best_face.get("bounding_box")
                }
            
            if tid is not None:
                track_registry.update_track(
                    camera_id=camera_id,
                    track_id=tid,
                    fine_class=d.get("fine_class", "person"),
                    object_type=d.get("object_type", "human"),
                    confidence=d["confidence"],
                    bounding_box=nb,
                    frame_index=counter,
                    video_ts=current_ts
                )
                t_rec = track_registry._get_camera_store(camera_id).get(tid)
                if t_rec:
                    t_rec.update_face_identity(det_face, settings.FACE_RECOGNITION_GRACE_PERIOD_FRAMES)
                    nb = t_rec.bounding_box
                    det_face = t_rec.face_info

            identity_status = det_face.get("identity_status", "FACE_UNAVAILABLE") if det_face else "FACE_UNAVAILABLE"
            face_detected = (identity_status != "FACE_UNAVAILABLE")

            person_dets.append({
                "class": "person",
                "confidence": d["confidence"],
                "track_id": tid,
                "bounding_box": nb,
                "bbox": {
                    "x": int(nb["x"] * w),
                    "y": int(nb["y"] * h),
                    "width": int(nb["width"] * w),
                    "height": int(nb["height"] * h)
                },
                "face_detected": face_detected,
                "recognized": det_face.get("recognized", False) if det_face else False,
                "person_name": det_face.get("name") if det_face else None,
                "recognition_confidence": det_face.get("recognition_confidence", 0.0) if det_face else 0.0,
                "face_detection_confidence": det_face.get("face_detection_confidence", 0.0) if det_face else 0.0,
                "identity_status": identity_status,
                "face": det_face
            })
            
    track_registry.mark_lost(camera_id, active_ids_this_frame)
    # Run zone logic
    zones = db.query(ZoneModel).filter(
        (ZoneModel.camera_id == cam.camera_id) | (ZoneModel.camera_id == cam.id) | (ZoneModel.camera_id == None)
    ).all()
    if not zones:
        zones = db.query(ZoneModel).all()
        
    # Ensure there is a full-frame zone to evaluate "Unknown Person" anywhere in the frame
    full_frame_zone = ZoneModel(
        id=str(uuid.uuid4()),
        camera_id=cam.camera_id,
        name="Webcam Global Zone",
        sector=cam.sector,
        zone_type="restricted_fence",
        polygon_coordinates=[
            {"x": 0.0, "y": 0.0},
            {"x": 100.0, "y": 0.0},
            {"x": 100.0, "y": 100.0},
            {"x": 0.0, "y": 100.0}
        ],
        severity="critical",
        enabled=True,
        human_detection=True
    )
    zones.append(full_frame_zone)
    
    fence_dets = []
    for d in person_dets:
        fence_dets.append({
            "track_id": d["track_id"] or 999,
            "fine_class": "person",
            "object_type": "human",
            "confidence": d["confidence"],
            "bounding_box": d["bounding_box"],
            "face": d.get("face")
        })
        
    created_incidents = []
    if fence_dets and zones:
        created_incidents = fence_engine.evaluate_frame_detections(
            camera_id=cam.camera_id,
            frame_index=int(datetime.utcnow().timestamp()),
            timestamp_sec=datetime.utcnow().timestamp(),
            detections=fence_dets,
            zones=zones,
            db=db
        )
        
    # ── Vehicle Detection Pipeline ─────────────────────────────────────────────
    # Route vehicle classes through a completely separate pipeline.
    # Vehicles NEVER enter: face recognition, SmartAlert, fence_engine, or incident creation.
    from config import settings as _s
    vehicle_dets_out = []
    active_vehicle_ids_this_frame = []

    for d in raw_detections:
        fine = d.get("fine_class", "")
        if fine not in _s.VEHICLE_CLASSES:
            continue

        conf_v = d.get("confidence", 0.0)
        if conf_v < _s.VEHICLE_CONFIDENCE_THRESHOLD:
            continue

        nb = d["bounding_box"]
        area = nb.get("width", 0) * nb.get("height", 0)
        aspect = nb.get("width", 1) / max(nb.get("height", 1), 1e-6)

        # Reject obviously invalid detections (noise, background blobs)
        if area < _s.VEHICLE_MIN_BBOX_AREA:
            continue
        if aspect < _s.VEHICLE_MIN_ASPECT_RATIO:
            continue

        tid_v = d.get("track_id")

        if tid_v is not None:
            active_vehicle_ids_this_frame.append(tid_v)
            track_registry.update_vehicle_track(
                camera_id=camera_id,
                track_id=tid_v,
                fine_class=fine,
                confidence=conf_v,
                bounding_box=nb,
                frame_index=counter,
                video_ts=current_ts,
                smoothing_window=_s.VEHICLE_CLASS_SMOOTHING_WINDOW,
            )
            vstore = track_registry._get_vehicle_camera_store(camera_id)
            v_rec = vstore.get(tid_v)
            if v_rec and v_rec.frames_seen >= _s.VEHICLE_MIN_FRAMES:
                stable_nb = v_rec.bounding_box
                
                # ── ANPR Plate Recognition ──────────────────────────────────
                if _s.ANPR_ENABLED:
                    try:
                        from ai.anpr_engine import anpr_engine
                        vx1 = max(0, int(stable_nb["x"] * w))
                        vy1 = max(0, int(stable_nb["y"] * h))
                        vw_p = int(stable_nb["width"] * w)
                        vh_p = int(stable_nb["height"] * h)
                        vx2 = min(w, vx1 + vw_p)
                        vy2 = min(h, vy1 + vh_p)

                        v_crop = frame[vy1:vy2, vx1:vx2]
                        if v_crop.size > 0:
                            p_res = anpr_engine.detect_plate_region(v_crop)
                            if p_res:
                                p_crop, (px_rel, py_rel, pw_rel, ph_rel), p_score = p_res
                                raw_ocr, norm_plate, ocr_conf = anpr_engine.run_ocr(p_crop)
                                if norm_plate and ocr_conf >= _s.OCR_CONFIDENCE_THRESHOLD:
                                    is_valid_fmt = anpr_engine.validate_indian_plate_format(norm_plate)
                                    v_rec.update_vehicle_plate(raw_ocr, norm_plate, ocr_conf, is_valid_fmt)
                    except Exception as anpr_err:
                        logger.error(f"[ANPR] Plate processing failed for VTRK#{tid_v}: {anpr_err}")

                # Save / Update ANPR Observation in Database if plate is stable
                if v_rec.plate_text and v_rec.plate_stable:
                    try:
                        from database.models import ANPRObservationModel
                        existing_obs = db.query(ANPRObservationModel).filter(
                            ANPRObservationModel.camera_id == camera_id,
                            ANPRObservationModel.vehicle_track_id == tid_v,
                            ANPRObservationModel.plate_text == v_rec.plate_text
                        ).first()

                        now_dt = datetime.utcnow()
                        if existing_obs:
                            existing_obs.last_seen = now_dt
                            existing_obs.direction = v_rec.compute_direction()
                            existing_obs.confidence = v_rec.plate_confidence
                            existing_obs.format_valid = v_rec.format_valid
                            db.commit()
                        else:
                            new_anpr_id = f"ANPR-{uuid.uuid4().hex[:8].upper()}"
                            obs = ANPRObservationModel(
                                id=str(uuid.uuid4()),
                                anpr_id=new_anpr_id,
                                camera_id=camera_id,
                                vehicle_track_id=tid_v,
                                vehicle_track_label=f"VTRK#{tid_v}",
                                vehicle_class=v_rec.vehicle_class or fine,
                                plate_text=v_rec.plate_text,
                                raw_ocr_text=v_rec.raw_ocr_text,
                                confidence=v_rec.plate_confidence,
                                format_valid=v_rec.format_valid,
                                direction=v_rec.compute_direction(),
                                first_seen=now_dt,
                                last_seen=now_dt,
                                created_at=now_dt
                            )
                            db.add(obs)
                            db.commit()

                            # Broadcast WebSocket ANPR Event
                            try:
                                from api.ws import broadcast_event_sync
                                broadcast_event_sync("ANPR_PLATE_RECOGNIZED", {
                                    "camera_id": camera_id,
                                    "vehicle_track_id": tid_v,
                                    "vehicle_track_label": f"VTRK#{tid_v}",
                                    "vehicle_class": v_rec.vehicle_class or fine,
                                    "plate_text": v_rec.plate_text,
                                    "confidence": v_rec.plate_confidence,
                                    "format_valid": v_rec.format_valid
                                })
                            except Exception:
                                pass
                    except Exception as db_anpr_err:
                        logger.error(f"[ANPR] Database observation save failed: {db_anpr_err}")

                vehicle_dets_out.append({
                    "class": v_rec.vehicle_class or fine,
                    "vehicle_class": v_rec.vehicle_class or fine,
                    "object_type": "vehicle",
                    "confidence": conf_v,
                    "track_id": tid_v,
                    "track_label": f"VTRK#{tid_v}",
                    "bounding_box": stable_nb,
                    "bbox": {
                        "x": int(stable_nb["x"] * w),
                        "y": int(stable_nb["y"] * h),
                        "width": int(stable_nb["width"] * w),
                        "height": int(stable_nb["height"] * h),
                    },
                    "direction": v_rec.compute_direction(),
                    "frames_seen": v_rec.frames_seen,
                    "plate_text": v_rec.plate_text,
                    "raw_ocr_text": v_rec.raw_ocr_text,
                    "plate_confidence": v_rec.plate_confidence,
                    "format_valid": v_rec.format_valid,
                    "plate_stable": v_rec.plate_stable,
                })

    track_registry.mark_vehicle_lost(camera_id, active_vehicle_ids_this_frame)

    # Broadcast WebSocket event ONLY when vehicle count changes (not every frame)
    _prev_v_count = getattr(detect_single_frame, "_prev_vehicle_counts", {})
    prev_count = _prev_v_count.get(camera_id, -1)
    if len(vehicle_dets_out) != prev_count:
        _prev_v_count[camera_id] = len(vehicle_dets_out)
        detect_single_frame._prev_vehicle_counts = _prev_v_count
        if vehicle_dets_out:
            try:
                from api.ws import broadcast_event_sync
                broadcast_event_sync("VEHICLE_DETECTED", {
                    "camera_id": camera_id,
                    "vehicle_count": len(vehicle_dets_out),
                    "vehicles": [{"track_label": v["track_label"], "vehicle_class": v["vehicle_class"], "confidence": round(v["confidence"], 3)} for v in vehicle_dets_out],
                })
            except Exception:
                pass

    return {
        "timestamp": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "person_count": len(person_dets),
        "detections": person_dets,
        "vehicle_count": len(vehicle_dets_out),
        "vehicle_detections": vehicle_dets_out,
        "incidents_created_count": len(created_incidents),
        "incident_ids": [i.incident_id for i in created_incidents],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /cameras/{camera_id}/vehicles   — active vehicle tracks for a camera
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cameras/{camera_id}/vehicles")
def get_camera_vehicles(camera_id: str, db: Session = Depends(get_db)):
    """
    Return all active vehicle tracks for the specified camera.
    Data comes from the in-memory TrackRegistry vehicle store — real-time state.
    No hardcoded statistics.
    """
    cam = db.query(CameraModel).filter(
        (CameraModel.camera_id == camera_id) | (CameraModel.id == camera_id)
    ).first()
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    resolved_id = cam.camera_id
    return {
        "camera_id": resolved_id,
        "vehicles": track_registry.get_active_vehicle_tracks(resolved_id),
        "vehicle_count": len(track_registry.get_active_vehicle_tracks(resolved_id)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /vehicles/stats   — aggregate vehicle counts across all cameras
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/vehicles/stats")
def get_vehicle_stats():
    """
    Return aggregate vehicle statistics across all cameras.
    Source: in-memory TrackRegistry vehicle store (real-time).
    Returns zero counts when no vehicles are detected — never fabricates numbers.
    """
    return track_registry.get_vehicle_stats_all_cameras()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _track_to_dict(t: TrackModel) -> dict:
    return {
        "id": t.id,
        "camera_id": t.camera_id,
        "track_id": t.track_id,
        "fine_class": t.fine_class,
        "object_type": t.object_type,
        "state": t.state,
        "confidence_max": t.confidence_max,
        "confidence_last": t.confidence_last,
        "bounding_box": t.bounding_box,
        "frame_first": t.frame_first,
        "frame_last": t.frame_last,
        "frames_seen": t.frames_seen,
        "video_ts_first_sec": t.video_ts_first_sec,
        "video_ts_last_sec": t.video_ts_last_sec,
        "face": t.face,
        "created_at": t.created_at.strftime("%Y-%m-%d %H:%M:%S") if t.created_at else None,
    }


def _detection_to_dict(d: DetectionModel) -> dict:
    return {
        "id": d.id,
        "camera_id": d.camera_id,
        "object_type": d.object_type,
        "fine_class": d.fine_class,
        "confidence": d.confidence,
        "track_id": d.track_id,
        "frame_index": d.frame_index,
        "timestamp_sec": d.timestamp_sec,
        "bounding_box": d.bounding_box,
        "face": d.face,
        "timestamp": d.timestamp.strftime("%Y-%m-%d %H:%M:%S") if d.timestamp else None,
    }
