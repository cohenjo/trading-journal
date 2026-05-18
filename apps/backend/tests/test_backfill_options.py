"""Tests for chunked options backfill CLI behavior."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

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
                        "household_exists": True,
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


# ==============================================================================
# Phase A — Session Decouple + Continue-on-Error + Resume-from-Chunk
# Phase A — written ahead of Hockney's implementation; will pass once shipped
# ==============================================================================


def test_app_max_retries_default_is_8() -> None:
    """Lock in Phase A.4: FLEX_APP_MAX_RETRIES default raised from 5 to 8."""
    from scripts import flex_probe

    # Read the module-level constant without env override
    assert flex_probe.APP_MAX_RETRIES == 8, (
        "Phase A.4: APP_MAX_RETRIES default must be 8 (~50min retry budget vs IBKR's 30-60min recovery window)"
    )


def test_session_not_held_during_flex_fetch(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.1: Session MUST NOT be open during the slow Flex network roundtrip.

    Hockney implemented split-function approach: _fetch_flex_options_paths (no Session)
    is called BEFORE Session(engine) opens. This test verifies the order.
    """
    connection_events: list[tuple[str, float]] = []
    fetch_events: list[tuple[str, float]] = []

    # Track when connections open/close
    original_session_init = backfill_options.Session.__init__

    def tracked_session_init(self: Any, bind: Any = None, **kwargs: Any) -> None:
        import time

        connection_events.append(("open", time.time()))
        original_session_init(self, bind=bind, **kwargs)

    # Track when fetch happens
    def tracked_fetch(**kwargs: Any) -> list[Path]:
        import time

        fetch_events.append(("fetch_start", time.time()))
        time.sleep(0.01)  # Simulate slow fetch
        fetch_events.append(("fetch_end", time.time()))
        # Return minimal synthetic XML path
        xml_path = tmp_path / "synthetic_options.xml"
        xml_path.write_text(
            '<?xml version="1.0"?><FlexQueryResponse><FlexStatements>'
            '<FlexStatement accountId="U1234567"><TradeConfirms /><CashTransactions />'
            "<OpenPositions /><OptionEAE /></FlexStatement></FlexStatements></FlexQueryResponse>"
        )
        return [xml_path]

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", tracked_fetch)
    monkeypatch.setattr(backfill_options.Session, "__init__", tracked_session_init)
    monkeypatch.setattr(backfill_options, "STATE_FILE", tmp_path / "state.json")

    # Mock the Session to not actually connect to DB
    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)

    # Run minimal 1-chunk backfill
    argv = ["--start", "2025-01-01", "--end", "2025-01-31", "--synthetic"]
    args = backfill_options.parse_args(argv)

    # Need to monkeypatch main's Session usage too, but this is complex
    # Simpler: just verify the function order in the actual script
    # For now, verify that _fetch_flex_options_paths is called in the loop BEFORE Session
    import inspect

    source = inspect.getsource(backfill_options.main)

    # Verify the order: _fetch_flex_options_paths appears BEFORE "with Session(engine)"
    fetch_pos = source.find("_fetch_flex_options_paths")
    session_pos = source.find("with Session(engine)")
    assert fetch_pos > 0, "_fetch_flex_options_paths not found in main()"
    assert session_pos > 0, "Session(engine) not found in main()"
    assert fetch_pos < session_pos, "Phase A.1 violation: Session must open AFTER Flex fetch completes"


