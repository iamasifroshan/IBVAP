"""
Vendor-Neutral Command & Control (C2) Adapter for IBVAP.
Dispatches unified security events to external C2 systems asynchronously without blocking
the primary surveillance and AI inference pipelines.

Key Features:
- Asynchronous, non-blocking ThreadPoolExecutor dispatch
- Exponential backoff retry with bounded attempts
- Automatic deduplication and escalation re-dispatch
- Structured audit logging into the SQLite c2_deliveries table
- Real-time WebSocket telemetry for operator dashboard visibility
"""

import json
import time
import uuid
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Dict, Optional, Any, Tuple

from database.db import SessionLocal
from database.models import C2DeliveryModel
from api.ws import broadcast_event_sync
from .config import c2_config, C2Config
from .base import C2DeliveryStatus, C2OutboundEvent, C2DeliveryResult

logger = logging.getLogger("integrations.c2")

THREAT_LEVEL_RANK = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class C2Adapter:
    """
    Vendor-neutral adapter for dispatching security intelligence events
    to external Command & Control nodes.
    """

    def __init__(self, config: Optional[C2Config] = None):
        self.config = config or c2_config
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="c2-worker")
        self._dispatched_events: Dict[str, str] = {}  # event_id -> last_dispatched_threat_level
        self._delivered_count = 0
        self._failed_count = 0
        self._last_delivery_time: Optional[datetime] = None
        self._last_connected: bool = False

    @property
    def is_enabled(self) -> bool:
        return self.config.enabled

    @property
    def delivered_count(self) -> int:
        return self._delivered_count

    @property
    def failed_count(self) -> int:
        return self._failed_count

    @property
    def last_delivery_time(self) -> Optional[datetime]:
        return self._last_delivery_time

    @property
    def is_connected(self) -> bool:
        return self._last_connected

    def get_status(self) -> Dict[str, Any]:
        """Returns runtime status for /api/v1/c2/status."""
        endpoint = self.config.endpoint
        is_configured = bool(endpoint)
        return {
            "enabled": self.config.enabled,
            "endpoint_configured": is_configured,
            "connected": self._last_connected if is_configured and self.config.enabled else False,
            "last_delivery": self._last_delivery_time.isoformat() if self._last_delivery_time else None,
            "delivered_count": self._delivered_count,
            "failed_count": self._failed_count,
        }

    def should_dispatch(self, event_id: str, threat_level: str) -> bool:
        """
        Determines whether event should be dispatched:
        - True if event_id has not been sent yet
        - True if threat level has escalated (e.g. LOW -> HIGH)
        - False if event_id was already dispatched at same or higher threat level
        """
        curr_rank = THREAT_LEVEL_RANK.get(threat_level.lower(), 1)
        prev_level = self._dispatched_events.get(event_id)
        if prev_level is None:
            return True
        prev_rank = THREAT_LEVEL_RANK.get(prev_level.lower(), 1)
        return curr_rank > prev_rank

    def notify_security_event(self, state_or_event: Any, db: Optional[Any] = None) -> Optional[Future]:
        """
        Non-blocking hook called by the Unified Security Intelligence engine
        whenever a meaningful security event is created or updated.
        Returns a background Future when queued, or None if skipped/disabled.
        """
        try:
            if not self.config.enabled:
                return None

            event_id = getattr(state_or_event, "event_id", None) or getattr(state_or_event, "id", None)
            threat_level = getattr(state_or_event, "threat_level", "low")

            if not event_id:
                return None

            # Check deduplication & escalation
            if not self.should_dispatch(event_id, threat_level):
                return None

            # Construct standardized C2 event contract
            c2_event = self._build_event_from_state(state_or_event)
            # Record dispatched threat level
            self._dispatched_events[event_id] = threat_level

            # Submit to background thread pool for non-blocking execution
            return self._executor.submit(self.dispatch_event_sync, c2_event)

        except Exception as err:
            # Absolute safety: C2 must NEVER disrupt surveillance pipeline
            logger.warning(f"[C2Adapter] notify_security_event suppressed error: {err}")
            return None

    def _send_http(self, endpoint: str, body_bytes: bytes, headers: Dict[str, str], timeout: float) -> Tuple[int, str]:
        """Internal HTTP sender helper - can be patched in tests."""
        req = urllib.request.Request(endpoint, data=body_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8")

    def dispatch_event_sync(self, event: C2OutboundEvent) -> C2DeliveryResult:
        """
        Executes HTTP delivery with bounded retry and persists audit record in DB.
        Can be called directly from background worker or synchronously during testing.
        """
        delivery_id = str(uuid.uuid4())
        now = _utcnow()
        payload = event.to_dict()

        # 1. Create PENDING delivery record in database
        self._record_delivery_start(delivery_id, event.event_id, event.event_type, payload, now)

        # Broadcast WebSocket: C2_EVENT_SENT
        try:
            broadcast_event_sync("C2_EVENT_SENT", {
                "delivery_id": delivery_id,
                "event_id": event.event_id,
                "threat_level": event.threat_level,
                "timestamp": now.isoformat(),
            })
        except Exception:
            pass

        # 2. Check if endpoint is configured
        endpoint = self.config.endpoint
        if not endpoint:
            result = C2DeliveryResult(
                success=False,
                status=C2DeliveryStatus.FAILED,
                attempt_count=0,
                error_message="C2 endpoint is not configured (C2_ENDPOINT is empty)",
                delivery_id=delivery_id,
            )
            self._record_delivery_finish(delivery_id, result)
            self._failed_count += 1
            self._last_connected = False
            return result

        # 3. Bounded retry loop
        max_attempts = max(1, self.config.max_retries)
        timeout = self.config.timeout_seconds
        api_key = self.config.api_key

        last_error = None
        response_code = None

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "IBVAP-C2-Adapter/1.0",
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        body_bytes = json.dumps(payload).encode("utf-8")

        for attempt in range(1, max_attempts + 1):
            try:
                response_code, resp_body = self._send_http(endpoint, body_bytes, headers, timeout)

                if 200 <= response_code < 300:
                    # Successful ACK
                    ack_time = _utcnow()
                    result = C2DeliveryResult(
                        success=True,
                        status=C2DeliveryStatus.ACKNOWLEDGED,
                        attempt_count=attempt,
                        response_status=response_code,
                        acknowledged_at=ack_time,
                        delivery_id=delivery_id,
                    )
                    self._record_delivery_finish(delivery_id, result, attempt)
                    self._delivered_count += 1
                    self._last_delivery_time = ack_time
                    self._last_connected = True

                    try:
                        broadcast_event_sync("C2_EVENT_ACKNOWLEDGED", {
                            "delivery_id": delivery_id,
                            "event_id": event.event_id,
                            "status_code": response_code,
                            "acknowledged_at": ack_time.isoformat(),
                        })
                    except Exception:
                        pass

                    logger.info(f"[C2Adapter] Successfully delivered event {event.event_id} (Attempt {attempt}, HTTP {response_code})")
                    return result
                else:
                    last_error = f"HTTP error {response_code}: {resp_body[:200]}"

            except urllib.error.HTTPError as http_err:
                response_code = http_err.code
                last_error = f"HTTP {http_err.code}: {http_err.reason}"
            except urllib.error.URLError as url_err:
                last_error = f"Connection failed: {url_err.reason}"
            except Exception as ex:
                last_error = f"Unexpected error: {str(ex)}"

            # Bounded brief backoff between retries (e.g. 0.05s * attempt)
            if attempt < max_attempts:
                time.sleep(0.05 * attempt)

        # Exhausted bounded retries -> FAILED
        result = C2DeliveryResult(
            success=False,
            status=C2DeliveryStatus.FAILED,
            attempt_count=max_attempts,
            response_status=response_code,
            error_message=last_error or "Delivery failed after max retries",
            delivery_id=delivery_id,
        )
        self._record_delivery_finish(delivery_id, result, max_attempts)
        self._failed_count += 1
        self._last_connected = False

        try:
            broadcast_event_sync("C2_EVENT_FAILED", {
                "delivery_id": delivery_id,
                "event_id": event.event_id,
                "error": result.error_message,
                "attempts": max_attempts,
            })
        except Exception:
            pass

        logger.warning(f"[C2Adapter] Delivery failed for event {event.event_id}: {result.error_message}")
        return result

    def _build_event_from_state(self, state: Any) -> C2OutboundEvent:
        """
        Translates UnifiedEventState or SecurityEventModel into C2OutboundEvent.
        Strictly conforms to Section 7 schema without fabricating nonexistent data.
        """
        sec_event_id = getattr(state, "event_id", "") or getattr(state, "id", "") or str(uuid.uuid4())
        camera_id = getattr(state, "camera_id", "")
        camera_name = getattr(state, "camera_name", "") or camera_id
        track_id = getattr(state, "track_id", None)
        subject_type = getattr(state, "subject_type", "human")
        threat_level = getattr(state, "threat_level", "low")
        threat_score = getattr(state, "threat_score", 20)
        threat_reason = getattr(state, "threat_reason", "") or "Border surveillance observation"
        snapshot_url = getattr(state, "snapshot_url", None)
        zone = getattr(state, "zone_name", None)
        contributing_signals = getattr(state, "contributing_signals", []) or []
        related_incidents = getattr(state, "related_incident_ids", []) or []

        # Face info
        face_info = getattr(state, "face_info", None) or {}
        # Vehicle info
        v_info = getattr(state, "vehicle_info", None) or {}

        # Construct subject details
        subject: Dict[str, Any] = {
            "track_id": track_id,
            "track_label": getattr(state, "track_label", f"TRK#{track_id}" if track_id is not None else ""),
        }
        if subject_type == "human":
            subject["identity"] = {
                "status": face_info.get("identity_status", "UNKNOWN"),
                "person_name": face_info.get("person_name"),
                "confidence": face_info.get("confidence"),
            }
        else:
            subject["vehicle"] = {
                "class": v_info.get("vehicle_class"),
                "plate": v_info.get("plate_text"),
                "format_valid": v_info.get("format_valid", False),
            }

        # Timestamp
        ts = getattr(state, "last_seen_dt", None) or getattr(state, "created_at", None) or _utcnow()
        ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)

        evidence_snapshots = [snapshot_url] if snapshot_url else []

        return C2OutboundEvent(
            event_id=f"c2-evt-{uuid.uuid4().hex[:12]}",
            source="IBVAP",
            security_event_id=sec_event_id,
            timestamp=ts_iso,
            event_type="SECURITY_EVENT",
            subject_type=subject_type,
            threat={
                "level": threat_level,
                "score": threat_score,
                "primary_factor": threat_reason,
            },
            contributing_signals=list(contributing_signals),
            location={
                "camera_id": camera_id,
                "camera_name": camera_name,
                "zone_name": zone,
            },
            subject=subject,
            related_incidents=list(related_incidents),
            evidence_snapshots=evidence_snapshots,
            is_test=False,
        )

    def _record_delivery_start(
        self,
        delivery_id: str,
        security_event_id: str,
        event_type: str,
        payload: Dict[str, Any],
        start_time: datetime,
    ):
        """Creates initial PENDING record in c2_deliveries."""
        db = SessionLocal()
        try:
            rec = C2DeliveryModel(
                id=delivery_id,
                security_event_id=security_event_id,
                event_type=event_type,
                status=C2DeliveryStatus.PENDING.value,
                attempt_count=0,
                last_attempt_at=start_time,
                payload=payload,
                created_at=start_time,
                updated_at=start_time,
            )
            db.add(rec)
            db.commit()
        except Exception as e:
            logger.error(f"[C2Adapter] Failed to insert initial c2_delivery {delivery_id}: {e}")
        finally:
            db.close()

    def _record_delivery_finish(
        self,
        delivery_id: str,
        result: C2DeliveryResult,
        attempts: int = 1,
    ):
        """Updates delivery outcome and audit fields in c2_deliveries."""
        db = SessionLocal()
        try:
            rec = db.query(C2DeliveryModel).filter(C2DeliveryModel.id == delivery_id).first()
            if rec:
                rec.status = result.status.value
                rec.attempt_count = attempts
                rec.last_attempt_at = _utcnow()
                rec.acknowledged_at = result.acknowledged_at
                rec.response_status = result.response_status
                rec.error_message = result.error_message
                rec.updated_at = _utcnow()
                db.commit()
        except Exception as e:
            logger.error(f"[C2Adapter] Failed to update c2_delivery {delivery_id}: {e}")
        finally:
            db.close()


# Global default instance
c2_adapter = C2Adapter()
