from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Query
from sqlalchemy.orm import Session
from typing import List, Optional, Tuple
import uuid
import os
import shutil
from datetime import datetime, timezone


from database.db import get_db
from database.models import IncidentModel, EvidenceModel
from database.schemas import IncidentResponse, IncidentCreate, IncidentStatusUpdate, ThreatFactorSchema

router = APIRouter(prefix="/incidents", tags=["Incidents"])

BACKEND_STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage", "evidence"))
PUBLIC_STORAGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "storage", "evidence"))

def has_physical_evidence(i: IncidentModel, db: Session) -> Tuple[bool, Optional[str]]:
    """
    Checks if incident has a physically retrievable, valid image file on disk.
    Returns (True, resolved_normalized_url) if valid, else (False, None).
    """
    candidates = []
    if i.snapshot_url:
        candidates.append(i.snapshot_url)

    # Check linked evidence models
    evs = db.query(EvidenceModel).filter(
        (EvidenceModel.incident_id == i.incident_id) | (EvidenceModel.incident_id == i.id)
    ).all()
    for ev in evs:
        if ev.file_path:
            candidates.append(ev.file_path)

    for cand in candidates:
        if not cand or str(cand).lower() in ("none", "null", "undefined", ""):
            continue
        fname = os.path.basename(str(cand).replace("\\", "/"))
        if not fname:
            continue
        p1 = os.path.join(BACKEND_STORAGE_DIR, fname)
        p2 = os.path.join(PUBLIC_STORAGE_DIR, fname)
        if (os.path.isfile(p1) and os.path.getsize(p1) > 0) or (os.path.isfile(p2) and os.path.getsize(p2) > 0):
            return True, f"/storage/evidence/{fname}"

    return False, None

def normalize_snapshot_url(raw_url: Optional[str]) -> str:
    if not raw_url:
        return ""
    if raw_url.startswith("http://") or raw_url.startswith("https://"):
        return raw_url
    # Strip any Windows drive or path prefix if raw_url was stored as a filesystem path
    if "\\" in raw_url or (len(raw_url) > 2 and raw_url[1] == ":"):
        fname = os.path.basename(raw_url.replace("\\", "/"))
        return f"/storage/evidence/{fname}"
    if not raw_url.startswith("/"):
        if raw_url.startswith("storage/"):
            return f"/{raw_url}"
        return f"/storage/evidence/{raw_url}"
    return raw_url

def map_incident_to_response(i: IncidentModel, resolved_url: Optional[str] = None) -> IncidentResponse:
    snap_url = resolved_url or normalize_snapshot_url(i.snapshot_url)
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
        threat_factors=[ThreatFactorSchema(**tf) if isinstance(tf, dict) else tf for tf in (i.threat_factors or [])],
        explainable_reason=i.explainable_reason,
        environment=i.environment,
        ai_reliability=i.ai_reliability,
        visibility_score=i.visibility_score,
        status=i.status or "active",
        sync_status=i.sync_status or "unsynced",
        snapshot_url=snap_url,
        zone_name=i.zone_name or "Default Zone",
        loitering_duration_sec=i.loitering_duration_sec or 0,
        speed_kmh=i.speed_kmh or 0.0,
        direction=i.direction or "Inward Perimeter",
        smart_alert_confirmed=i.smart_alert_confirmed if i.smart_alert_confirmed is not None else True,
        validation_checks=i.validation_checks or {},
        synced_to_cloud=i.synced_to_cloud or False,
        synced_timestamp=i.synced_timestamp,
        timestamp=i.timestamp,

        source_video_timestamp_sec=getattr(i, 'source_video_timestamp_sec', None),
        # CamelCase Aliases for Frontend
        cameraName=i.camera_name,
        cameraId=i.camera_id,
        objectType=i.object_type,
        persistentId=i.track_id,
        threatScore=i.threat_score,
        threatFactors=[ThreatFactorSchema(**tf) if isinstance(tf, dict) else tf for tf in (i.threat_factors or [])],
        explainableReason=i.explainable_reason,
        environmentalCondition=i.environment,
        aiReliability=i.ai_reliability,
        visibilityScore=i.visibility_score,
        snapshotUrl=snap_url,
        zoneName=i.zone_name,
        loiteringDurationSec=i.loitering_duration_sec,
        speedKmh=i.speed_kmh,
        smartAlertConfirmed=i.smart_alert_confirmed,
        validationChecks=i.validation_checks or {},
        syncedToCloud=i.synced_to_cloud,
        personName=i.person_name,
        faceRecognized=i.face_recognized,
        faceConfidence=i.face_confidence,
        sourceVideoTimestampSec=getattr(i, 'source_video_timestamp_sec', None),
    )


@router.get("", response_model=List[IncidentResponse])
def get_incidents(
    demo_only: bool = Query(True, description="Filter to genuine incidents with physically retrievable evidence"),
    all: bool = Query(False, description="Administrative access to all historical database records"),
    db: Session = Depends(get_db)
):
    incidents = db.query(IncidentModel).order_by(IncidentModel.timestamp.desc()).all()
    if demo_only and not all:
        results = []
        for inc in incidents:
            has_file, valid_url = has_physical_evidence(inc, db)
            if has_file:
                results.append(map_incident_to_response(inc, valid_url))
        return results

    return [map_incident_to_response(i) for i in incidents]

@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident_by_id(incident_id: str, db: Session = Depends(get_db)):
    i = db.query(IncidentModel).filter(
        (IncidentModel.incident_id == incident_id) | (IncidentModel.id == incident_id)
    ).first()
    if not i:
        raise HTTPException(status_code=404, detail=f"Incident '{incident_id}' not found")
    has_file, valid_url = has_physical_evidence(i, db)
    return map_incident_to_response(i, valid_url if has_file else None)

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
        created_at=datetime.now(timezone.utc)
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

