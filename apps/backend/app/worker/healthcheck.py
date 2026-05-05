"""CLI healthcheck script for the compute worker container.

Usage (Docker HEALTHCHECK CMD):
    python -m app.worker.healthcheck

Exit codes:
    0 — healthy (heartbeat is fresh and DATABASE_URL is set)
    1 — unhealthy
"""

from __future__ import annotations

import logging
import os
import pathlib
import sys
import time

logger = logging.getLogger(__name__)

_DEFAULT_HEARTBEAT_FILE = "/app/worker_heartbeat"
_DEFAULT_STALE_SECONDS = 120


def _check_heartbeat(
    heartbeat_file: pathlib.Path,
    stale_seconds: int,
) -> str | None:
    """Return an error message string if the heartbeat is absent or stale, else None."""
    if not heartbeat_file.exists():
        return f"Heartbeat file not found: {heartbeat_file}"
    age = time.time() - heartbeat_file.stat().st_mtime
    if age > stale_seconds:
        return f"Heartbeat is {age:.0f}s old (threshold: {stale_seconds}s)"
    return None


def _check_db_url() -> str | None:
    """Return an error message if DATABASE_URL is not set, else None."""
    if not os.getenv("DATABASE_URL"):
        return "DATABASE_URL environment variable is not set"
    return None


def run_healthcheck() -> int:
    """Run all health checks and return 0 (healthy) or 1 (unhealthy)."""
    heartbeat_file = pathlib.Path(os.getenv("WORKER_HEARTBEAT_FILE", _DEFAULT_HEARTBEAT_FILE))
    stale_seconds = int(os.getenv("HEALTHCHECK_STALE_SECONDS", str(_DEFAULT_STALE_SECONDS)))

    errors: list[str] = []

    hb_error = _check_heartbeat(heartbeat_file, stale_seconds)
    if hb_error:
        errors.append(hb_error)

    db_error = _check_db_url()
    if db_error:
        errors.append(db_error)

    if errors:
        for err in errors:
            print(f"UNHEALTHY: {err}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    logging.basicConfig(level="WARNING")
    sys.exit(run_healthcheck())
