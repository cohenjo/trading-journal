"""Scheduled exchange-rates worker registration."""

from app.services.exchange_rates import refresh_exchange_rates
from app.worker.registry import JOB_SCHEDULES, JobSchedule

# Refresh once daily (24 hours)
EXCHANGE_RATES_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60

JOB_SCHEDULES.append(
    JobSchedule(
        job_id="exchange_rates_refresh",
        kind="interval",
        seconds=EXCHANGE_RATES_REFRESH_INTERVAL_SECONDS,
        handler=refresh_exchange_rates,
    )
)
