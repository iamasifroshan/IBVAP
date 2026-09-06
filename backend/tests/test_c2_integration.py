"""
Unit and Integration Tests for Phase 6 — C2 / Command & Control Integration Layer.
Tests:
- Disabled mode by default
- Outbound event building and schema validation
- Mock HTTP transport and 200 ACK handling
- Deduplication and threat escalation re-dispatch
- Delivery failure, bounded retries, and FAILED audit logging
- Unreachable endpoints and pipeline isolation
- REST endpoints (/status, /events, /events/{id}, /test-event, /simulated-receiver)
"""

import time
import uuid
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from database.db import SessionLocal
from database.models import C2DeliveryModel, SecurityEventModel
from integrations.c2.config import C2Config
from integrations.c2.base import C2DeliveryStatus, C2OutboundEvent, C2DeliveryResult
from integrations.c2.adapter import C2Adapter
from ai.security_intelligence import UnifiedEventState, UnifiedSecurityIntelligenceEngine
from main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def sample_event_state():
    state = UnifiedEventState(
        event_id=f"SEC-TEST-{uuid.uuid4().hex[:6]}",
        camera_id="BORDER-CAM-07",
        camera_name="Border Cam 07",
        subject_type="human",
        track_id=99,
        track_label="TRK#99"
    )
    state.threat_level = "medium"
    state.threat_score = 55
    state.threat_reason = "Loitering near restricted perimeter"
    state.contributing_signals = ["ZONE_INTRUSION", "LOITERING"]
    state.face_info = {"identity_status": "UNKNOWN", "person_name": None}
    state.related_incident_ids = ["INC-101"]
    state.snapshot_url = "/storage/evidence/test.jpg"
    return state


# 1. Disabled by default
def test_c2_disabled_by_default(sample_event_state):
    config = C2Config(enabled=False)
    adapter = C2Adapter(config=config)

    assert adapter.is_enabled is False
    # Dispatching when disabled must return immediately without queueing
    future = adapter.notify_security_event(sample_event_state)
    assert future is None

    status = adapter.get_status()
    assert status["enabled"] is False
    assert status["delivered_count"] == 0
    assert status["connected"] is False


# 2. Outbound event building and schema validation
def test_c2_payload_structure(sample_event_state):
    adapter = C2Adapter()
    event = adapter._build_event_from_state(sample_event_state)

    assert isinstance(event, C2OutboundEvent)
    assert event.source == "IBVAP"
    assert event.event_type == "SECURITY_EVENT"
    assert event.security_event_id == sample_event_state.event_id
    assert event.subject_type == "human"
    assert event.threat["level"] == "medium"
    assert event.threat["score"] == 55
    assert "ZONE_INTRUSION" in event.contributing_signals
    assert event.location["camera_id"] == "BORDER-CAM-07"
    assert event.related_incidents == ["INC-101"]

    payload_dict = event.to_dict()
    assert "event_id" in payload_dict
    assert "timestamp" in payload_dict
    assert payload_dict["source"] == "IBVAP"


# 3. Enabled with mock HTTP transport returning 200/ACK
def test_c2_enabled_mock_transport(sample_event_state, db_session):
    config = C2Config(
        enabled=True,
        endpoint="http://localhost:8000/api/v1/c2/simulated-receiver",
        timeout_seconds=2.0,
        max_retries=1
    )
    adapter = C2Adapter(config=config)

    # Mock _send_http to return 200 ACK
    with patch.object(adapter, "_send_http", return_value=(200, '{"status": "acknowledged", "ack_id": "ACK-123"}')):
        future = adapter.notify_security_event(sample_event_state, db=db_session)
        assert future is not None
        result: C2DeliveryResult = future.result(timeout=5.0)

        assert result.status == C2DeliveryStatus.ACKNOWLEDGED
        assert result.response_status == 200
        assert adapter.get_status()["delivered_count"] == 1
        assert adapter.get_status()["connected"] is True


# 4. Deduplication
def test_c2_deduplication(sample_event_state, db_session):
    config = C2Config(enabled=True, endpoint="http://localhost:8000/api/v1/c2/simulated-receiver", max_retries=1)
    adapter = C2Adapter(config=config)

    with patch.object(adapter, "_send_http", return_value=(200, '{"status": "acknowledged"}')):
        # First call: dispatches
        fut1 = adapter.notify_security_event(sample_event_state, db=db_session)
        assert fut1 is not None
        res1 = fut1.result(timeout=5.0)
        assert res1.status == C2DeliveryStatus.ACKNOWLEDGED

        # Second call at same threat level: skipped
        fut2 = adapter.notify_security_event(sample_event_state, db=db_session)
        assert fut2 is None
        assert adapter.get_status()["delivered_count"] == 1


