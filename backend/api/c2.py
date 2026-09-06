"""
C2 Integration API Router.
Provides administrative endpoints for C2 status, delivery audits, test dispatch,
and the development-only Simulated C2 Receiver.
"""

import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from database.db import get_db
from database.models import C2DeliveryModel, SecurityEventModel
from integrations.c2 import c2_adapter, c2_config
from integrations.c2.base import C2OutboundEvent

logger = logging.getLogger("api.c2")

router = APIRouter(prefix="/c2", tags=["Command & Control Integration"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class C2StatusResponse(BaseModel):
    enabled: bool
    endpoint_configured: bool
    connected: bool
    last_delivery: Optional[str] = None
    delivered_count: int
    failed_count: int


class C2DeliveryItem(BaseModel):
    id: str
    security_event_id: str
    event_type: str
    status: str
    attempt_count: int
    last_attempt_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    response_status: Optional[int] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    payload: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)


class C2DeliveryListResponse(BaseModel):
    total: int
    limit: int
    offset: int
    deliveries: List[C2DeliveryItem]


class C2TestEventResponse(BaseModel):
    status: str  # "queued" or "disabled"
    test_event_id: str
    message: str


class SimulatedC2AckResponse(BaseModel):
    status: str = "acknowledged"
    ack_id: str
    event_id: str
    received_at: str


# In-memory storage for simulated receiver test events
_simulated_c2_received_events: List[Dict[str, Any]] = []


@router.get("/status", response_model=C2StatusResponse)
def get_c2_status():
    """
    Returns runtime configuration, connection status, and telemetry counters
    for external Command & Control integration.
    """
    return c2_adapter.get_status()


@router.get("/events", response_model=C2DeliveryListResponse)
def get_c2_events(
    status: Optional[str] = Query(None, description="Filter by PENDING, SENT, ACKNOWLEDGED, FAILED, SKIPPED"),
    security_event_id: Optional[str] = Query(None, description="Filter by security event ID"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Retrieves paginated audit trail of C2 delivery attempts.
    """
    query = db.query(C2DeliveryModel)

    if status:
        query = query.filter(C2DeliveryModel.status == status.upper())
    if security_event_id:
        query = query.filter(C2DeliveryModel.security_event_id == security_event_id)

    total = query.count()
    records = query.order_by(C2DeliveryModel.created_at.desc()).offset(offset).limit(limit).all()

    items = [
        C2DeliveryItem(
            id=r.id,
            security_event_id=r.security_event_id,
            event_type=r.event_type,
            status=r.status,
            attempt_count=r.attempt_count or 0,
            last_attempt_at=r.last_attempt_at,
            acknowledged_at=r.acknowledged_at,
            response_status=r.response_status,
            error_message=r.error_message,
            created_at=r.created_at,
            updated_at=r.updated_at,
            payload=r.payload,
        )
        for r in records
    ]

    return C2DeliveryListResponse(
        total=total,
        limit=limit,
        offset=offset,
        deliveries=items,
    )


@router.get("/events/{id}", response_model=C2DeliveryItem)
def get_c2_event_by_id(id: str, db: Session = Depends(get_db)):
    """
    Retrieves full audit details and payload for a single C2 delivery attempt.
    """
    record = db.query(C2DeliveryModel).filter(C2DeliveryModel.id == id).first()
    if not record:
        raise HTTPException(status_code=404, detail=f"C2 delivery record '{id}' not found")

    return C2DeliveryItem(
        id=record.id,
        security_event_id=record.security_event_id,
        event_type=record.event_type,
        status=record.status,
        attempt_count=record.attempt_count or 0,
        last_attempt_at=record.last_attempt_at,
        acknowledged_at=record.acknowledged_at,
        response_status=record.response_status,
        error_message=record.error_message,
        created_at=record.created_at,
        updated_at=record.updated_at,
        payload=record.payload,
    )


@router.post("/test-event", response_model=C2TestEventResponse)
def trigger_c2_test_event():
    """
    Constructs and dispatches a simulated test security event to verify
    C2 delivery connectivity. Conforms to Section 11 specification.
    """
    test_event_id = f"SEC-TEST-{uuid.uuid4().hex[:6].upper()}"

    if not c2_adapter.is_enabled:
        return C2TestEventResponse(
            status="disabled",
            test_event_id=test_event_id,
            message="C2 integration is currently disabled in configuration (C2_INTEGRATION_ENABLED=false)",
        )

    outbound = C2OutboundEvent(
        event_id=f"c2-test-{uuid.uuid4().hex[:12]}",
        source="IBVAP",
        security_event_id=test_event_id,
        timestamp=_utcnow().isoformat(),
        event_type="SECURITY_EVENT",
        subject_type="human",
        threat={
            "level": "high",
            "score": 85,
            "primary_factor": "Simulated border intrusion test event",
        },
        contributing_signals=["ZONE_INTRUSION", "LOITERING", "SIMULATED_TEST"],
        location={
            "camera_id": "BORDER-CAM-07",
            "camera_name": "Sector B Outpost Cam",
            "zone_name": "Simulated Sector Test Zone",
        },
        subject={
            "track_id": 999,
            "track_label": "TRK#999",
            "identity": {
                "status": "UNKNOWN",
                "person_name": None,
                "confidence": None,
            },
        },
        related_incidents=[],
        evidence_snapshots=["/storage/evidence/test_snapshot.jpg"],
        is_test=True,
    )

    # Submit to worker
    c2_adapter._executor.submit(c2_adapter.dispatch_event_sync, outbound)

    return C2TestEventResponse(
        status="queued",
        test_event_id=test_event_id,
        message=f"Test event {test_event_id} queued for C2 dispatch",
    )


@router.post("/simulated-receiver", response_model=SimulatedC2AckResponse)
def simulated_c2_receiver(payload: Dict[str, Any]):
    """
    Development-only Simulated C2 Receiver.
    Validates required fields in the standardized IBVAP C2 contract,
    records the event, and returns HTTP 200 with an ACK acknowledgment.

    DISCLAIMER: This is a test harness receiver and not a real government system.
    """
    now_iso = _utcnow().isoformat()
    event_id = payload.get("event_id")

    if not event_id:
        raise HTTPException(status_code=400, detail="Missing required field: event_id")

    record = {
        "received_at": now_iso,
        "event_id": event_id,
        "payload": payload,
    }
    _simulated_c2_received_events.append(record)
    if len(_simulated_c2_received_events) > 100:
        _simulated_c2_received_events.pop(0)

    logger.info(f"[Simulated C2 Receiver] Successfully received and acknowledged event: {event_id}")

    return SimulatedC2AckResponse(
        status="acknowledged",
        ack_id=f"sim-ack-{uuid.uuid4().hex[:12]}",
        event_id=event_id,
        received_at=now_iso,
    )


@router.get("/simulated-receiver/received", response_model=List[Dict[str, Any]])
def get_simulated_received_events():
    """
    Returns events received by the development-only Simulated C2 Receiver.
    """
    return _simulated_c2_received_events
