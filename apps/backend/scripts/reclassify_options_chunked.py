#!/usr/bin/env python3
"""Chunked reclassification of options strategy groups + roll events.

Same intent as ``reclassify_options.py`` but persists groups in small chunks
with a commit between each chunk.  This avoids long transactions on the
Supabase connection pooler (which kills sessions that hold a single
transaction open for many minutes).

Usage::

    set -a && source .env && set +a
    uv run python scripts/reclassify_options_chunked.py --account U2515365 [--chunk 200]
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date
from typing import Iterable

from sqlmodel import Session

from app.dal.database import engine
from app.services.options.strategy_grouper import (
    StrategyGroupingResult,
    group_option_strategies,
)
from app.worker.handlers.options_grouping import (
    _grouping_accounts,
    _load_strategy_trades,
    _persist_grouping,
)
from app.worker.handlers.options_metrics import compute_options_monthly_metrics

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", help="Restrict to a single IBKR account ID (e.g. U2515365)")
    parser.add_argument("--from", dest="from_date", help="Inclusive start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", help="Inclusive end date (YYYY-MM-DD)")
    parser.add_argument(
        "--chunk",
        type=int,
        default=200,
        help="Number of strategy groups to persist per transaction (default 200)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Run without committing")
    return parser.parse_args()


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _slice_result(result: StrategyGroupingResult, group_ids: set[str]) -> StrategyGroupingResult:
    """Return a sub-result containing only the rows that belong to ``group_ids``."""

    groups = [g for g in result.groups if g.group_id in group_ids]
    capital_history = [h for h in result.capital_history if h.group_id in group_ids]
    trade_group_ids = {t: g for t, g in result.trade_group_ids.items() if g in group_ids}
    roll_events = [r for r in result.roll_events if r.group_id in group_ids]
    return StrategyGroupingResult(
        groups=groups,
        roll_events=roll_events,
        capital_history=capital_history,
        trade_group_ids=trade_group_ids,
    )


def _chunked(seq: Iterable[str], size: int) -> Iterable[list[str]]:
    buf: list[str] = []
    for item in seq:
        buf.append(item)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def main() -> None:
    args = _parse_args()
    from_date = _parse_date(args.from_date)
    to_date = _parse_date(args.to_date)

    logger.info(
        "Chunked reclassify: account=%s from=%s to=%s chunk=%d dry_run=%s",
        args.account or "all",
        from_date or "all",
        to_date or "all",
        args.chunk,
        args.dry_run,
    )

    with Session(engine) as session:
        accounts = _grouping_accounts(session, household_id=None, account_id=args.account)

    total_groups = total_rolls = total_trades = 0

    for account in accounts:
        with Session(engine) as session:
            trades = _load_strategy_trades(session, account.household_id, account.account_id, from_date, to_date)
        logger.info(
            "Account %s — loaded %d trades; running in-memory grouper…",
            account.account_id,
            len(trades),
        )
        result = group_option_strategies(trades)
        logger.info(
            "Account %s — grouper produced %d groups, %d rolls",
            account.account_id,
            len(result.groups),
            len(result.roll_events),
        )

        group_ids_in_order = [g.group_id for g in result.groups]
        chunk_count = 0
        for chunk in _chunked(group_ids_in_order, args.chunk):
            chunk_set = set(chunk)
            chunk_result = _slice_result(result, chunk_set)
            with Session(engine) as session:
                _persist_grouping(session, chunk_result)
                if args.dry_run:
                    session.rollback()
                else:
                    session.commit()
            chunk_count += 1
            logger.info(
                "  chunk %d: persisted %d groups (rolling total: %d/%d)",
                chunk_count,
                len(chunk),
                chunk_count * args.chunk,
                len(result.groups),
            )

        total_groups += len(result.groups)
        total_rolls += len(result.roll_events)
        total_trades += len(result.trade_group_ids)

    logger.info(
        "Grouping done — groups=%d rolls=%d trades=%d",
        total_groups,
        total_rolls,
        total_trades,
    )

    logger.info("Rebuilding monthly dashboard metrics…")
    with Session(engine) as session:
        metrics_result = compute_options_monthly_metrics(
            session,
            account_id=args.account,
            from_date=from_date,
            to_date=to_date,
        )
        if args.dry_run:
            session.rollback()
        else:
            session.commit()
    logger.info("Metrics complete — monthly_rows=%d", metrics_result["row_count"])


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.exception("Reclassification failed: %s", exc)
        sys.exit(1)
