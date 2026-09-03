from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database.db import get_db
from database.models import IncidentModel, DetectionModel
from ai.smart_alert import smart_alert_service
from ai.tracker import track_registry
from sqlalchemy import func

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/summary")
def get_analytics_summary(db: Session = Depends(get_db)):
    total = db.query(IncidentModel).count()
    critical = db.query(IncidentModel).filter(IncidentModel.threat_level == "critical").count()
    high = db.query(IncidentModel).filter(IncidentModel.threat_level == "high").count()
    medium = db.query(IncidentModel).filter(IncidentModel.threat_level == "medium").count()
    low = db.query(IncidentModel).filter(IncidentModel.threat_level == "low").count()
    
    false_alarms = db.query(IncidentModel).filter(IncidentModel.status == "false_alarm").count()
    resolved = db.query(IncidentModel).filter(IncidentModel.status == "verified").count()
    
    avg_threat = db.query(func.avg(IncidentModel.threat_score)).scalar() or 66.0
    
    top_sector_query = db.query(IncidentModel.sector, func.count(IncidentModel.id)).group_by(IncidentModel.sector).order_by(func.count(IncidentModel.id).desc()).first()
    top_sector = top_sector_query[0] if top_sector_query else "Sector B"
    
    false_alarm_rate = smart_alert_service.calculate_false_alarm_reduction_rate(db)
    total_dets = db.query(DetectionModel).count()

    # Vehicle stats — real-time from in-memory TrackRegistry
    vehicle_stats = track_registry.get_vehicle_stats_all_cameras()

    return {
        "totalIncidents": total,
        "criticalCount": critical,
        "highCount": high,
        "mediumCount": medium,
        "lowCount": low,
        "falseAlarms": false_alarms,
        "resolvedToday": resolved,
        "avgThreatScore": int(avg_threat),
        "topSector": top_sector,
        "falseAlarmReductionRate": false_alarm_rate,
        "totalCandidateDetections": total_dets,
        "filteredNoiseCount": max(0, total_dets - total),
        "vehicleStats": vehicle_stats,
    }
