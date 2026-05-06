"""Tests for chunked options backfill CLI behavior."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

from scripts import backfill_options
from app.worker.handlers.options_sync import run_flex_options_sync

HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001"
ACCOUNT_ID = "U1234567"


class FakeScalar:
    """Scalar wrapper for generated IDs."""

    def __init__(self, value: str) -> None:
        self.value = value

    def scalar_one(self) -> str:
        """Return the fake scalar value."""

        return self.value

    def mappings(self) -> list[dict[str, Any]]:
        """Return no mappings for scalar statements."""

        return []


class FakeMappings:
    """Mappings wrapper for fake SELECT statements."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class InMemoryOptionsSession:
    """Small in-memory session that models the worker's upsert semantics."""

    def __init__(self) -> None:
        self.legs: dict[tuple[Any, ...], str] = {}
        self.trades: dict[tuple[Any, ...], dict[str, Any]] = {}
        self.cash_events: dict[tuple[Any, ...], dict[str, Any]] = {}
        self.positions: list[dict[str, Any]] = []
        self.sync_states = 0
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self) -> InMemoryOptionsSession:
        """Return this fake session as a context manager."""

        return self

    def __exit__(self, *_args: object) -> None:
        """No-op context manager exit."""

    def commit(self) -> None:
        """Record a commit."""

        self.commits += 1

    def rollback(self) -> None:
        """Record a rollback."""

        self.rollbacks += 1

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeScalar | FakeMappings:
        """Record writes and return deterministic rows for worker SELECTs."""

        sql = str(statement)
        params = params or {}
        if "from public.trading_account_config" in sql:
            return FakeMappings(
                [
                    {
                        "id": 1,
                        "household_id": HOUSEHOLD_ID,
                        "account_id": ACCOUNT_ID,
                    }
                ]
            )
        if "insert into public.options_legs" in sql:
            key = (
                params["household_id"],
                params["account_id"],
                params["underlying_symbol"],
                params["expiry"],
                params["strike"],
                params["right"],
                params["multiplier"],
                params["currency"],
            )
            self.legs.setdefault(key, f"leg-{len(self.legs) + 1}")
            return FakeScalar(self.legs[key])
        if "insert into public.options_trades" in sql:
            key = (
                params["household_id"],
                "ibkr_flex",
                params["source_trade_id"],
                params["source_transaction_id"],
                params.get("source_exec_id"),
            )
            self.trades[key] = dict(params)
        elif "insert into public.options_cash_events" in sql:
            key = (params["household_id"], "ibkr_flex", params["source_transaction_id"])
            self.cash_events[key] = dict(params)
        elif "delete from public.options_positions" in sql:
            self.positions = [
                row
                for row in self.positions
                if not (
                    row["household_id"] == params["household_id"]
                    and row["account_id"] == params["account_id"]
                    and row["as_of_date"] == params["as_of_date"]
                )
            ]
        elif "insert into public.options_positions" in sql:
            self.positions.append(dict(params))
        elif "insert into public.options_flex_sync_state" in sql:
            self.sync_states += 1
        return FakeMappings([])


def test_yearly_windows_split_2021_to_2024() -> None:
    """The 2021-2024 backfill range is split into four IBKR-safe yearly chunks."""

    windows = backfill_options.yearly_windows(date(2021, 1, 1), date(2024, 12, 31))
    assert [(window.start, window.end) for window in windows] == [
        (date(2021, 1, 1), date(2021, 12, 31)),
        (date(2022, 1, 1), date(2022, 12, 31)),
        (date(2023, 1, 1), date(2023, 12, 31)),
        (date(2024, 1, 1), date(2024, 12, 31)),
    ]


def test_monthly_windows_single_month() -> None:
    """A single-month range produces exactly one window covering the full month."""

    windows = backfill_options.monthly_windows(date(2024, 6, 1), date(2024, 6, 30))
    assert len(windows) == 1
    assert windows[0].start == date(2024, 6, 1)
    assert windows[0].end == date(2024, 6, 30)


