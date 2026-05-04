"""Backfill options-income facts and monthly metrics from IBKR Flex XML."""

from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal
import os
import sys
from typing import Iterable

from sqlmodel import Session

from app.dal.database import engine
from app.worker.handlers.options_grouping import compute_options_strategy_groups
from app.worker.handlers.options_metrics import compute_options_monthly_metrics
from app.worker.handlers.options_sync import run_flex_options_sync

DEFAULT_FROM = date(2025, 1, 1)


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    """Parse backfill CLI flags."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="from_date", type=date.fromisoformat, default=DEFAULT_FROM)
    parser.add_argument("--to", dest="to_date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--account", dest="account_id", help="Broker accountId; defaults to all enabled accounts")
    parser.add_argument("--synthetic", action="store_true", help="Read tmp/flex/synthetic_*.xml instead of live Flex")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    """Run a synchronous Flex options backfill and print reconciliation totals."""

    args = parse_args(argv)
    if args.synthetic:
        os.environ["OPTIONS_FLEX_SOURCE"] = "synthetic"
    print(f"Backfilling options income from {args.from_date} to {args.to_date}")
    with Session(engine) as session:
        sync_result = run_flex_options_sync(
            session,
            from_date=args.from_date,
            to_date=args.to_date,
            account_id=args.account_id,
            synthetic=args.synthetic,
        )
        grouping_result = compute_options_strategy_groups(
            session,
            account_id=args.account_id,
            from_date=args.from_date,
            to_date=args.to_date,
        )
        metrics_result = compute_options_monthly_metrics(
            session,
            account_id=args.account_id,
            from_date=args.from_date,
            to_date=args.to_date,
        )
        session.commit()
    print("Flex sync:", sync_result)
    print("Strategy grouping:", grouping_result)
    print("Monthly metrics:", metrics_result)
    totals = _totals(metrics_result)
    print(
        "Reconciliation summary: "
        f"accounts={totals['account_count']} trades={sync_result.get('trade_count', 0)} "
        f"cash_events={sync_result.get('cash_event_count', 0)} "
        f"cash_flow={totals['cash_flow']} realized_pnl={totals['realized_pnl']} "
        f"variance_gap={totals['variance_gap']}"
    )
    return 0


def _totals(metrics_result: dict[str, object]) -> dict[str, object]:
    accounts = metrics_result.get("accounts")
    if not isinstance(accounts, list):
        return {
            "account_count": 0,
            "cash_flow": Decimal("0"),
            "realized_pnl": Decimal("0"),
            "variance_gap": Decimal("0"),
        }
    cash_flow = Decimal("0")
    realized = Decimal("0")
    variance = Decimal("0")
    for account in accounts:
        if not isinstance(account, dict):
            continue
        cash_flow += Decimal(str(account.get("cash_flow_total", "0")))
        realized += Decimal(str(account.get("realized_pnl_total", "0")))
        variance += Decimal(str(account.get("variance_gap_cumulative", "0")))
    return {"account_count": len(accounts), "cash_flow": cash_flow, "realized_pnl": realized, "variance_gap": variance}


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
