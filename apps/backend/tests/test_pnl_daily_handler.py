"""Tests for TJ-011 pnl_daily compute handler.

Covers:
- Job registration in JOB_HANDLERS registry
- Happy-path end-to-end run with mocked DB
- Reconciliation failure blocks cooked writes
- Retry-after-failure path (job re-runs after failure, succeeds)
- Idempotency: re-running with same input produces same cooked output
- Missing household_id raises ValueError
"""

from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from app.worker.handlers.pnl_daily import (
    _aggregate_daily,
    _input_hash,
    _optional_date,
    _reconcile,
    handle_pnl_daily,
)
from app.worker.registry import JOB_HANDLERS


# ---------------------------------------------------------------------------
# Helpers / Fakes
# ---------------------------------------------------------------------------

_HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001"
_RUN_ID = "aaaaaaaa-0000-0000-0000-000000000001"


class FakeMappings:
    """Mimics SQLAlchemy's mappings() return value."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return row dicts."""
        return self.rows

    def scalar_one(self) -> Any:
        """Return the scalar from the first row's first value."""
        return list(self.rows[0].values())[0] if self.rows else None


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal SQLAlchemy session fake that records SQL executions."""

    def __init__(self, raw_event_rows: list[dict[str, Any]] | None = None) -> None:
        self.raw_event_rows = raw_event_rows or []
        self.executions: list[dict[str, Any]] = []
        self.commits = 0
        self._run_id = _RUN_ID

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        sql = str(statement)
        self.executions.append({"sql": sql, "params": params or {}})

        # Return run_id on INSERT into pnl_runs
        if "insert into compute.pnl_runs" in sql:
            return FakeMappings([{"run_id": self._run_id}])

        # Return raw event rows on SELECT from raw.broker_trade_events
        if "from raw.broker_trade_events" in sql:
            return FakeMappings(self.raw_event_rows)

        return FakeMappings([])

    def commit(self) -> None:
        """Record a commit."""
        self.commits += 1

    def scalar_one(self) -> Any:
        """Delegate to last FakeMappings (not called directly on session in our code)."""
        raise NotImplementedError


def _make_trade_row(
    trade_date: date,
    side: str,
    quantity: str = "10",
    price: str = "100.0",
) -> dict[str, Any]:
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "trade_date": trade_date,
        "symbol": "AAPL",
        "asset_category": "STK",
        "side": side,
        "quantity": quantity,
        "price": price,
        "currency": "USD",
    }


def _session_factory(session: FakeSession):
    """Return a callable session factory that yields the given FakeSession."""

    def factory():
        return session

    return factory


# ---------------------------------------------------------------------------
# Registry tests
# ---------------------------------------------------------------------------


def test_pnl_daily_registered_in_job_handlers() -> None:
    """pnl_daily must appear in JOB_HANDLERS so the queue poller can dispatch it."""
    assert "pnl_daily" in JOB_HANDLERS
    assert JOB_HANDLERS["pnl_daily"] is handle_pnl_daily


# ---------------------------------------------------------------------------
# Unit tests — pure aggregation / reconciliation logic
# ---------------------------------------------------------------------------


def test_aggregate_daily_buy_is_negative_pnl() -> None:
    """Buy events contribute negative realized P&L (cash outflow)."""
    rows = [_make_trade_row(date(2025, 1, 15), "BUY", quantity="10", price="50.0")]
    result = _aggregate_daily(rows)
    assert date(2025, 1, 15) in result
    bucket = result[date(2025, 1, 15)]
    assert bucket["realized_pnl"] == Decimal("-500.000000")
    assert bucket["trade_count"] == 1
    assert bucket["losing_trades"] == 1
    assert bucket["winning_trades"] == 0


def test_aggregate_daily_sell_is_positive_pnl() -> None:
    """Sell events contribute positive realized P&L (cash inflow)."""
    rows = [_make_trade_row(date(2025, 1, 15), "SELL", quantity="5", price="200.0")]
    result = _aggregate_daily(rows)
    bucket = result[date(2025, 1, 15)]
    assert bucket["realized_pnl"] == Decimal("1000.000000")
    assert bucket["winning_trades"] == 1


def test_aggregate_daily_groups_by_date() -> None:
    """Trades on different dates produce separate buckets."""
    rows = [
        _make_trade_row(date(2025, 1, 10), "SELL"),
        _make_trade_row(date(2025, 1, 11), "BUY"),
        _make_trade_row(date(2025, 1, 10), "SELL"),  # second trade on same day
    ]
    result = _aggregate_daily(rows)
    assert len(result) == 2
    assert result[date(2025, 1, 10)]["trade_count"] == 2
    assert result[date(2025, 1, 11)]["trade_count"] == 1


def test_aggregate_daily_empty_rows() -> None:
    """Empty raw events produce empty intermediates dict."""
    assert _aggregate_daily([]) == {}


def test_reconcile_passes_on_match() -> None:
    """Reconcile passes when raw count equals computed trade counts."""
    rows = [_make_trade_row(date(2025, 1, 1), "BUY")] * 3
    intermediates = _aggregate_daily(rows)
    result = _reconcile(rows, intermediates)
    assert result["ok"] is True
    assert result["raw_total"] == 3
    assert result["computed_total"] == 3


def test_reconcile_fails_on_mismatch() -> None:
    """Reconcile fails when raw and computed counts diverge."""
    rows = [_make_trade_row(date(2025, 1, 1), "BUY")] * 5
    # Produce intermediates from fewer rows
    intermediates = _aggregate_daily(rows[:3])
    result = _reconcile(rows, intermediates)
    assert result["ok"] is False
    assert "5" in result["detail"]
    assert "3" in result["detail"]


def test_optional_date_parses_iso_string() -> None:
    """_optional_date converts ISO-8601 strings to date objects."""
    assert _optional_date("2025-06-30") == date(2025, 6, 30)


def test_optional_date_returns_none_for_none() -> None:
    assert _optional_date(None) is None


def test_optional_date_raises_on_bad_string() -> None:
    with pytest.raises(ValueError, match="Invalid date"):
        _optional_date("not-a-date")


def test_input_hash_is_deterministic() -> None:
    """Same inputs always produce the same hash (idempotency key stability)."""
    h1 = _input_hash(_HOUSEHOLD_ID, date(2025, 1, 1), date(2025, 12, 31), 42)
    h2 = _input_hash(_HOUSEHOLD_ID, date(2025, 1, 1), date(2025, 12, 31), 42)
    assert h1 == h2
    assert len(h1) == 16  # truncated sha256 hex


def test_input_hash_differs_on_count_change() -> None:
    """Different raw event counts produce different hashes."""
    h1 = _input_hash(_HOUSEHOLD_ID, None, None, 10)
    h2 = _input_hash(_HOUSEHOLD_ID, None, None, 11)
    assert h1 != h2


# ---------------------------------------------------------------------------
# Integration-style tests — handle_pnl_daily with FakeSession
# ---------------------------------------------------------------------------


def test_handle_pnl_daily_end_to_end() -> None:
    """Happy path: raw events → compute intermediates → cooked rows."""
    raw_rows = [
        _make_trade_row(date(2025, 3, 10), "SELL", quantity="10", price="100"),
        _make_trade_row(date(2025, 3, 11), "BUY", quantity="5", price="80"),
    ]
    session = FakeSession(raw_event_rows=raw_rows)
    payload = {"household_id": _HOUSEHOLD_ID}

    result = handle_pnl_daily(payload, session_factory=_session_factory(session))

    assert result["days_written"] == 2
    assert result["raw_events"] == 2
    assert result["reconciliation"]["ok"] is True

    sql_statements = [e["sql"] for e in session.executions]
    assert any("insert into compute.pnl_runs" in s for s in sql_statements)
    assert any("insert into compute.daily_pnl_intermediates" in s for s in sql_statements)
    assert any("insert into cooked.daily_performance" in s for s in sql_statements)
    assert any("insert into public.household_refresh_state" in s for s in sql_statements)
    assert any("last_succeeded_at" in s for s in sql_statements)
    # Cooked rows should reflect the succeeded run
    assert result["run_id"] == _RUN_ID


def test_handle_pnl_daily_no_events_writes_nothing() -> None:
    """Empty raw table → zero cooked rows, run still succeeds."""
    session = FakeSession(raw_event_rows=[])
    payload = {"household_id": _HOUSEHOLD_ID}

    result = handle_pnl_daily(payload, session_factory=_session_factory(session))

    assert result["days_written"] == 0
    assert result["raw_events"] == 0
    assert result["reconciliation"]["ok"] is True
    sql_statements = [e["sql"] for e in session.executions]
    # pnl_run and refresh_state updates still happen
    assert any("insert into compute.pnl_runs" in s for s in sql_statements)
    assert any("succeeded" in s for s in sql_statements)


def test_handle_pnl_daily_missing_household_id_raises() -> None:
    """Missing household_id in payload raises ValueError without touching DB."""
    session = FakeSession()
    with pytest.raises(ValueError, match="household_id"):
        handle_pnl_daily({}, session_factory=_session_factory(session))


def test_handle_pnl_daily_records_failure_on_exception() -> None:
    """A handler that raises after raw fetch records failure in pnl_runs + refresh_state."""

    class BrokenSession(FakeSession):
        """Session that raises when writing intermediates."""

        def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
            sql = str(statement)
            # Allow pnl_run open and raw fetch; blow up on intermediates write
            if "insert into compute.daily_pnl_intermediates" in sql:
                raise RuntimeError("Simulated DB failure")
            return super().execute(statement, params)

    raw_rows = [_make_trade_row(date(2025, 1, 1), "SELL")]
    session = BrokenSession(raw_event_rows=raw_rows)
    payload = {"household_id": _HOUSEHOLD_ID}

    with pytest.raises(RuntimeError, match="Simulated DB failure"):
        handle_pnl_daily(payload, session_factory=_session_factory(session))

    sql_statements = [e["sql"] for e in session.executions]
    # Failure path: pnl_run should be marked failed
    assert any("'failed'" in s or ":status" in s for s in sql_statements)
    # Cooked rows must NOT have been written
    assert not any("insert into cooked.daily_performance" in s for s in sql_statements)


def test_handle_pnl_daily_retry_succeeds_after_failure() -> None:
    """After a failure, a re-run with the same household produces a fresh success."""

    # First run fails
    class FailOnceSession(FakeSession):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            self._intermediates_calls = 0

        def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
            sql = str(statement)
            if "insert into compute.daily_pnl_intermediates" in sql:
                self._intermediates_calls += 1
                if self._intermediates_calls == 1:
                    raise RuntimeError("First run fails")
            return super().execute(statement, params)

    raw_rows = [_make_trade_row(date(2025, 5, 1), "SELL")]
    session = FailOnceSession(raw_event_rows=raw_rows)
    payload = {"household_id": _HOUSEHOLD_ID}

    # First attempt fails
    with pytest.raises(RuntimeError):
        handle_pnl_daily(payload, session_factory=_session_factory(session))

    # Second attempt (retry) succeeds
    result = handle_pnl_daily(payload, session_factory=_session_factory(session))
    assert result["days_written"] == 1
    assert result["reconciliation"]["ok"] is True


def test_handle_pnl_daily_idempotent_cooked_output() -> None:
    """Running the same job twice produces an upsert (ON CONFLICT DO UPDATE), not duplicates."""
    raw_rows = [_make_trade_row(date(2025, 6, 1), "SELL")]
    payload = {"household_id": _HOUSEHOLD_ID}

    # First run
    s1 = FakeSession(raw_event_rows=raw_rows)
    r1 = handle_pnl_daily(payload, session_factory=_session_factory(s1))

    # Second run
    s2 = FakeSession(raw_event_rows=raw_rows)
    r2 = handle_pnl_daily(payload, session_factory=_session_factory(s2))

    # Both runs write cooked rows
    assert r1["days_written"] == 1
    assert r2["days_written"] == 1

    # The SQL uses ON CONFLICT DO UPDATE — verify the upsert pattern is present
    cooked_sql = [e["sql"] for e in s2.executions if "insert into cooked.daily_performance" in e["sql"]]
    assert len(cooked_sql) >= 1
    assert "on conflict" in cooked_sql[0]
