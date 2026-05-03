"""Scheduled price-cache worker registration."""

from app.services.price_cache import refresh_price_cache
from app.worker.registry import JOB_SCHEDULES, JobSchedule

PRICES_REFRESH_INTERVAL_SECONDS = 60 * 60

JOB_SCHEDULES.append(
    JobSchedule(
        job_id="prices_refresh",
        kind="interval",
        seconds=PRICES_REFRESH_INTERVAL_SECONDS,
        handler=refresh_price_cache,
    )
)
