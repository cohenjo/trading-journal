"""APScheduler singleton and registration helpers for worker jobs."""

from collections.abc import Callable
import os

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger


def _worker_timezone() -> str:
    """Return the configured worker timezone."""

    return os.getenv("WORKER_TIMEZONE", "Asia/Jerusalem")


_scheduler: BackgroundScheduler | None = None


def get_scheduler() -> BackgroundScheduler:
    """Return the process-wide APScheduler instance."""

    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler(timezone=_worker_timezone())
    return _scheduler


def register_cron(job_id: str, cron_expr: str, func: Callable[[], None]) -> None:
    """Register or replace a cron-scheduled function.

    Args:
        job_id: Stable id used by APScheduler for replacement and logs.
        cron_expr: Five-field crontab expression in the worker timezone.
        func: Zero-argument callable to execute on schedule.
    """

    trigger = CronTrigger.from_crontab(cron_expr, timezone=_worker_timezone())
    get_scheduler().add_job(func, trigger=trigger, id=job_id, replace_existing=True)


def register_interval(job_id: str, seconds: int, func: Callable[[], None]) -> None:
    """Register or replace a fixed-interval function."""

    if seconds <= 0:
        raise ValueError("Interval seconds must be positive")
    trigger = IntervalTrigger(seconds=seconds, timezone=_worker_timezone())
    get_scheduler().add_job(
        func,
        trigger=trigger,
        id=job_id,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
