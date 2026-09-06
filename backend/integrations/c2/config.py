"""
C2 Integration Configuration.
Provides configuration parameters for external Command & Control dispatch.
"""

import os
from config import settings


from typing import Optional


class C2Config:
    def __init__(
        self,
        enabled: Optional[bool] = None,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
    ):
        self._override_enabled = enabled
        self._override_endpoint = endpoint
        self._override_api_key = api_key
        self._override_timeout_seconds = timeout_seconds
        self._override_max_retries = max_retries

    @property
    def enabled(self) -> bool:
        if self._override_enabled is not None:
            return self._override_enabled
        return os.getenv("C2_INTEGRATION_ENABLED", str(settings.C2_INTEGRATION_ENABLED)).lower() in ("true", "1", "yes")

    @property
    def endpoint(self) -> str:
        if self._override_endpoint is not None:
            return self._override_endpoint
        return os.getenv("C2_ENDPOINT", settings.C2_ENDPOINT).strip()

    @property
    def api_key(self) -> str:
        if self._override_api_key is not None:
            return self._override_api_key
        return os.getenv("C2_API_KEY", settings.C2_API_KEY).strip()

    @property
    def timeout_seconds(self) -> float:
        if self._override_timeout_seconds is not None:
            return self._override_timeout_seconds
        try:
            return float(os.getenv("C2_TIMEOUT_SECONDS", str(settings.C2_TIMEOUT_SECONDS)))
        except (ValueError, TypeError):
            return 5.0

    @property
    def max_retries(self) -> int:
        if self._override_max_retries is not None:
            return self._override_max_retries
        try:
            return int(os.getenv("C2_MAX_RETRIES", str(settings.C2_MAX_RETRIES)))
        except (ValueError, TypeError):
            return 3


c2_config = C2Config()