def test_monthly_windows_partial_first_month() -> None:
    """A range starting mid-month clips the first window to the start date."""

    windows = backfill_options.monthly_windows(date(2024, 6, 15), date(2024, 8, 31))
    assert windows[0].start == date(2024, 6, 15)
    assert windows[0].end == date(2024, 6, 30)
    assert windows[1].start == date(2024, 7, 1)
    assert windows[-1].end == date(2024, 8, 31)


def test_monthly_windows_quarterly_chunks() -> None:
    """chunk_months=3 produces quarterly windows."""

    windows = backfill_options.monthly_windows(date(2024, 1, 1), date(2024, 12, 31), chunk_months=3)
    assert len(windows) == 4
    assert windows[0] == backfill_options.BackfillWindow(date(2024, 1, 1), date(2024, 3, 31))
    assert windows[3] == backfill_options.BackfillWindow(date(2024, 10, 1), date(2024, 12, 31))


def test_build_windows_chunk_months_12_delegates_to_yearly() -> None:
    """build_windows with chunk_months=12 produces the same output as yearly_windows."""

    monthly = backfill_options.build_windows(date(2021, 1, 1), date(2024, 12, 31), chunk_months=12)
    yearly = backfill_options.yearly_windows(date(2021, 1, 1), date(2024, 12, 31))
    assert monthly == yearly


def test_chunk_key_is_stable() -> None:
    """BackfillWindow.chunk_key is deterministic and unique per window."""

    w = backfill_options.BackfillWindow(date(2024, 6, 1), date(2024, 6, 30))
    assert w.chunk_key == "2024-06-01:2024-06-30"


def test_resume_skips_completed_chunks(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    """A second run skips already-committed chunks recorded in the state file."""

    state_file = tmp_path / "state.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)

    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # First run: processes Jan + Feb (2 months)
    backfill_options.main(["--synthetic", "--start", "2024-01-01", "--end", "2024-02-29", "--account", ACCOUNT_ID])
    assert session.commits == 3  # 2 chunks + 1 final (multi-window)
    first_state = backfill_options.load_completed_chunks(ACCOUNT_ID, state_file)
    assert len(first_state) == 2

    # Second run: both chunks already completed — nothing to commit
    session2 = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session2)
    backfill_options.main(["--synthetic", "--start", "2024-01-01", "--end", "2024-02-29", "--account", ACCOUNT_ID])
    assert session2.commits == 0


