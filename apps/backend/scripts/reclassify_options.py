#!/usr/bin/env python3
"""One-shot reclassification of options strategy groups and roll events.

Re-runs the strategy grouper and monthly metrics worker against all existing
backfill data without re-syncing from IBKR. Use this after the lifecycle
classifier fix to populate correct group statuses and roll-event counts.

Usage::

    # All accounts
    uv run python scripts/reclassify_options.py

    # Single account
    uv run python scripts/reclassify_options.py --account U2515365

    # With date window
    uv run python scripts/reclassify_options.py --from 2022-01-01 --to 2025-12-31
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date

from sqlmodel import Session

from app.dal.database import engine
from app.worker.handlers.options_grouping import compute_options_strategy_groups
from app.worker.handlers.options_metrics import compute_options_monthly_metrics

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Reclassify options strategy groups and roll events.")
    parser.add_argument("--account", help="Restrict to a single IBKR account ID (e.g. U2515365)")
    parser.add_argument("--from", dest="from_date", help="Inclusive start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", help="Inclusive end date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Run without committing changes")
    return parser.parse_args()


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def main() -> None:
    args = _parse_args()
    from_date = _parse_date(args.from_date)
    to_date = _parse_date(args.to_date)

    logger.info(
        "Starting options reclassification: account=%s from=%s to=%s dry_run=%s",
        args.account or "all",
        from_date or "all",
        to_date or "all",
        args.dry_run,
    )

    with Session(engine) as session:
        logger.info("Re-running strategy grouper (groups + roll events)…")
        grouping_result = compute_options_strategy_groups(
            session,
            account_id=args.account,
            from_date=from_date,
            to_date=to_date,
        )
        logger.info(
            "Grouping complete — groups=%d rolls=%d trades=%d",
            grouping_result["group_count"],
            grouping_result["roll_event_count"],
            grouping_result["trade_count"],
        )

        logger.info("Rebuilding monthly dashboard metrics…")
        metrics_result = compute_options_monthly_metrics(
            session,
            account_id=args.account,
            from_date=from_date,
            to_date=to_date,
        )
        logger.info("Metrics complete — monthly_rows=%d", metrics_result["row_count"])

        if args.dry_run:
            logger.info("Dry-run mode — rolling back changes.")
            session.rollback()
        else:
            session.commit()
            logger.info("Changes committed successfully.")

    for account in grouping_result.get("accounts", []):
        logger.info(
            "  account=%s groups=%d rolls=%d trades=%d",
            account["account_id"],
            account["groups"],
            account["roll_events"],
            account["trades"],
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.exception("Reclassification failed: %s", exc)
        sys.exit(1)
