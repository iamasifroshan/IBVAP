import sys
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure backend directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import settings
from database.db import engine, Base, SessionLocal, run_migrations
from database.models import CameraModel, ZoneModel, TrackModel

from api.cameras import router as cameras_router
from api.incidents import router as incidents_router, evidence_router
from api.zones import router as zones_router
from api.streams import router as streams_router
from api.videos import router as videos_router
from api.detections import router as detections_router
from api.edge import router as edge_router
from api.search import router as search_router
from api.analytics import router as analytics_router
from api.training import router as training_router
from api.analytics import router as analytics_router
from api.search import router as search_router
from api.training import router as training_router
from api.ws import router as ws_router

# Initial DB Seeder: seed sample cameras
def seed_db():
    db = SessionLocal()
    from video.stream_manager import stream_manager
    try:
        if db.query(CameraModel).count() > 0:
            # Skip seeding, database is already populated
            pass
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(base_dir)
            
            video_1 = os.path.join(base_dir, "storage", "videos", "gettyimages-2215078536-640_adpp(1).mp4")
            video_2 = os.path.join(base_dir, "storage", "videos", "gettyimages-2213890215-640_adpp(1).mp4")
            video_3 = os.path.join(base_dir, "storage", "videos", "12522257-hd_1920_1080_24fps(1).mp4")
            video_4 = os.path.join(base_dir, "storage", "videos", "17502678-hd_1080_1920_30fps(1).mp4")

            # Create or update cameras
            cameras_data = [
            {
                "camera_id": "BORDER-CAM-07",
                "name": "BORDER-CAM-07",
                "sector": "Sector B",
                "outpost": "Border Outpost North",
                "source_type": "SIMULATED_FILE",
                "source_url": video_1,
                "fps": 30,
                "resolution": "1920x1080 (1080p)",
                "status": "online",
                "health_score": 98,
                "visibility_score": 82,
                "lighting_lux": 120,
                "ai_reliability": 91,
                "adaptive_processing_mode": "Standard AI Inference + Night Vision",
                "human_verification_required": False,
                "verification_recommendation": "Automated AI tracking sufficient under current visibility.",
                "active_zone": "Sector B Restricted Zone",
                "last_activity": "1 sec ago",
                "night_vision_mode": True,
                "dehaze_enabled": False,
            },
            {
                "camera_id": "SECTOR-B-CAM-03",
                "name": "SECTOR-B-CAM-03",
                "sector": "Sector B",
                "outpost": "Border Outpost North",
                "source_type": "SIMULATED_FILE",
                "source_url": video_2,
                "fps": 25,
                "resolution": "2560x1440 (2K)",
                "status": "online",
                "health_score": 95,
                "visibility_score": 38,
                "lighting_lux": 14,
                "ai_reliability": 42,
                "adaptive_processing_mode": "Dehaze AI + Multi-Frame Temporal Verification",
                "human_verification_required": True,
                "verification_recommendation": "MANDATORY HUMAN VERIFICATION FOR CRITICAL ALERTS (Fog > 60%)",
                "active_zone": "Sector B Buffer Strip",
                "last_activity": "Just now",
                "night_vision_mode": False,
                "dehaze_enabled": True,
            },
            {
                "camera_id": "BOP-NORTH-02",
                "name": "BOP-NORTH-02",
                "sector": "Sector A",
                "outpost": "Northern Checkpoint",
                "source_type": "SIMULATED_FILE",
                "source_url": video_3,
                "fps": 30,
                "resolution": "1920x1080 (1080p)",
                "status": "online",
                "health_score": 100,
                "visibility_score": 94,
                "lighting_lux": 450,
                "ai_reliability": 96,
                "adaptive_processing_mode": "Baseline High Precision YOLOv8",
                "human_verification_required": False,
                "verification_recommendation": "Clear daylight. AI confidence optimal.",
                "active_zone": "Northern Checkpoint Fence",
                "last_activity": "2 mins ago",
                "night_vision_mode": False,
                "dehaze_enabled": False,
            },
            {
                "camera_id": "SOUTH-TRENCH-10",
                "name": "SOUTH-TRENCH-10",
                "sector": "South Perimeter",
                "outpost": "Southern Barrier Post",
                "source_type": "SIMULATED_FILE",
                "source_url": video_4,
                "fps": 30,
                "resolution": "1920x1080 (1080p)",
                "status": "online",
                "health_score": 90,
                "visibility_score": 85,
                "lighting_lux": 100,
                "ai_reliability": 88,
                "adaptive_processing_mode": "Standard AI Inference",
                "human_verification_required": False,
                "verification_recommendation": "Optimal lighting. AI confidence optimal.",
                "active_zone": "South Gate Corridor",
                "last_activity": "Just now",
                "night_vision_mode": False,
                "dehaze_enabled": False,
            }
        ]

        

            for cam_d in cameras_data:
                verify = stream_manager.verify_camera_source(cam_d["source_url"], cam_d["source_type"])
                cam_d["status"] = verify["status"]
                cam_d["health_score"] = verify["health_score"]
                if verify.get("resolution") and verify["resolution"] not in ("N/A", "Unknown", "0x0"):
                    cam_d["resolution"] = verify["resolution"]
                if verify.get("fps") and verify["fps"] > 0:
                    cam_d["fps"] = int(verify["fps"])
                db.add(CameraModel(**cam_d))
            db.commit()

        # Verify and recover status for ALL cameras in the database on startup

        all_cameras = db.query(CameraModel).all()
        for cam in all_cameras:
            # Test source, resolve relative/HTTP/absolute path, verify health and connection
            verify = stream_manager.verify_camera_source(cam.source_url, cam.source_type)
            cam.status = verify["status"]
            cam.health_score = verify["health_score"]
            if verify.get("resolution") and verify["resolution"] not in ("N/A", "Unknown", "0x0"):
                cam.resolution = verify["resolution"]
            if verify.get("fps") and verify["fps"] > 0:
                cam.fps = int(verify["fps"])
            
            # Map status transitions and last activity
            status_upper = verify["status"].upper()
            if status_upper == "ONLINE":
                cam.last_activity = f"Source verified online — {verify['resolution']} @ {verify['fps']:.0f}fps"
            elif status_upper == "DEGRADED":
                cam.last_activity = "Source degraded — limited frame response"
            else:
                cam.last_activity = f"Offline: {verify.get('error', 'Stream unavailable')[:100]}"
        db.commit()

        if db.query(ZoneModel).count() == 0:
            sample_zones = [
                ZoneModel(
                    name="Sector B Zero-Tolerance Zone",
                    camera_id="BORDER-CAM-07",
                    sector="Sector B",
                    zone_type="restricted_fence",
                    severity="critical",
                    sensitivity=95,
                    min_threat_threshold=65,
                    loitering_limit_sec=15,
                    enabled=True,
                    polygon_coordinates=[
                        {"x": 10.0, "y": 20.0},
                        {"x": 90.0, "y": 20.0},
                        {"x": 90.0, "y": 80.0},
                        {"x": 10.0, "y": 80.0}
                    ]
                )
            ]
            db.add_all(sample_zones)
            db.commit()
    finally:
        db.close()