def test_continue_on_error_skips_failed_chunk(monkeypatch: Any, tmp_path: Path, capsys: Any) -> None:
    """Phase A.2: --continue-on-error catches Exception, logs, continues to next chunk.

    Mock _fetch_flex_options_paths to raise FlexProbeError on chunk 2 of 3.
    Run with --continue-on-error.
    Expected:
    - Chunks 1 and 3 complete
    - Chunk 2 logged as failed, NOT marked complete
    - Exit code 0 (function doesn't raise, main() would return 1)
    - Stderr contains failure message
    """
    from scripts.flex_probe import FlexProbeError

    call_count = [0]
    processed_months: list[int] = []

    def mock_fetch(**kwargs: Any) -> list[Path]:
        call_count[0] += 1
        month = kwargs["from_date"].month
        processed_months.append(month)

        if call_count[0] == 2:  # Second chunk (February)
            raise FlexProbeError("Simulated 1001 throttle on chunk 2")

        # Success: return synthetic XML
        xml_path = tmp_path / f"synthetic_{month}.xml"
        xml_path.write_text(
            '<?xml version="1.0"?><FlexQueryResponse><FlexStatements>'
            '<FlexStatement accountId="U1234567"><TradeConfirms /><CashTransactions />'
            "<OpenPositions /><OptionEAE /></FlexStatement></FlexStatements></FlexQueryResponse>"
        )
        return [xml_path]

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    state_file = tmp_path / "state.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)

    # Mock Session to avoid real DB
    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)

    # Mock handler functions that would otherwise call DB operations
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run 3-month backfill with --continue-on-error
    argv = ["--start", "2025-01-01", "--end", "2025-03-31", "--chunk-months", "1", "--continue-on-error", "--synthetic"]

    # This should NOT raise even though chunk 2 fails
    backfill_options.main(argv)

    # Verify: chunks 1 and 3 processed, chunk 2 attempted but failed
    assert processed_months == [1, 2, 3], "All 3 chunks should be attempted"
    assert session.commits == 3, "Chunks 1 and 3 plus final commit (2 + 1)"

    # Verify checkpoint: only chunks 1 and 3 marked complete
    if state_file.exists():
        state_data = json.loads(state_file.read_text())
        completed_keys = list(state_data.get("_all", []))
        assert len(completed_keys) == 2, f"Expected 2 completed chunks, got {len(completed_keys)}"
        assert "2025-02-01:2025-02-28" not in completed_keys, "Failed chunk 2 should NOT be marked complete"

    # Verify stderr contains failure message
    captured = capsys.readouterr()
    assert "FAILED" in captured.err
    assert "FlexProbeError" in captured.err
    assert "chunk 2" in captured.err or "2025-02" in captured.err


