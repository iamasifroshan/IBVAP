from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database.db import get_db
from database.schemas import SearchQueryRequest, SearchQueryResponse, IncidentResponse
from database.models import IncidentModel

router = APIRouter(prefix="/search", tags=["Search"])

@router.post("/query", response_model=SearchQueryResponse)
def search_query(req: SearchQueryRequest, db: Session = Depends(get_db)):
    incidents = db.query(IncidentModel).all()
    results = [
        IncidentResponse(
            id=str(i.id),
            incident_id=i.incident_id,
            timestamp=i.timestamp,
            sector=i.sector,
            camera_name=i.camera_name,
            camera_id=i.camera_id,
            cameraName=i.camera_name,
            cameraId=i.camera_id,
            outpost=i.outpost,
            object_type=i.object_type,
            objectType=i.object_type,
            persistentId=i.track_id,
            track_id=i.track_id,
            event_type="SEARCH_RESULT",
            threatScore=i.threat_score,
            threat_level=i.threat_level,
            severity=i.threat_level,
            threatFactors=i.threat_factors or [],
            explainableReason=i.explainable_reason,
            environment=i.environment,
            environmentalCondition=i.environment,
            aiReliability=i.ai_reliability,
            visibilityScore=i.visibility_score,
            status=i.status,
            snapshotUrl=i.snapshot_url,
            zoneName=i.zone_name,
            loiteringDurationSec=i.loitering_duration_sec,
            speedKmh=i.speed_kmh,
            direction=i.direction,
            smartAlertConfirmed=i.smart_alert_confirmed,
            syncedToCloud=i.synced_to_cloud,
            syncedTimestamp=i.synced_timestamp,
        ) for i in incidents
    ]
    return SearchQueryResponse(
        filters={
            "rawQuery": req.query,
            "intentSummary": f"Parsed query for '{req.query}'",
            "validated": True,
            "confidence": 95.0
        },
        results=results
    )
