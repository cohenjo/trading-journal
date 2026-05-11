"""CLI entrypoint for a manual one-shot Yahoo Finance price refresh.

Usage:
    python -m app.worker.yahoo_refresh_cli
    python -m app.worker.yahoo_refresh_cli --run-once

Use this for local testing or ad-hoc refreshes without waiting for the cron schedule.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.getenv("WORKER_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Yahoo Finance one-shot price refresh")
    parser.add_argument(
        "--run-once",
        action="store_true",
        default=True,
        help="Run a single refresh cycle and exit (default behaviour)",
    )
    parser.parse_args()

    from app.worker.yahoo_refresh import refresh_stock_positions

    result = refresh_stock_positions()
    print(f"\nRefresh complete: {result}")

    if result.get("failed", 0) > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
