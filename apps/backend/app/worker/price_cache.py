"""Scheduled price-cache worker registration."""

import os

from app.services.price_cache import refresh_price_cache
from app.worker.registry import JOB_SCHEDULES, JobSchedule


def _refresh_interval_seconds() -> int:
    """Read a positive refresh interval, falling back to one day."""
    try:
        return max(1, int(os.getenv("PRICES_REFRESH_INTERVAL_SECONDS", str(24 * 60 * 60))))
    except ValueError:
        return 24 * 60 * 60


PRICES_REFRESH_INTERVAL_SECONDS = _refresh_interval_seconds()

JOB_SCHEDULES.append(
    JobSchedule(
        job_id="prices_refresh",
        kind="interval",
        seconds=PRICES_REFRESH_INTERVAL_SECONDS,
        handler=refresh_price_cache,
    )
)
