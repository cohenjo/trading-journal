"""Application-level settings backed by environment variables.

Add new env-var knobs here rather than scattering ``os.getenv`` calls
throughout the codebase.

Usage::

    from app.core.config import settings

    throttle = settings.flex_refresh_throttle_seconds
"""

from __future__ import annotations

from functools import lru_cache

try:
    from pydantic_settings import BaseSettings
except ImportError:  # pragma: no cover — pydantic v1 fallback
    from pydantic import BaseSettings  # type: ignore[no-redef]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ------------------------------------------------------------------
    # Manual Flex refresh throttle
    # ------------------------------------------------------------------
    flex_refresh_throttle_seconds: int = 3600
    """Minimum seconds between manual Flex refreshes per account.

    Measured from ``options_flex_sync_state.last_sync_at``.
    Override via ``FLEX_REFRESH_THROTTLE_SECONDS`` env var.
    Default: 3600 (1 hour).
    """

    model_config = {"env_prefix": "", "case_sensitive": False}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""
    return Settings()


# Module-level singleton for convenient import
settings: Settings = get_settings()
