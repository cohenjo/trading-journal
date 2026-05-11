"""Executable backend worker runtime."""

from __future__ import annotations

import logging
import os
import pathlib
import signal
import time

from app.worker import analyze_schedules
from app.worker import ndx_daily_sync  # noqa: F401 - imports schedule registration side effect
from app.worker import price_cache as _price_cache  # noqa: F401 - registers scheduled jobs
from app.worker import yahoo_refresh as _yahoo_refresh  # noqa: F401 - registers yahoo price refresh job
from app.worker.job_queue import poll_compute_jobs
from app.worker.registry import JOB_SCHEDULES
from app.worker.retry import with_db_retry
from app.worker.scheduler import get_scheduler, register_cron, register_interval

logger = logging.getLogger(__name__)
DEFAULT_POLL_INTERVAL_SECONDS = 5
_HEARTBEAT_INTERVAL_SECONDS = 30
_HEARTBEAT_FILE = pathlib.Path(os.getenv("WORKER_HEARTBEAT_FILE", "/app/worker_heartbeat"))


def _touch_heartbeat() -> None:
    """Update the heartbeat file modification time so healthchecks can verify liveness."""
    try:
        _HEARTBEAT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _HEARTBEAT_FILE.touch()
    except OSError:
        logger.warning("Failed to update heartbeat file %s", _HEARTBEAT_FILE)


def _safe_poll_compute_jobs() -> int:
    """Poll compute jobs with DB-reconnect retry."""
    return with_db_retry(poll_compute_jobs)()


def _poll_interval_seconds() -> int:
    """Return the queue polling interval in seconds."""

    raw_value = os.getenv("WORKER_POLL_INTERVAL_SECONDS", str(DEFAULT_POLL_INTERVAL_SECONDS))
    try:
        value = int(raw_value)
    except ValueError:
        logger.warning("Invalid WORKER_POLL_INTERVAL_SECONDS=%s; using default", raw_value)
        return DEFAULT_POLL_INTERVAL_SECONDS
    return max(1, value)


def start_worker() -> None:
    """Start the scheduler, register all jobs, and block until interrupted."""

    logging.basicConfig(level=os.getenv("WORKER_LOG_LEVEL", "INFO"))
    scheduler = get_scheduler()

    for schedule in JOB_SCHEDULES:
        if schedule.kind == "cron":
            if not schedule.cron_expr:
                raise ValueError(f"Schedule {schedule.job_id} is missing cron_expr")
            register_cron(schedule.job_id, schedule.cron_expr, schedule.handler)
        elif schedule.kind == "interval":
            if schedule.seconds is None:
                raise ValueError(f"Schedule {schedule.job_id} is missing seconds")
            register_interval(schedule.job_id, schedule.seconds, schedule.handler)
        else:
            raise ValueError(f"Unsupported schedule kind: {schedule.kind}")

    register_interval(
        "compute_jobs_poller",
        _poll_interval_seconds(),
        _safe_poll_compute_jobs,
    )

    analyze_schedules.run_startup_analyze_refreshes()

    scheduler.start()
    logger.info("Worker scheduler started with %d job(s)", len(scheduler.get_jobs()))

    should_stop = False
    last_heartbeat = 0.0

    def _request_shutdown(_signum: int, _frame: object) -> None:
        nonlocal should_stop
        should_stop = True

    signal.signal(signal.SIGTERM, _request_shutdown)
    signal.signal(signal.SIGINT, _request_shutdown)

    try:
        while not should_stop:
            now = time.monotonic()
            if now - last_heartbeat >= _HEARTBEAT_INTERVAL_SECONDS:
                _touch_heartbeat()
                last_heartbeat = now
            time.sleep(1)
    finally:
        scheduler.shutdown(wait=False)
        logger.info("Worker scheduler stopped")


if __name__ == "__main__":
    start_worker()
