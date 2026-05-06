"""Backfill options-income facts and monthly metrics from IBKR Flex XML."""

from __future__ import annotations

import argparse
import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
import json
import os
from pathlib import Path
import sys
import time

from sqlmodel import Session

from app.dal.database import engine
from app.worker.handlers.options_grouping import compute_options_strategy_groups
from app.worker.handlers.options_margin_sync import run_options_margin_sync
from app.worker.handlers.options_metrics import compute_options_monthly_metrics
from app.worker.handlers.options_sync import run_flex_options_sync

DEFAULT_FROM = date(2025, 1, 1)
DEFAULT_CHUNK_MONTHS = 1
DEFAULT_CHUNK_SLEEP_SECONDS = 45
STATE_FILE = Path(".flex_backfill_state.json")


@dataclass(frozen=True)
class BackfillWindow:
    """Inclusive date window used for a single IBKR Flex request."""

    start: date
    end: date

    @property
    def label(self) -> str:
        """Return the progress label used in CLI logs."""

        return str(self.start.year) if self.start.year == self.end.year else f"{self.start}:{self.end}"

    @property
    def chunk_key(self) -> str:
        """Stable string key for checkpoint state."""

        return f"{self.start}:{self.end}"


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
    parser.add_argument(
        "--live",
        action="store_true",
        help="Force live IBKR Flex fetch (sets OPTIONS_FLEX_SOURCE=live; requires IBKR_FLEX_TOKEN)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Run parsing/workers and roll back database writes")
    parser.add_argument(
        "--chunk-months",
        type=int,
        default=DEFAULT_CHUNK_MONTHS,
        metavar="N",
        help=f"Split range into N-month windows per IBKR request (default: {DEFAULT_CHUNK_MONTHS}). "
        "Use 1 for monthly (safest for large accounts), 3 for quarterly, 12 for yearly.",
    )
    parser.add_argument(
        "--chunk-sleep",
        type=int,
        default=DEFAULT_CHUNK_SLEEP_SECONDS,
        metavar="SECONDS",
        help=f"Seconds to sleep between IBKR Flex requests (default: {DEFAULT_CHUNK_SLEEP_SECONDS}). "
        "Prevents consecutive 1001 throttle errors.",
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=10,
        metavar="SECONDS",
        help="Seconds between GetStatement polls while IBKR generates the statement (default: 10).",
    )
    parser.add_argument(
        "--max-polls",
        type=int,
        default=60,
        metavar="N",
        help="Maximum GetStatement polls before giving up on a chunk (default: 60 → 10 min timeout).",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help=f"Ignore existing checkpoint file ({STATE_FILE}) and re-process all chunks.",
    )
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


def monthly_windows(start: date, end: date, chunk_months: int = 1) -> list[BackfillWindow]:
    """Split an inclusive date range into N-month windows.

    Each window spans at most ``chunk_months`` calendar months.  The final
    window is clipped to ``end``.  Use ``chunk_months=1`` (the default) for
    the safest IBKR FLEX window size — single-month requests rarely time out
    even on trade-heavy accounts.
    """

    if start > end:
        raise ValueError("start date must be on or before end date")
    if chunk_months < 1:
        raise ValueError("chunk_months must be >= 1")
    windows: list[BackfillWindow] = []
    current = start
    while current <= end:
        # Compute the last month of this chunk (0-indexed from January = 0).
        target_month_0 = (current.month - 1) + (chunk_months - 1)
        chunk_year = current.year + target_month_0 // 12
        chunk_month = (target_month_0 % 12) + 1
        _, last_day = calendar.monthrange(chunk_year, chunk_month)
        chunk_end = min(end, date(chunk_year, chunk_month, last_day))
        windows.append(BackfillWindow(current, chunk_end))
        next_start = chunk_end + timedelta(days=1)
        if next_start > end:
            break
        current = next_start
    return windows


def build_windows(start: date, end: date, chunk_months: int) -> list[BackfillWindow]:
    """Return the appropriate window list for the given chunk size."""

    if chunk_months >= 12:
        return yearly_windows(start, end)
    return monthly_windows(start, end, chunk_months)


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


def load_completed_chunks(account_key: str, state_file: Path) -> set[str]:
    """Return chunk keys already committed in a previous run."""

    if not state_file.exists():
        return set()
    try:
        data: dict[str, list[str]] = json.loads(state_file.read_text())
        return set(data.get(account_key, []))
    except (json.JSONDecodeError, OSError):
        return set()


def mark_chunk_complete(account_key: str, window: BackfillWindow, state_file: Path) -> None:
    """Persist a successfully committed chunk to the checkpoint file."""

    try:
        data: dict[str, list[str]] = json.loads(state_file.read_text()) if state_file.exists() else {}
    except (json.JSONDecodeError, OSError):
        data = {}
    chunks = data.setdefault(account_key, [])
    key = window.chunk_key
    if key not in chunks:
        chunks.append(key)
    state_file.write_text(json.dumps(data, indent=2))


def main(argv: Iterable[str] | None = None) -> int:
    """Run a synchronous Flex options backfill and print reconciliation totals."""

    args = parse_args(argv)
    try:
        start, end = requested_range(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.synthetic and args.live:
        print("error: --synthetic and --live are mutually exclusive", file=sys.stderr)
        return 2
    if args.synthetic:
        os.environ["OPTIONS_FLEX_SOURCE"] = "synthetic"
    elif args.live:
        os.environ["OPTIONS_FLEX_SOURCE"] = "live"

    source_label = os.getenv("OPTIONS_FLEX_SOURCE")
    if not source_label:
        source_label = "live (auto: IBKR_FLEX_TOKEN set)" if os.getenv("IBKR_FLEX_TOKEN") else "synthetic (no token)"

    chunk_months: int = args.chunk_months
    windows = build_windows(start, end, chunk_months)
    account_key = args.account_id or "_all"
    completed: set[str] = set()
    if not args.no_resume and not args.dry_run:
        completed = load_completed_chunks(account_key, STATE_FILE)
        if completed:
            print(
                f"[resume] found {len(completed)} previously completed chunk(s) in {STATE_FILE}; "
                "skipping them. Pass --no-resume to reprocess.",
            )

    pending = [w for w in windows if w.chunk_key not in completed]
    skipped = len(windows) - len(pending)
    print(
        f"Backfilling options income from {start} to {end} "
        f"in {len(pending)} of {len(windows)} chunk(s) "
        f"(chunk_months={chunk_months}, skipped={skipped}) "
        f"[source={source_label}]"
        f"{' (dry run)' if args.dry_run else ''}"
    )
    combined_sync: dict[str, int] = {"trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}
    last_metrics: dict[str, object] = {"accounts": [], "row_count": 0}
    for idx, window in enumerate(pending):
        with Session(engine) as session:
            sync_result = run_flex_options_sync(
                session,
                from_date=window.start,
                to_date=window.end,
                account_id=args.account_id,
                synthetic=args.synthetic,
                poll_seconds=args.poll_seconds,
                max_polls=args.max_polls,
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
                mark_chunk_complete(account_key, window, STATE_FILE)
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
        # Sleep between live IBKR requests to avoid consecutive 1001 throttles.
        if not args.synthetic and idx < len(pending) - 1:
            sleep_secs = args.chunk_sleep
            print(f"[backfill] sleeping {sleep_secs}s before next chunk...", file=sys.stderr)
            time.sleep(sleep_secs)

    all_windows = windows
    if len(all_windows) > 1 and pending and not args.dry_run:
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