# 5. Threat escalation re-dispatch
def test_c2_threat_escalation_redispatch(sample_event_state, db_session):
    config = C2Config(enabled=True, endpoint="http://localhost:8000/api/v1/c2/simulated-receiver", max_retries=1)
    adapter = C2Adapter(config=config)

    with patch.object(adapter, "_send_http", return_value=(200, '{"status": "acknowledged"}')):
        # First call: medium threat
        sample_event_state.threat_level = "medium"
        fut1 = adapter.notify_security_event(sample_event_state, db=db_session)
        assert fut1 is not None
        fut1.result(timeout=5.0)

        # Escalation: high threat
        sample_event_state.threat_level = "high"
        sample_event_state.threat_score = 80
        fut2 = adapter.notify_security_event(sample_event_state, db=db_session)
        assert fut2 is not None
        res2 = fut2.result(timeout=5.0)
        assert res2.status == C2DeliveryStatus.ACKNOWLEDGED
        assert adapter.get_status()["delivered_count"] == 2


# 6. Delivery failure and retry
def test_c2_delivery_failure_and_retry(sample_event_state, db_session):
    config = C2Config(
        enabled=True,
        endpoint="http://localhost:8000/api/v1/c2/simulated-receiver",
        max_retries=2,
        timeout_seconds=0.5
    )
    adapter = C2Adapter(config=config)

    # Return 500 error on each attempt
    with patch.object(adapter, "_send_http", return_value=(500, '{"error": "Internal Server Error"}')):
        future = adapter.notify_security_event(sample_event_state, db=db_session)
        assert future is not None
        result = future.result(timeout=10.0)

        assert result.status == C2DeliveryStatus.FAILED
        assert result.attempt_count == 2
        assert adapter.get_status()["failed_count"] >= 1


# 7. Endpoint unreachable (Connection refused / network timeout)
def test_c2_endpoint_unreachable(sample_event_state, db_session):
    config = C2Config(
        enabled=True,
        endpoint="http://127.0.0.1:19999/non-existent-c2",
        max_retries=1,
        timeout_seconds=0.2
    )
    adapter = C2Adapter(config=config)

    # Let it attempt real connection to closed port 19999
    future = adapter.notify_security_event(sample_event_state, db=db_session)
    assert future is not None
    result = future.result(timeout=5.0)

    assert result.status == C2DeliveryStatus.FAILED
    assert result.error_message is not None


# 8. Pipeline isolation: Surveillance engine does NOT crash on C2 exceptions
def test_c2_pipeline_isolation(sample_event_state, db_session):
    config = C2Config(enabled=True, endpoint="http://localhost:8000/api/v1/c2", max_retries=1)
    adapter = C2Adapter(config=config)

    # Force notify_security_event to raise an unexpected exception
    with patch.object(adapter, "notify_security_event", side_effect=RuntimeError("Catastrophic C2 failure")):
        engine = UnifiedSecurityIntelligenceEngine()
        # Engine's _notify_c2 must catch and not raise
        try:
            engine._notify_c2(sample_event_state, db=db_session)
        except Exception as e:
            pytest.fail(f"Pipeline isolation violated: {e}")


# 9. GET /api/v1/c2/status endpoint
def test_c2_status_endpoint(client):
    response = client.get("/api/v1/c2/status")
    assert response.status_code == 200
    data = response.json()
    assert "enabled" in data
    assert "endpoint_configured" in data
    assert "connected" in data
    assert "delivered_count" in data
    assert "failed_count" in data


# 10. GET /api/v1/c2/events endpoint
def test_c2_events_endpoint(client):
    response = client.get("/api/v1/c2/events?limit=10")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "deliveries" in data
    assert isinstance(data["deliveries"], list)


# 11. GET /api/v1/c2/events/{id} endpoint
def test_c2_event_by_id_endpoint(client):
    # Non-existent ID returns 404
    response = client.get("/api/v1/c2/events/non-existent-uuid")
    assert response.status_code == 404


# 12. POST /api/v1/c2/test-event endpoint
def test_c2_test_event_endpoint(client):
    response = client.post("/api/v1/c2/test-event")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["queued", "disabled"]
    assert "test_event_id" in data


# 13. POST /api/v1/c2/simulated-receiver endpoint
def test_simulated_c2_receiver(client):
    payload = {
        "event_id": "TEST-EVT-001",
        "source": "IBVAP",
        "security_event_id": "SEC-EVT-001",
        "threat": {"level": "high", "score": 85}
    }
    response = client.post("/api/v1/c2/simulated-receiver", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "acknowledged"
    assert "ack_id" in data
    assert data["event_id"] == "TEST-EVT-001"
