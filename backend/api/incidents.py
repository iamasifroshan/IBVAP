from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import os
import shutil
from datetime import datetime

from database.db import get_db
from database.models import IncidentModel, EvidenceModel
from database.schemas import IncidentResponse, IncidentCreate, IncidentStatusUpdate

router = APIRouter(prefix="/incidents", tags=["Incidents"])

def map_incident_to_response(i: IncidentModel) -> IncidentResponse:
    return IncidentResponse(
        id=i.id,
        incident_id=i.incident_id,
        camera_id=i.camera_id,
        camera_name=i.camera_name,
        sector=i.sector,
        outpost=i.outpost,
        object_type=i.object_type,
        track_id=i.track_id,
        event_type=i.event_type,
        threat_score=i.threat_score,
        threat_level=i.threat_level,
        threat_factors=i.threat_factors or [],
        explainable_reason=i.explainable_reason,
        environment=i.environment,
        ai_reliability=i.ai_reliability,
        visibility_score=i.visibility_score,
        status=i.status,
        sync_status=i.sync_status,
        snapshot_url=i.snapshot_url,
        zone_name=i.zone_name,
        loitering_duration_sec=i.loitering_duration_sec,
        speed_kmh=i.speed_kmh,
        direction=i.direction,
        smart_alert_confirmed=i.smart_alert_confirmed,
        validation_checks=i.validation_checks or {},
        synced_to_cloud=i.synced_to_cloud,
        synced_timestamp=i.synced_timestamp,
        timestamp=i.timestamp,
        # CamelCase Aliases for Frontend
        cameraName=i.camera_name,
        cameraId=i.camera_id,
        objectType=i.object_type,
        persistentId=i.track_id,
        threatScore=i.threat_score,
        threatFactors=i.threat_factors or [],
        explainableReason=i.explainable_reason,
        environmentalCondition=i.environment,
        aiReliability=i.ai_reliability,
        visibilityScore=i.visibility_score,
        snapshotUrl=i.snapshot_url,
        zoneName=i.zone_name,
        loiteringDurationSec=i.loitering_duration_sec,
        speedKmh=i.speed_kmh,
        smartAlertConfirmed=i.smart_alert_confirmed,
        validationChecks=i.validation_checks or {},
        syncedToCloud=i.synced_to_cloud
    )

@router.get("", response_model=List[IncidentResponse])
def get_incidents(db: Session = Depends(get_db)):
    incidents = db.query(IncidentModel).all()
    return [map_incident_to_response(i) for i in incidents]

