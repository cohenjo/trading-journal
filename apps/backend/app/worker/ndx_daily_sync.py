"""Scheduled NDX daily market data sync."""

from __future__ import annotations

from datetime import datetime
import logging
from zoneinfo import ZoneInfo

from app.utils.ndx_data import sync_ndx_data
from app.worker.registry import JOB_SCHEDULES, JobSchedule
from app.worker.scheduler import _worker_timezone

logger = logging.getLogger(__name__)
NDX_DAILY_SYNC_JOB_ID = "ndx_daily_sync"
NDX_DAILY_SYNC_CRON = "30 23 * * *"


def _trading_day() -> str:
    """Return the US trading date to sync from the worker timezone."""

    return datetime.now(ZoneInfo(_worker_timezone())).date().isoformat()


def sync_ndx_daily_job() -> None:
    """Run the idempotent daily NDX sync and log failures without raising."""

    target_date = _trading_day()
    try:
        result = sync_ndx_data(target_date)
    except Exception:  # noqa: BLE001 - scheduler must keep running if one sync fails
        logger.exception("NDX daily sync failed for %s", target_date)
        return

    if result.get("status") == "skipped":
        logger.info("NDX daily sync skipped: %s", result)
    else:
        logger.info("NDX daily sync completed: %s", result)


if not any(schedule.job_id == NDX_DAILY_SYNC_JOB_ID for schedule in JOB_SCHEDULES):
    JOB_SCHEDULES.append(
        JobSchedule(
            job_id=NDX_DAILY_SYNC_JOB_ID,
            kind="cron",
            cron_expr=NDX_DAILY_SYNC_CRON,
            handler=sync_ndx_daily_job,
        )
    )
