from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid

from database.db import get_db
from database.models import ZoneModel
from database.schemas import ZoneResponse, ZoneCreate

router = APIRouter(prefix="/zones", tags=["Zones"])

def map_zone_to_response(z: ZoneModel) -> ZoneResponse:
    return ZoneResponse(
        id=z.id,
        name=z.name,
        camera_id=z.camera_id,
        sector=z.sector,
        zone_type=z.zone_type,
        polygon_coordinates=z.polygon_coordinates or [],
        severity=z.severity,
        sensitivity=z.sensitivity,
        min_threat_threshold=z.min_threat_threshold,
        loitering_limit_sec=z.loitering_limit_sec,
        enabled=z.enabled,
        created_at=z.created_at,
        human_detection=z.human_detection,
        vehicle_detection=z.vehicle_detection,
        animal_detection=z.animal_detection,
        person_threshold=z.person_threshold,
    )

@router.get("", response_model=List[ZoneResponse])
def get_zones(db: Session = Depends(get_db)):
    zones = db.query(ZoneModel).all()
    return [map_zone_to_response(z) for z in zones]

@router.get("/{zone_id}", response_model=ZoneResponse)
def get_zone_by_id(zone_id: str, db: Session = Depends(get_db)):
    z = db.query(ZoneModel).filter(ZoneModel.id == zone_id).first()
    if not z:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    return map_zone_to_response(z)

@router.post("", response_model=ZoneResponse, status_code=status.HTTP_201_CREATED)
def create_zone(zone_in: ZoneCreate, db: Session = Depends(get_db)):
    db_zone = ZoneModel(
        id=str(uuid.uuid4()),
        name=zone_in.name,
        camera_id=zone_in.camera_id,
        sector=zone_in.sector,
        zone_type=zone_in.zone_type,
        polygon_coordinates=[p.model_dump() for p in zone_in.polygon_coordinates],
        severity=zone_in.severity,
        sensitivity=zone_in.sensitivity,
        min_threat_threshold=zone_in.min_threat_threshold,
        loitering_limit_sec=zone_in.loitering_limit_sec,
        enabled=zone_in.enabled,
        human_detection=zone_in.human_detection,
        vehicle_detection=zone_in.vehicle_detection,
        animal_detection=zone_in.animal_detection,
        person_threshold=zone_in.person_threshold,
    )
    db.add(db_zone)
    db.commit()
    db.refresh(db_zone)
    return map_zone_to_response(db_zone)

@router.put("/{zone_id}", response_model=ZoneResponse)
def update_zone(zone_id: str, zone_in: ZoneCreate, db: Session = Depends(get_db)):
    z = db.query(ZoneModel).filter(ZoneModel.id == zone_id).first()
    if not z:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    
    z.name = zone_in.name
    z.camera_id = zone_in.camera_id
    z.sector = zone_in.sector
    z.zone_type = zone_in.zone_type
    z.polygon_coordinates = [p.model_dump() for p in zone_in.polygon_coordinates]
    z.severity = zone_in.severity
    z.sensitivity = zone_in.sensitivity
    z.min_threat_threshold = zone_in.min_threat_threshold
    z.loitering_limit_sec = zone_in.loitering_limit_sec
    z.enabled = zone_in.enabled
    z.human_detection = zone_in.human_detection
    z.vehicle_detection = zone_in.vehicle_detection
    z.animal_detection = zone_in.animal_detection
    z.person_threshold = zone_in.person_threshold
    
    db.commit()
    db.refresh(z)
    return map_zone_to_response(z)

@router.delete("/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(zone_id: str, db: Session = Depends(get_db)):
    z = db.query(ZoneModel).filter(ZoneModel.id == zone_id).first()
    if not z:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")
    db.delete(z)
    db.commit()
    return None