@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident_by_id(incident_id: str, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(
        (IncidentModel.incident_id == incident_id) | (IncidentModel.id == incident_id)
    ).first()
    if not i:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found")
    return map_incident_to_response(i)

@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(inc_in: IncidentCreate, db: Session = Depends(get_db)):
    db_inc = IncidentModel(
        id=str(uuid.uuid4()),
        incident_id=inc_in.incident_id,
        camera_id=inc_in.camera_id,
        camera_name=inc_in.camera_name,
        sector=inc_in.sector,
        outpost=inc_in.outpost,
        object_type=inc_in.object_type,
        track_id=inc_in.track_id,
        event_type=inc_in.event_type,
        threat_score=inc_in.threat_score,
        threat_level=inc_in.threat_level,
        threat_factors=[tf.model_dump() for tf in inc_in.threat_factors],
        explainable_reason=inc_in.explainable_reason,
        environment=inc_in.environment,
        ai_reliability=inc_in.ai_reliability,
        visibility_score=inc_in.visibility_score,
        status=inc_in.status,
        sync_status=inc_in.sync_status,
        snapshot_url=inc_in.snapshot_url,
        zone_name=inc_in.zone_name,
        loitering_duration_sec=inc_in.loitering_duration_sec,
        speed_kmh=inc_in.speed_kmh,
        direction=inc_in.direction,
    )
    db.add(db_inc)
    db.commit()
    db.refresh(db_inc)
    return map_incident_to_response(db_inc)

@router.patch("/{incident_id}", response_model=IncidentResponse)
def update_incident_status(incident_id: str, update: IncidentStatusUpdate, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(
        (IncidentModel.incident_id == incident_id) | (IncidentModel.id == incident_id)
    ).first()
    if not i:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found")
    i.status = update.status
    db.commit()
    db.refresh(i)
    return map_incident_to_response(i)

@router.get("/{incident_id}/evidence")
def get_incident_evidence(incident_id: str, db: Session = Depends(get_db)):
    # Moved lazy imports to module level
    i = db.query(IncidentModel).filter(
        (IncidentModel.incident_id == incident_id) | (IncidentModel.id == incident_id)
    ).first()
    if not i:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found")

    records = db.query(EvidenceModel).filter(
        (EvidenceModel.incident_id == i.incident_id) | (EvidenceModel.incident_id == i.id)
    ).all()

    return [
        {
            "id": r.id,
            "incident_id": r.incident_id,
            "evidence_type": r.evidence_type,
            "file_path": r.file_path,
            "sha256_hash": r.sha256_hash,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else None,
            "url": f"/storage/evidence/{os.path.basename(r.file_path)}"
        }
        for r in records
    ]


# ─────────────────────────────────────────────────────────────────────────────
# POST /evidence (Webcam Evidence Upload)
# ─────────────────────────────────────────────────────────────────────────────

evidence_router = APIRouter(prefix="/evidence", tags=["Evidence"])

@evidence_router.post("")
def upload_webcam_evidence(
    file: UploadFile = File(...),
    camera_id: str = Form(...),
    sector: str = Form(...),
    timestamp: str = Form(...),
    event_type: str = Form(...),
    person_count: int = Form(...),
    threat_level: str = Form(...),
    incident_id: Optional[str] = Form(None),
    confidence_values: str = Form(""),
    db: Session = Depends(get_db)
):
    import os
    # Save the file
    storage_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "evidence")
    os.makedirs(storage_dir, exist_ok=True)
    
    file_ext = os.path.splitext(file.filename)[1] or ".jpg"
    inc_uuid = str(uuid.uuid4())
    filename = f"webcam_evidence_{inc_uuid[:8]}{file_ext}"
    dest_path = os.path.join(storage_dir, filename)
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    db_inc = None
    if incident_id:
        db_inc = db.query(IncidentModel).filter(
            (IncidentModel.incident_id == incident_id) | (IncidentModel.id == incident_id)
        ).first()

    if not db_inc:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail="Real incident_id is required. Cannot attach evidence to a missing incident.")
        
    inc_id_str = db_inc.incident_id
    db_inc.snapshot_url = f"/storage/evidence/{filename}"
    
    # Create evidence record
    db_ev = EvidenceModel(
        id=str(uuid.uuid4()),
        incident_id=inc_id_str,
        evidence_type="snapshot",
        file_path=dest_path,
        created_at=datetime.utcnow()
    )
    db.add(db_ev)
    db.commit()
    db.refresh(db_inc)
    
    # Broadcast to WS
    from api.ws import broadcast_event_sync
    inc_data = {
        "id": db_inc.id,
        "incident_id": db_inc.incident_id,
        "camera_id": db_inc.camera_id,
        "object_type": db_inc.object_type,
        "track_id": db_inc.track_id,
        "event_type": db_inc.event_type,
        "threat_score": db_inc.threat_score,
        "threat_level": db_inc.threat_level,
        "zone_name": db_inc.zone_name,
        "explainable_reason": db_inc.explainable_reason,
        "timestamp": db_inc.timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "snapshot_url": db_inc.snapshot_url
    }
    broadcast_event_sync("incident_event", inc_data)
    
    return {"success": True, "incident_id": inc_id_str, "url": f"/storage/evidence/{filename}"}

