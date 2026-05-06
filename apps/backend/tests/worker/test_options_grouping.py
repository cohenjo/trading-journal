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


# ---------------------------------------------------------------------------
# Tests for backfill rows — event_type="adjustment", open_close_indicator inferred
# from the CASE logic in _load_strategy_trades SQL (simulated via fake session).
# ---------------------------------------------------------------------------


class FakeSessionBackfill:
    """Fake session returning backfill-style rows (event_type='adjustment', no OCI).

    The SQL fix in _load_strategy_trades rewrites those to open/close/expire/assign
    via a CASE expression. This session simulates rows *as the fixed SQL would return
    them*, which is how the grouper sees them after the patch.
    """

    def __init__(self) -> None:
        self.groups: list[dict[str, Any]] = []
        self.rolls: list[dict[str, Any]] = []
        self.trade_updates: dict[str, str] = {}

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        sql = str(statement)
        params = params or {}
        if "from public.trading_account_config" in sql:
            return FakeMappings(
                [{"id": 1, "household_id": "10000000-0000-0000-0000-000000000001", "account_id": "U2515365"}]
            )
        if "from public.options_trades t" in sql:
            return FakeMappings(_backfill_trade_rows())
        if "insert into public.options_strategy_groups" in sql:
            self.groups.append(params)
        elif "update public.options_trades" in sql:
            self.trade_updates[str(params["trade_id"])] = str(params["group_id"])
        elif "insert into public.options_roll_events" in sql:
            self.rolls.append(params)
        return FakeMappings([])


def _backfill_trade_rows() -> list[dict[str, Any]]:
    """Simulate what the fixed SQL returns for backfill data.

    These rows have been re-classified from 'adjustment' / null OCI by the CASE
    expression in _load_strategy_trades. Realized-PnL != 0 rows become 'close'/'C',
    zero-PnL rows become 'open'/'O', and 'Ep' notes rows become 'expire'/'C'.
    """
    household_id = "10000000-0000-0000-0000-000000000001"

    def row(
        trade_id: str,
        day: date,
        side: str,
        indicator: str,
        event_type: str,
        strike: str,
        expiry: date,
        cash: str,
        pnl: str,
        minute: int = 0,
    ) -> dict[str, Any]:
        return {
            "trade_id": trade_id,
            "household_id": household_id,
            "account_id": "U2515365",
            "trade_time": datetime(day.year, day.month, day.day, 10, minute, tzinfo=timezone.utc),
            "trade_date": day,
            "event_type": event_type,
            "side": side,
            "quantity": Decimal("-1") if side == "sell" else Decimal("1"),
            "net_cash_flow": Decimal(cash),
            "realized_pnl": Decimal(pnl),
            "currency": "USD",
            "open_close_indicator": indicator,
            "underlying_symbol": "MSFT",
            "right": "put",
            "strike": Decimal(strike),
            "expiry": expiry,
            "multiplier": Decimal("100"),
            "assignment_cash_flow": Decimal("0"),
        }

    return [
        # Open: sold short put, PnL=0 → inferred as open/O
        row("sell-open", date(2022, 1, 4), "sell", "O", "open", "315", date(2022, 1, 21), "248", "0"),
        # Close: bought back, PnL != 0 → inferred as close/C
        row("buy-close", date(2022, 1, 14), "buy", "C", "close", "315", date(2022, 1, 21), "-100", "148"),
    ]


def test_backfill_rows_inferred_as_open_close_form_csp_group() -> None:
    """Backfill rows with inferred open/close indicators form a closed CSP group."""

    session = FakeSessionBackfill()
    result = compute_options_strategy_groups(session)  # type: ignore[arg-type]

    assert result["group_count"] == 1
    assert session.groups[0]["kind"] == "csp"
    assert session.groups[0]["status"] == "closed"
    assert set(session.trade_updates) == {"sell-open", "buy-close"}


def test_backfill_expired_trade_sets_group_status_to_expired() -> None:
    """An 'Ep' notes backfill row (inferred as event_type=expire) gives group status 'expired'."""

    household_id = "10000000-0000-0000-0000-000000000001"

    class FakeSessionExpiry(FakeSessionBackfill):
        def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
            sql = str(statement)
            if "from public.trading_account_config" in sql:
                return FakeMappings([{"id": 1, "household_id": household_id, "account_id": "U2515365"}])
            if "from public.options_trades t" in sql:
                return FakeMappings(
                    [
                        {
                            "trade_id": "sell-open",
                            "household_id": household_id,
                            "account_id": "U2515365",
                            "trade_time": datetime(2022, 1, 4, 10, 0, tzinfo=timezone.utc),
                            "trade_date": date(2022, 1, 4),
                            "event_type": "open",
                            "side": "sell",
                            "quantity": Decimal("-1"),
                            "net_cash_flow": Decimal("248"),
                            "realized_pnl": Decimal("0"),
                            "currency": "USD",
                            "open_close_indicator": "O",
                            "underlying_symbol": "MSFT",
                            "right": "put",
                            "strike": Decimal("315"),
                            "expiry": date(2022, 1, 21),
                            "multiplier": Decimal("100"),
                            "assignment_cash_flow": Decimal("0"),
                        },
                        {
                            "trade_id": "expiry-close",
                            "household_id": household_id,
                            "account_id": "U2515365",
                            "trade_time": datetime(2022, 1, 21, 16, 0, tzinfo=timezone.utc),
                            "trade_date": date(2022, 1, 21),
                            "event_type": "expire",  # inferred from notes='Ep'
                            "side": "buy",
                            "quantity": Decimal("1"),
                            "net_cash_flow": Decimal("0"),
                            "realized_pnl": Decimal("248"),
                            "currency": "USD",
                            "open_close_indicator": "C",
                            "underlying_symbol": "MSFT",
                            "right": "put",
                            "strike": Decimal("315"),
                            "expiry": date(2022, 1, 21),
                            "multiplier": Decimal("100"),
                            "assignment_cash_flow": Decimal("0"),
                        },
                    ]
                )
            return super().execute(statement, params)

    session = FakeSessionExpiry()
    result = compute_options_strategy_groups(session)  # type: ignore[arg-type]

    assert result["group_count"] == 1
    assert session.groups[0]["status"] == "expired"
