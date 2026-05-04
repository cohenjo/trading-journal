"""Worker tests for options strategy grouping persistence."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from app.worker.handlers.options_grouping import compute_options_strategy_groups


class FakeMappings:
    """Mappings wrapper for fake SELECT statements."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class FakeSession:
    """Small SQL recorder that mimics SQLModel session usage."""

    def __init__(self) -> None:
        self.groups: list[dict[str, Any]] = []
        self.rolls: list[dict[str, Any]] = []
        self.trade_updates: dict[str, str] = {}

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        """Record writes and return deterministic account/trade fixtures."""

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
        if "from public.options_trades t" in sql:
            return FakeMappings(_trade_rows())
        if "insert into public.options_strategy_groups" in sql:
            self.groups.append(params)
        elif "update public.options_trades" in sql:
            self.trade_updates[str(params["trade_id"])] = str(params["group_id"])
        elif "insert into public.options_roll_events" in sql:
            self.rolls.append(params)
        return FakeMappings([])


def test_compute_options_strategy_groups_persists_groups_rolls_and_trade_links() -> None:
    """The grouping worker upserts groups, roll events, and trade FK updates."""

    session = FakeSession()
    result = compute_options_strategy_groups(session)  # type: ignore[arg-type]
    assert result["group_count"] == 1
    assert result["roll_event_count"] == 1
    assert session.groups[0]["kind"] == "roll_chain"
    assert session.rolls[0]["classification"] == "negative"
    assert session.rolls[0]["closed_leg_realized_pnl"] == Decimal("-1000")
    assert set(session.trade_updates) == {
        "open-short",
        "open-long",
        "close-short",
        "open-rolled",
        "close-rolled",
        "close-long",
    }


def _trade_rows() -> list[dict[str, Any]]:
    household_id = "10000000-0000-0000-0000-000000000001"

    def row(
        trade_id: str,
        day: date,
        side: str,
        indicator: str,
        strike: str,
        expiry: date,
        cash: str,
        pnl: str,
        minute: int,
    ) -> dict[str, Any]:
        return {
            "trade_id": trade_id,
            "household_id": household_id,
            "account_id": "U1234567",
            "trade_time": datetime(day.year, day.month, day.day, 10, minute, tzinfo=timezone.utc),
            "trade_date": day,
            "event_type": "close" if indicator == "C" else "open",
            "side": side,
            "quantity": Decimal("10") if side == "buy" else Decimal("-10"),
            "net_cash_flow": Decimal(cash),
            "realized_pnl": Decimal(pnl),
            "currency": "USD",
            "open_close_indicator": indicator,
            "underlying_symbol": "SPY",
            "right": "put",
            "strike": Decimal(strike),
            "expiry": expiry,
            "multiplier": Decimal("100"),
            "assignment_cash_flow": Decimal("0"),
        }

    return [
        row("open-short", date(2025, 1, 17), "sell", "O", "550", date(2025, 3, 21), "4000", "0", 0),
        row("open-long", date(2025, 1, 17), "buy", "O", "545", date(2025, 3, 21), "-1000", "0", 1),
        row("close-short", date(2025, 2, 14), "buy", "C", "550", date(2025, 3, 21), "-5000", "-1000", 0),
        row("open-rolled", date(2025, 2, 14), "sell", "O", "535", date(2025, 4, 18), "5200", "0", 1),
        row("close-rolled", date(2025, 3, 21), "buy", "C", "535", date(2025, 4, 18), "-3200", "2000", 0),
        row("close-long", date(2025, 3, 21), "sell", "C", "545", date(2025, 3, 21), "2700", "0", 1),
    ]
