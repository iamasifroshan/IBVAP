"""
C2 Base Contracts, Enums, and Data Models.
Defines vendor-neutral schemas for outbound Command & Control event delivery conforming to Phase 6 Section 7.
"""

from enum import Enum
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone


class C2DeliveryStatus(str, Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


@dataclass
class C2OutboundEvent:
    """
    Standardized vendor-neutral event contract for external Command & Control.
    Conforms strictly to Phase 6 Section 7 specifications.
    """
    event_id: str
    source: str = "IBVAP"
    security_event_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    event_type: str = "SECURITY_EVENT"
    subject_type: str = "human"
    threat: Dict[str, Any] = field(default_factory=lambda: {"level": "low", "score": 20, "primary_factor": "Border surveillance observation"})
    contributing_signals: List[str] = field(default_factory=list)
    location: Dict[str, Any] = field(default_factory=lambda: {"camera_id": "", "camera_name": "", "zone_name": None})
    subject: Dict[str, Any] = field(default_factory=dict)
    related_incidents: List[str] = field(default_factory=list)
    evidence_snapshots: List[str] = field(default_factory=list)
    is_test: bool = False

    @property
    def threat_level(self) -> str:
        return self.threat.get("level", "low")

    @property
    def threat_score(self) -> int:
        return self.threat.get("score", 20)

    @property
    def camera_id(self) -> str:
        return self.location.get("camera_id", "")

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return {k: v for k, v in d.items() if not k.startswith("_")}


@dataclass
class C2DeliveryResult:
    """
    Result of a delivery attempt to external C2 or simulated receiver.
    """
    success: bool
    status: C2DeliveryStatus
    attempt_count: int = 1
    response_status: Optional[int] = None
    error_message: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    delivery_id: Optional[str] = None