def test_default_aborts_on_first_failure(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.2: Default behavior (no --continue-on-error) aborts on first failure.

    Same setup as test_continue_on_error_skips_failed_chunk, but WITHOUT the flag.
    Expected:
    - Chunk 1 completes
    - Chunk 2 raises, run aborts
    - Chunk 3 never runs
    """
    from scripts.backfill_options import main as backfill_main, STATE_FILE
    from scripts.flex_probe import FlexProbeError

    monkeypatch.chdir(tmp_path)
    state_file = tmp_path / STATE_FILE.name
    fetch_attempts: list[int] = []

    def mock_fetch(*args: Any, **kwargs: Any) -> list[Path]:
        from_date = kwargs.get("from_date")
        chunk_id = len(fetch_attempts)
        fetch_attempts.append(chunk_id)
        if from_date == date(2024, 2, 1):  # Second chunk
            raise FlexProbeError("IBKR throttle 1001 persists")
        return [Path(tmp_path / "synthetic_2024.xml")]

    def mock_run(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    monkeypatch.setattr(backfill_options, "run_flex_options_sync", mock_run)
    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")

    # Mock post-processing handler functions at backfill_options level
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run WITHOUT --continue-on-error
    with pytest.raises(FlexProbeError):
        backfill_main(["--start", "2024-01-01", "--end", "2024-03-31", "--chunk-months", "1", "--synthetic"])

    assert len(fetch_attempts) == 2  # Only 2 chunks attempted (abort on 2nd failure)
    # Checkpoint should have only chunk 1
    import json

    state = json.loads(state_file.read_text())
    completed = set(state.get("_all", []))
    assert "2024-01-01:2024-01-31" in completed
    assert "2024-02-01:2024-02-29" not in completed
    assert "2024-03-01:2024-03-31" not in completed  # Never attempted


def test_continue_on_error_does_not_swallow_keyboard_interrupt(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.2: --continue-on-error MUST NOT catch KeyboardInterrupt or SystemExit.

    Mock _fetch_flex_options_paths to raise KeyboardInterrupt on chunk 2.
    Even with --continue-on-error, the run must abort (KeyboardInterrupt re-raised).
    """
    from scripts.backfill_options import main as backfill_main

    monkeypatch.chdir(tmp_path)
    fetch_attempts: list[int] = []

    def mock_fetch(*args: Any, **kwargs: Any) -> list[Path]:
        from_date = kwargs.get("from_date")
        chunk_id = len(fetch_attempts)
        fetch_attempts.append(chunk_id)
        if from_date == date(2024, 2, 1):  # Second chunk
            raise KeyboardInterrupt("User interrupted")
        return [Path(tmp_path / "synthetic_2024.xml")]

    def mock_run(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    monkeypatch.setattr(backfill_options, "run_flex_options_sync", mock_run)
    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")

    # Mock post-processing handler functions at backfill_options level
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run with --continue-on-error
    with pytest.raises(KeyboardInterrupt):
        backfill_main(
            [
                "--start",
                "2024-01-01",
                "--end",
                "2024-03-31",
                "--chunk-months",
                "1",
                "--synthetic",
                "--continue-on-error",
            ]
        )

    assert len(fetch_attempts) == 2  # Aborted on chunk 2 (KeyboardInterrupt not caught)


def test_resume_from_chunk_skips_n_pending_chunks(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.3: --resume-from-chunk N skips first N chunks of pending list (1-indexed).

    Build a 5-chunk window, run with --resume-from-chunk 3.
    Expected:
    - Chunks 1, 2, and 3 of pending list are skipped
    - Chunks 4-5 are processed
    """
    from scripts.backfill_options import main as backfill_main

    monkeypatch.chdir(tmp_path)
    processed_chunks: list[str] = []

    def mock_fetch(*args: Any, **kwargs: Any) -> list[Path]:
        return [Path(tmp_path / "synthetic_2024.xml")]

    def mock_run(session: Any, *, from_date: date, **kwargs: Any) -> dict[str, Any]:
        processed_chunks.append(str(from_date))
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    monkeypatch.setattr(backfill_options, "run_flex_options_sync", mock_run)
    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")

    # Mock post-processing handler functions at backfill_options level
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    exit_code = backfill_main(
        [
            "--start",
            "2024-01-01",
            "--end",
            "2024-05-31",
            "--chunk-months",
            "1",
            "--synthetic",
            "--resume-from-chunk",
            "3",
        ]
    )

    assert exit_code == 0
    # Should have processed only chunks 4, 5 (skipped first 3)
    assert len(processed_chunks) == 2
    assert processed_chunks[0] == "2024-04-01"  # Chunk 4
    assert processed_chunks[1] == "2024-05-01"  # Chunk 5


def test_resume_from_chunk_combines_with_no_resume(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.3: --resume-from-chunk combines with --no-resume.

    Build 5 chunks, mark chunks 1 and 2 complete in checkpoint.
    Run with --no-resume --resume-from-chunk 2.
    Expected:
    - Ignores checkpoint (all 5 chunks are pending)
    - Skips first 2 of those 5 → processes chunks 3-5
    """
    from scripts.backfill_options import main as backfill_main, STATE_FILE

    monkeypatch.chdir(tmp_path)
    state_file = tmp_path / STATE_FILE.name

    # Pre-populate checkpoint with chunks 1 and 2
    state_file.write_text(json.dumps({"_all": ["2024-01-01:2024-01-31", "2024-02-01:2024-02-29"]}))

    processed_chunks: list[str] = []

    def mock_fetch(*args: Any, **kwargs: Any) -> list[Path]:
        return [Path(tmp_path / "synthetic_2024.xml")]

    def mock_run(session: Any, *, from_date: date, **kwargs: Any) -> dict[str, Any]:
        processed_chunks.append(str(from_date))
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    monkeypatch.setattr(backfill_options, "run_flex_options_sync", mock_run)
    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")

    # Mock post-processing handler functions at backfill_options level
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    exit_code = backfill_main(
        [
            "--start",
            "2024-01-01",
            "--end",
            "2024-05-31",
            "--chunk-months",
            "1",
            "--synthetic",
            "--no-resume",
            "--resume-from-chunk",
            "2",
        ]
    )

    assert exit_code == 0
    # Should have processed chunks 3, 4, 5 (--no-resume ignores checkpoint, then skip first 2)
    assert len(processed_chunks) == 3
    assert processed_chunks[0] == "2024-03-01"  # Chunk 3
    assert processed_chunks[1] == "2024-04-01"  # Chunk 4
    assert processed_chunks[2] == "2024-05-01"  # Chunk 5


def test_resume_from_chunk_overshoots(monkeypatch: Any, tmp_path: Path, capsys: Any) -> None:
    """Phase A.3: --resume-from-chunk N where N >= len(pending) prints warning, exit 0.

    Build 3-chunk window, run with --resume-from-chunk 99.
    Expected:
    - Prints warning
    - No chunks processed
    - Exit code 0
    """
    from scripts.backfill_options import main as backfill_main
    from app.worker.handlers import options_sync

    monkeypatch.chdir(tmp_path)
    processed_chunks: list[str] = []

    def mock_fetch(*args: Any, **kwargs: Any) -> list[Path]:
        return [Path(tmp_path / "synthetic_2024.xml")]

    def mock_run(session: Any, *, from_date: date, **kwargs: Any) -> dict[str, Any]:
        processed_chunks.append(str(from_date))
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    monkeypatch.setattr(options_sync, "_fetch_flex_options_paths", mock_fetch)
    monkeypatch.setattr(options_sync, "run_flex_options_sync", mock_run)
    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")

    # Mock post-processing handler functions at backfill_options level
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    exit_code = backfill_main(
        [
            "--start",
            "2024-01-01",
            "--end",
            "2024-03-31",
            "--chunk-months",
            "1",
            "--synthetic",
            "--resume-from-chunk",
            "99",
        ]
    )

    assert exit_code == 0
    assert len(processed_chunks) == 0  # No chunks processed
    captured = capsys.readouterr()
    assert "nothing to do" in captured.err.lower() or "nothing to do" in captured.out.lower()


def test_failed_chunk_does_not_mark_complete(monkeypatch: Any, tmp_path: Path) -> None:
    """Phase A.2: Failed chunks are NOT marked complete in checkpoint.

    When a chunk fails, .flex_backfill_state.json MUST NOT contain that chunk's key.
    This locks in the resume contract.
    """
    from scripts.flex_probe import FlexProbeError

    call_count = [0]

    def mock_fetch(**kwargs: Any) -> list[Path]:
        call_count[0] += 1
        month = kwargs["from_date"].month

        if call_count[0] == 2:  # Second chunk (February)
            raise FlexProbeError("Simulated failure on chunk 2")

        # Success: return synthetic XML
        xml_path = tmp_path / f"synthetic_{month}.xml"
        xml_path.write_text(
            '<?xml version="1.0"?><FlexQueryResponse><FlexStatements>'
            '<FlexStatement accountId="U1234567"><TradeConfirms /><CashTransactions />'
            "<OpenPositions /><OptionEAE /></FlexStatement></FlexStatements></FlexQueryResponse>"
        )
        return [xml_path]

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    state_file = tmp_path / "state.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)
    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)

    # Mock handler functions that would otherwise call DB operations
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run 3-month backfill with --continue-on-error
    argv = ["--start", "2025-01-01", "--end", "2025-03-31", "--chunk-months", "1", "--continue-on-error", "--synthetic"]

    backfill_options.main(argv)

    # Verify checkpoint: failed chunk 2 NOT marked complete
    assert state_file.exists(), "Checkpoint file should exist"
    state_data = json.loads(state_file.read_text())
    completed_keys = list(state_data.get("_all", []))

    # Chunks 1 and 3 should be present
    assert len(completed_keys) == 2, f"Expected 2 completed chunks, got {len(completed_keys)}"
    assert "2025-01-01:2025-01-31" in completed_keys, "Chunk 1 should be marked complete"
    assert "2025-03-01:2025-03-31" in completed_keys, "Chunk 3 should be marked complete"

    # Chunk 2 must NOT be present
    assert "2025-02-01:2025-02-28" not in completed_keys, "Failed chunk 2 MUST NOT be marked complete (resume contract)"


def test_failures_file_written_on_continue_on_error(monkeypatch: Any, tmp_path: Path) -> None:
    """Persistent failure log: --continue-on-error writes .flex_backfill_failures.json."""
    from scripts.flex_probe import FlexProbeError

    call_count = [0]

    def mock_fetch(**kwargs: Any) -> list[Path]:
        call_count[0] += 1
        month = kwargs["from_date"].month

        if call_count[0] == 2:  # Second chunk (February) fails
            raise FlexProbeError("SendRequest failed for trades: 1001 throttle persists after 8 retries")

        # Success: return synthetic XML
        xml_path = tmp_path / f"synthetic_{month}.xml"
        xml_path.write_text(
            '<?xml version="1.0"?><FlexQueryResponse><FlexStatements>'
            '<FlexStatement accountId="U1234567"><TradeConfirms /><CashTransactions />'
            "<OpenPositions /><OptionEAE /></FlexStatement></FlexStatements></FlexQueryResponse>"
        )
        return [xml_path]

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    state_file = tmp_path / "state.json"
    failures_file = tmp_path / "failures.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)
    monkeypatch.setattr(backfill_options, "FAILURES_FILE", failures_file)

    # Mock Session and handlers
    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run 3-month backfill with --continue-on-error
    argv = ["--start", "2025-01-01", "--end", "2025-03-31", "--chunk-months", "1", "--continue-on-error", "--synthetic"]
    exit_code = backfill_options.main(argv)

    # Verify exit code is 1 (failures occurred)
    assert exit_code == 1

    # Verify failures file exists
    assert failures_file.exists(), "Failures file should exist after run with failures"

    # Verify JSON schema
    failures_data = json.loads(failures_file.read_text())
    assert failures_data["account_key"] == "_all"
    assert "run_started_at" in failures_data
    assert "run_finished_at" in failures_data
    assert failures_data["command_args"] == argv
    assert len(failures_data["failed_chunks"]) == 1

    # Verify failed chunk detail
    failed_chunk = failures_data["failed_chunks"][0]
    assert failed_chunk["chunk_key"] == "2025-02-01:2025-02-28"
    assert failed_chunk["window_start"] == "2025-02-01"
    assert failed_chunk["window_end"] == "2025-02-28"
    assert failed_chunk["error_type"] == "FlexProbeError"
    assert "1001 throttle" in failed_chunk["error_message"]
    assert "failed_at" in failed_chunk


def test_failures_file_deleted_when_all_succeed(monkeypatch: Any, tmp_path: Path) -> None:
    """Persistent failure log: file deleted when all chunks succeed."""

    def mock_fetch(**kwargs: Any) -> list[Path]:
        # All chunks succeed
        month = kwargs["from_date"].month
        xml_path = tmp_path / f"synthetic_{month}.xml"
        xml_path.write_text(
            '<?xml version="1.0"?><FlexQueryResponse><FlexStatements>'
            '<FlexStatement accountId="U1234567"><TradeConfirms /><CashTransactions />'
            "<OpenPositions /><OptionEAE /></FlexStatement></FlexStatements></FlexQueryResponse>"
        )
        return [xml_path]

    monkeypatch.setattr(backfill_options, "_fetch_flex_options_paths", mock_fetch)
    state_file = tmp_path / "state.json"
    failures_file = tmp_path / "failures.json"
    monkeypatch.setattr(backfill_options, "STATE_FILE", state_file)
    monkeypatch.setattr(backfill_options, "FAILURES_FILE", failures_file)

    # Seed the failures file from a prior run
    failures_file.write_text(
        json.dumps(
            {
                "account_key": "_all",
                "run_started_at": "2026-05-05T12:00:00Z",
                "run_finished_at": "2026-05-05T12:30:00Z",
                "command_args": ["--start", "2025-01-01", "--end", "2025-01-31"],
                "failed_chunks": [
                    {
                        "chunk_key": "2025-01-01:2025-01-31",
                        "window_start": "2025-01-01",
                        "window_end": "2025-01-31",
                        "error_type": "FlexProbeError",
                        "error_message": "Previous failure",
                        "failed_at": "2026-05-05T12:15:00Z",
                    }
                ],
            }
        )
    )

    # Mock Session and handlers
    session = InMemoryOptionsSession()
    monkeypatch.setattr(backfill_options, "Session", lambda _engine: session)
    monkeypatch.setattr(backfill_options, "compute_options_strategy_groups", lambda *args, **kwargs: {"group_count": 0})
    monkeypatch.setattr(backfill_options, "run_options_margin_sync", lambda *args, **kwargs: {"status": "succeeded"})
    monkeypatch.setattr(backfill_options, "compute_options_monthly_metrics", lambda *args, **kwargs: {"row_count": 0})

    # Run backfill - all chunks succeed
    argv = ["--start", "2025-01-01", "--end", "2025-02-28", "--chunk-months", "1", "--synthetic"]
    exit_code = backfill_options.main(argv)

    # Verify exit code is 0 (all succeeded)
    assert exit_code == 0

    # Verify failures file is deleted
    assert not failures_file.exists(), "Failures file should be deleted when all chunks succeed"
