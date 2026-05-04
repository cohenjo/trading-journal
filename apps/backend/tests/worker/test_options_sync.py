"""Worker tests for synthetic Flex options sync."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.worker.handlers.options_sync import run_flex_options_sync


class FakeScalar:
    """Scalar wrapper for returning generated IDs."""

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


class FakeSession:
    """Small SQL recorder that mimics the worker's SQLModel session usage."""

    def __init__(self) -> None:
        self.legs: dict[tuple[Any, ...], str] = {}
        self.trades: list[Mapping[str, Any]] = []
        self.cash_events: list[Mapping[str, Any]] = []
        self.positions: list[Mapping[str, Any]] = []
        self.sync_states = 0

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeScalar | FakeMappings:
        sql = str(statement)
        params = params or {}
        if "from public.trading_account_config" in sql:
            return FakeMappings(
                [
                    {
                        "id": 1,
                        "household_id": "10000000-0000-0000-0000-000000000001",
                        "account_id": "U1234567",
                        "name": "IBKR Synthetic",
                    }
                ]
            )
        if "insert into public.options_legs" in sql:
            key = (
                params["account_id"],
                params["underlying_symbol"],
                params["expiry"],
                params["strike"],
                params["right"],
            )
            self.legs.setdefault(key, f"leg-{len(self.legs) + 1}")
            return FakeScalar(self.legs[key])
        if "insert into public.options_trades" in sql:
            self.trades.append(params)
        elif "insert into public.options_cash_events" in sql:
            self.cash_events.append(params)
        elif "insert into public.options_positions" in sql:
            self.positions.append(params)
        elif "insert into public.options_flex_sync_state" in sql:
            self.sync_states += 1
        return FakeMappings([])


def test_run_flex_options_sync_ingests_synthetic_source(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The worker parses synthetic XML and writes idempotent upsert statements."""

    monkeypatch.setenv("OPTIONS_FLEX_SOURCE", "synthetic")
    session = FakeSession()
    result = run_flex_options_sync(session)  # type: ignore[arg-type]
    assert result["trade_count"] == 18
    assert result["cash_event_count"] == 2
    assert result["position_count"] == 1
    assert len(session.trades) == 18
    losing_roll = next(row for row in session.trades if row["source_trade_id"] == "T-JONY-003")
    assert losing_roll["realized_pnl"] == "-1000.000000" or str(losing_roll["realized_pnl"]) == "-1000.000000"
    assert len(session.legs) >= 1
    assert session.sync_states == 1
