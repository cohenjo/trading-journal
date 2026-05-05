"""Exponential backoff and DB-reconnect retry utilities for the compute worker."""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

_BACKOFF_BASE_SECONDS = 1.0
_BACKOFF_MAX_SECONDS = 60.0
_DB_RETRY_ATTEMPTS = 5

F = TypeVar("F", bound=Callable)


def backoff_seconds(attempts: int) -> float:
    """Return the delay in seconds before the next retry.

    Uses truncated exponential backoff: delay = base * 2^(attempts-1), capped at max.

    Args:
        attempts: The already-incremented attempt count (1-based, post-failure).

    Returns:
        Delay in seconds (float, >= 0).
    """
    raw = _BACKOFF_BASE_SECONDS * (2 ** (attempts - 1))
    return min(raw, _BACKOFF_MAX_SECONDS)


def backoff_interval_sql(next_attempts: int) -> str:
    """Return a Postgres-compatible interval string for the next retry delay.

    Args:
        next_attempts: The attempt count *after* this failure (1-based).

    Returns:
        A string like "2 seconds" suitable for embedding in a Postgres interval literal.
    """
    seconds = int(math.ceil(backoff_seconds(next_attempts)))
    return f"{seconds} seconds"


def with_db_retry(fn: Callable[[], int]) -> Callable[[], int]:
    """Wrap a zero-argument callable with DB-reconnect retry logic.

    Retries on OSError and common transient database errors up to
    _DB_RETRY_ATTEMPTS times with exponential backoff.

    Args:
        fn: A zero-argument callable to wrap.

    Returns:
        A wrapped callable with retry semantics.
    """

    def _wrapper() -> int:
        last_exc: Exception | None = None
        for attempt in range(1, _DB_RETRY_ATTEMPTS + 1):
            try:
                return fn()
            except (OSError, ConnectionError) as exc:
                last_exc = exc
                delay = backoff_seconds(attempt)
                logger.warning(
                    "DB connection error (attempt %d/%d): %s — retrying in %.1fs",
                    attempt,
                    _DB_RETRY_ATTEMPTS,
                    exc,
                    delay,
                )
                time.sleep(delay)
            except Exception:
                raise
        raise RuntimeError(f"DB connection failed after {_DB_RETRY_ATTEMPTS} attempts") from last_exc

    return _wrapper
