"""Backfill options-income facts and monthly metrics from IBKR Flex XML."""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import os
import sys

from sqlmodel import Session

from app.dal.database import engine
from app.worker.handlers.options_grouping import compute_options_strategy_groups
from app.worker.handlers.options_margin_sync import run_options_margin_sync
from app.worker.handlers.options_metrics import compute_options_monthly_metrics
from app.worker.handlers.options_sync import run_flex_options_sync

DEFAULT_FROM = date(2025, 1, 1)


@dataclass(frozen=True)
class BackfillWindow:
    """Inclusive date window that stays within one calendar year."""

    start: date
    end: date

    @property
    def label(self) -> str:
        """Return the progress label used in CLI logs."""

        return str(self.start.year) if self.start.year == self.end.year else f"{self.start}:{self.end}"


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    """Parse backfill CLI flags."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", dest="start_date", type=date.fromisoformat, help="Inclusive backfill start date")
    parser.add_argument("--end", dest="end_date", type=date.fromisoformat, help="Inclusive backfill end date")
    parser.add_argument(
        "--from",
        dest="from_date",
        type=date.fromisoformat,
        help="Backward-compatible alias for --start",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        type=date.fromisoformat,
        help="Backward-compatible alias for --end",
    )
    parser.add_argument("--year", type=int, help="Backfill one calendar year, e.g. --year 2021")
    parser.add_argument("--account", dest="account_id", help="Broker accountId; defaults to all enabled accounts")
    parser.add_argument("--synthetic", action="store_true", help="Read tmp/flex/synthetic_*.xml instead of live Flex")
    parser.add_argument("--dry-run", action="store_true", help="Run parsing/workers and roll back database writes")
    return parser.parse_args(argv)


def yearly_windows(start: date, end: date) -> list[BackfillWindow]:
    """Split an inclusive date range into calendar-year windows."""

    if start > end:
        raise ValueError("start date must be on or before end date")
    windows: list[BackfillWindow] = []
    year = start.year
    while year <= end.year:
        window_start = max(start, date(year, 1, 1))
        window_end = min(end, date(year, 12, 31))
        windows.append(BackfillWindow(window_start, window_end))
        year += 1
    return windows


def requested_range(args: argparse.Namespace) -> tuple[date, date]:
    """Resolve CLI date flags into one inclusive range."""

    if args.year is not None:
        if args.start_date or args.end_date or args.from_date or args.to_date:
            raise ValueError("--year cannot be combined with --start/--end/--from/--to")
        return date(args.year, 1, 1), date(args.year, 12, 31)
    start = args.start_date or args.from_date or DEFAULT_FROM
    end = args.end_date or args.to_date or date.today()
    if start > end:
        raise ValueError("--start/--from must be on or before --end/--to")
    return start, end


def main(argv: Iterable[str] | None = None) -> int:
    """Run a synchronous Flex options backfill and print reconciliation totals."""

    args = parse_args(argv)
    try:
        start, end = requested_range(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.synthetic:
        os.environ["OPTIONS_FLEX_SOURCE"] = "synthetic"

    windows = yearly_windows(start, end)
    print(
        f"Backfilling options income from {start} to {end} "
        f"in {len(windows)} yearly chunk(s){' (dry run)' if args.dry_run else ''}"
    )
    combined_sync: dict[str, int] = {"trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}
    last_metrics: dict[str, object] = {"accounts": [], "row_count": 0}
    for window in windows:
        with Session(engine) as session:
            sync_result = run_flex_options_sync(
                session,
                from_date=window.start,
                to_date=window.end,
                account_id=args.account_id,
                synthetic=args.synthetic,
            )
            grouping_result = compute_options_strategy_groups(
                session,
                account_id=args.account_id,
                from_date=window.start,
                to_date=window.end,
            )
            margin_result = run_options_margin_sync(session, account_id=args.account_id)
            metrics_result = compute_options_monthly_metrics(
                session,
                account_id=args.account_id,
                from_date=window.start,
                to_date=window.end,
            )
            if args.dry_run:
                session.rollback()
            else:
                session.commit()
        for key in combined_sync:
            combined_sync[key] += int(sync_result.get(key, 0))
        last_metrics = metrics_result
        parsed = (
            int(sync_result.get("trade_count", 0))
            + int(sync_result.get("cash_event_count", 0))
            + int(sync_result.get("position_count", 0))
        )
        print(
            f"[backfill {window.label}] parsed={parsed}, "
            f"upserted_legs={int(sync_result.get('leg_count', 0))}, "
            f"groups={int(grouping_result.get('group_count', 0))}, "
            f"monthly_rows={int(metrics_result.get('row_count', 0))}"
        )
        if margin_result.get("status") != "succeeded":
            print(f"[backfill {window.label}] margin={margin_result}")

    if len(windows) > 1 and not args.dry_run:
        with Session(engine) as session:
            final_grouping = compute_options_strategy_groups(
                session,
                account_id=args.account_id,
                from_date=start,
                to_date=end,
            )
            last_metrics = compute_options_monthly_metrics(
                session,
                account_id=args.account_id,
                from_date=start,
                to_date=end,
            )
            session.commit()
        print(
            f"[backfill final] groups={int(final_grouping.get('group_count', 0))}, "
            f"monthly_rows={int(last_metrics.get('row_count', 0))}"
        )

    totals = _totals(last_metrics)
    print(
        "Reconciliation summary: "
        f"accounts={totals['account_count']} trades={combined_sync['trade_count']} "
        f"cash_events={combined_sync['cash_event_count']} "
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
