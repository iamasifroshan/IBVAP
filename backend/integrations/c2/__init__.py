"""
Command & Control (C2) Integration Package for IBVAP.
Provides vendor-neutral interoperability with external C2 systems.
"""

from integrations.c2.config import c2_config, C2Config
from integrations.c2.base import C2DeliveryStatus, C2OutboundEvent, C2DeliveryResult
from integrations.c2.adapter import c2_adapter, C2Adapter

__all__ = [
    "c2_config",
    "C2Config",
    "C2DeliveryStatus",
    "C2OutboundEvent",
    "C2DeliveryResult",
    "c2_adapter",
    "C2Adapter",
]