is_backend_ready = False

@asynccontextmanager
async def lifespan(app: FastAPI):
    global is_backend_ready
    print("[STARTUP] Backend starting")
    print(f"[STARTUP] Database path: {settings.DATABASE_URL}")
    
    try:
        # Test DB connectivity
        with engine.connect() as conn:
            pass
        print("[STARTUP] Database connected")
        
        # Initialize DB tables automatically on startup
        Base.metadata.create_all(bind=engine)
        run_migrations()
        seed_db()
        
        # Output counts
        db = SessionLocal()
        from database.models import IncidentModel, EvidenceModel
        cam_count = db.query(CameraModel).count()
        inc_count = db.query(IncidentModel).count()
        ev_count = db.query(EvidenceModel).count()
        db.close()
        
        print(f"[STARTUP] Cameras found: {cam_count}")
        print(f"[STARTUP] Incidents found: {inc_count}")
        print(f"[STARTUP] Evidence found: {ev_count}")
        print("[STARTUP] Storage verified")
        print("[STARTUP] API ready")
        
        is_backend_ready = True
    except Exception as e:
        print(f"[STARTUP] Backend initialization failed: {e}")
        
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="IBVAP — Integrated Border Video Analytics Platform API Server",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.staticfiles import StaticFiles

EVIDENCE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage", "evidence")
os.makedirs(EVIDENCE_DIR, exist_ok=True)
app.mount("/storage/evidence", StaticFiles(directory=EVIDENCE_DIR), name="evidence_storage")

VIDEOS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "storage", "videos")
os.makedirs(VIDEOS_DIR, exist_ok=True)
app.mount("/videos", StaticFiles(directory=VIDEOS_DIR), name="video_storage")

# Health check endpoint
@app.get("/health", tags=["Health"])
def health_check():
    db_status = "connected"
    try:
        with engine.connect() as conn:
            pass
    except Exception:
        db_status = "disconnected"
        
    status = "healthy" if is_backend_ready and db_status == "connected" else "initializing"
    if not is_backend_ready:
        status = "initializing"
        
    return {
        "status": status,
        "service": "IBVAP Backend",
        "database": db_status,
        "database_path": settings.DATABASE_URL,
        "storage": "verified" if is_backend_ready else "unknown",
        "ready": is_backend_ready
    }

# Mount Routers under both /api/v1 and /api for full compatibility
for prefix in ["/api/v1", "/api"]:
    app.include_router(cameras_router, prefix=prefix)
    app.include_router(incidents_router, prefix=prefix)
    app.include_router(evidence_router, prefix=prefix)
    app.include_router(zones_router, prefix=prefix)
    app.include_router(streams_router, prefix=prefix)
    app.include_router(videos_router, prefix=prefix)
    app.include_router(detections_router, prefix=prefix)
    app.include_router(edge_router, prefix=prefix)
    app.include_router(search_router, prefix=prefix)
    app.include_router(analytics_router, prefix=prefix)
    app.include_router(training_router, prefix=prefix)
    app.include_router(analytics_router, prefix=prefix)
    app.include_router(search_router, prefix=prefix)
    app.include_router(training_router, prefix=prefix)

# Mount WebSocket router
app.include_router(ws_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
