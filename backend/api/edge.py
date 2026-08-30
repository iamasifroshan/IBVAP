from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database.db import get_db
from database.models import CameraModel, IncidentModel, SyncJobModel
from database.schemas import SystemMetricsSchema, SystemStatusResponse
from ai.smart_alert import smart_alert_service

router = APIRouter(tags=["Edge & System"])

@router.get("/edge/status", response_model=SystemMetricsSchema)
def get_edge_status(db: Session = Depends(get_db)):
    total_cameras = db.query(CameraModel).count()
    active_cameras = db.query(CameraModel).filter(CameraModel.status.in_(["online", "ONLINE"])).count()
    degraded_cameras = db.query(CameraModel).filter(CameraModel.status.in_(["degraded", "DEGRADED"])).count()
    offline_cameras = db.query(CameraModel).filter(CameraModel.status.in_(["offline", "OFFLINE"])).count()
    
    active_alerts = db.query(IncidentModel).filter(IncidentModel.status == "active").count()
    critical_alerts = db.query(IncidentModel).filter(
        IncidentModel.status == "active",
        IncidentModel.threat_level == "critical"
    ).count()
    
    offline_queue = db.query(SyncJobModel).filter(
        SyncJobModel.status.in_(["unsynced", "queued", "syncing"])
    ).count()

    # Calculate actual false alarm rate
    reduction_rate = smart_alert_service.calculate_false_alarm_reduction_rate(db)
    
    return SystemMetricsSchema(
        totalCameras=total_cameras if total_cameras > 0 else 4,
        activeCameras=active_cameras,
        degradedCameras=degraded_cameras,
        offlineCameras=offline_cameras,
        activeAlerts=active_alerts,
        criticalAlerts=critical_alerts,
        offlineQueueCount=offline_queue,
        falseAlarmReductionRate=reduction_rate,
        storageUsedMb=1420,
        storageLimitMb=8192,
        edgeNodeId="BOP-NORTH-EDGE-01",
        edgeNodeLocation="Border Outpost North (Sector B)",
        processingFps=30,
        lastSyncTimestamp="2026-08-23 22:50:00 UTC"
    )

@router.get("/system/status", response_model=SystemStatusResponse)
def get_system_status():
    return SystemStatusResponse()

@router.get("/sync/status")
def get_sync_status(db: Session = Depends(get_db)):
    from ai.edge_sync import edge_sync
    jobs = db.query(SyncJobModel).order_by(SyncJobModel.created_at.desc()).all()
    return [
        {
            "id": f"SQ-{j.id[:6].upper()}",
            "incidentId": j.incident_id,
            "timestamp": j.created_at.strftime("%H:%M:%S") if j.created_at else "00:00:00",
            "eventType": "CRITICAL_BREACH_ALERT",
            "priority": "P1_CRITICAL",
            "payloadSizeKb": j.payload_size_kb,
            "status": j.status,
            "progressPct": 100 if j.status == "synced" else (50 if j.status == "syncing" else 0),
            "attempts": j.retry_count
        }
        for j in jobs
    ]

@router.post("/sync/trigger")
def trigger_sync(db: Session = Depends(get_db)):
    from ai.edge_sync import edge_sync
    return edge_sync.process_queue(db)

@router.get("/sync/connectivity")
def get_sync_connectivity():
    from ai.edge_sync import edge_sync
    return {"central_connected": edge_sync.is_connected()}

@router.post("/sync/toggle-connectivity")
def toggle_sync_connectivity(connected: Optional[bool] = None):
    from ai.edge_sync import edge_sync
    new_state = not edge_sync.is_connected() if connected is None else connected
    edge_sync.set_connectivity(new_state)
    return {
        "central_connected": new_state,
        "message": f"Central Server Connectivity set to {new_state}"
    }

@router.get("/environment/condition")
def get_environment_condition(db: Session = Depends(get_db)):
    cams = db.query(CameraModel).all()
    if not cams:
        return {"condition": "normal", "confidence": 98, "ai_reliability": 95, "human_verification_required": False}
    
    avg_rel = sum(c.ai_reliability for c in cams) / len(cams)
    hvr = any(c.human_verification_required for c in cams)
    
    if hvr:
        cond = "POSSIBLE_VISIBILITY_DEGRADATION"
    elif avg_rel < 60:
        cond = "fog"
    elif avg_rel < 85:
        cond = "low_light"
    else:
        cond = "normal"
        
    return {
        "condition": cond,
        "confidence": int(round(avg_rel)),
        "ai_reliability": int(round(avg_rel)),
        "human_verification_required": hvr
    }