def test_no_resume_flag_reprocesses_all_chunks(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    """--no-resume ignores the checkpoint file and reprocesses all chunks."""

    state_file = tmp_path / "state.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)

    # Seed the state file as if Jan was already completed.
    backfill_options.mark_chunk_complete(
        ACCOUNT_ID, backfill_options.BackfillWindow(date(2024, 1, 1), date(2024, 1, 31)), state_file
    )

    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # --no-resume: Jan should be processed again
    backfill_options.main(
        ["--synthetic", "--start", "2024-01-01", "--end", "2024-01-31", "--account", ACCOUNT_ID, "--no-resume"]
    )
    assert session.commits == 1


def test_multiyear_backfill_ingests_one_synthetic_trade_per_year(monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    """Chunked backfill processes each synthetic historical year once and commits each chunk."""

    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(
        backfill_options,
        "compute_options_monthly_metrics",
        lambda *args, **kwargs: {
            "row_count": 1,
            "accounts": [
                {
                    "cash_flow_total": "100",
                    "realized_pnl_total": "0",
                    "variance_gap_cumulative": "100",
                }
            ],
        },
    )
    # Use tmp state file so test is hermetic.
    monkeypatch.setattr(backfill_options, "mark_chunk_complete", lambda *_args, **_kwargs: None)

    exit_code = backfill_options.main(
        # --chunk-months 12 preserves yearly chunking for this test.
        ["--synthetic", "--start", "2021-01-01", "--end", "2024-12-31", "--account", ACCOUNT_ID, "--chunk-months", "12"]
    )

    assert exit_code == 0
    assert session.commits == 5
    trades_by_year: dict[int, int] = {}
    for trade in session.trades.values():
        trade_year = trade["trade_date"].year
        trades_by_year[trade_year] = trades_by_year.get(trade_year, 0) + 1
    assert trades_by_year == {2021: 1, 2022: 1, 2023: 1, 2024: 1}
    assert sum(Decimal(str(row["net_cash_flow"])) for row in session.trades.values()) == Decimal("400.000000")
    output = capsys.readouterr().out
    assert "[backfill 2021] parsed=1" in output
    assert "[backfill 2024] parsed=1" in output


def test_dry_run_rolls_back_each_chunk(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Dry-run mode executes the pipeline but rolls back instead of committing."""

    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # --chunk-months 12 = 1 yearly chunk for --year 2021; rollbacks == 1 expected.
    assert (
        backfill_options.main(
            ["--synthetic", "--year", "2021", "--dry-run", "--account", ACCOUNT_ID, "--chunk-months", "12"]
        )
        == 0
    )
    assert session.commits == 0
    assert session.rollbacks == 1


def test_same_window_backfill_is_idempotent(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Re-running the same synthetic window does not duplicate trades or legs."""

    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")
    session = InMemoryOptionsSession()
    first = run_flex_options_sync(
        session,  # type: ignore[arg-type]
        from_date=date(2021, 1, 1),
        to_date=date(2021, 12, 31),
        account_id=ACCOUNT_ID,
        synthetic=True,
    )
    second = run_flex_options_sync(
        session,  # type: ignore[arg-type]
        from_date=date(2021, 1, 1),
        to_date=date(2021, 12, 31),
        account_id=ACCOUNT_ID,
        synthetic=True,
    )

    assert first["trade_count"] == 1
    assert second["trade_count"] == 1
    assert len(session.trades) == 1
    assert len(session.legs) == 1


def test_assignment_synthetic_cash_events_are_idempotent(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Re-running the same assignment XML upserts one assign_synth cash event."""

    fixture_dir = Path("tmp/test-options-sync-idempotent")
    fixture_dir.mkdir(parents=True, exist_ok=True)
    fixture = fixture_dir / "assignment.xml"
    fixture.write_text(
        """
<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1234567" fromDate="20260101" toDate="20260131">
  <Trades>
    <Trade accountId="U1234567" assetCategory="OPT" currency="USD" symbol="NFLX  260117P00112000" underlyingSymbol="NFLX" tradeID="opt-1" multiplier="100" strike="112" expiry="2026-01-17" dateTime="2026-01-17;120000" putCall="P" quantity="1" tradePrice="0" proceeds="0" netCash="0" fifoPnlRealized="0" />
    <Trade accountId="U1234567" assetCategory="STK" currency="USD" symbol="NFLX" underlyingSymbol="NFLX" tradeID="stk-1" multiplier="1" dateTime="2026-01-17;120000" quantity="100" tradePrice="112" closePrice="83" proceeds="0" netCash="0" mtmPnl="-2900" />
  </Trades>
  <OptionEAE>
    <OptionEAE accountId="U1234567" currency="USD" symbol="NFLX  260117P00112000" underlyingSymbol="NFLX" transactionType="Assignment" tradeID="opt-1" />
  </OptionEAE>
</FlexStatement></FlexStatements></FlexQueryResponse>
"""
    )
    monkeypatch.setattr("app.worker.handlers.options_sync._select_flex_source", lambda **_kwargs: [fixture])
    session = InMemoryOptionsSession()

    first = run_flex_options_sync(session, account_id=ACCOUNT_ID)
    second = run_flex_options_sync(session, account_id=ACCOUNT_ID)

    assert first["cash_event_count"] == 1
    assert second["cash_event_count"] == 1
    assert len(session.cash_events) == 1
    assert next(iter(session.cash_events.values()))["source_transaction_id"] == "assign_synth:stk-1"
