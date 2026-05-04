"""Tests for Phase 2 options strategy grouping heuristics."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.options.strategy_grouper import StrategyTrade, group_option_strategies


def trade(
    trade_id: str,
    *,
    day: date = date(2025, 1, 17),
    minute: int = 0,
    underlying: str = "SPY",
    right: str = "put",
    side: str = "sell",
    indicator: str = "O",
    strike: str = "550",
    expiry: date = date(2025, 3, 21),
    cash: str = "0",
    pnl: str = "0",
    assignment_cash: str = "0",
    quantity: str | None = None,
) -> StrategyTrade:
    """Build a minimal strategy trade."""

    return StrategyTrade(
        trade_id=trade_id,
        household_id="10000000-0000-0000-0000-000000000001",
        account_id="U1234567",
        trade_time=datetime(day.year, day.month, day.day, 10, minute, tzinfo=timezone.utc),
        trade_date=day,
        underlying_symbol=underlying,
        right=right,
        side=side,
        open_close_indicator=indicator,
        event_type="close" if indicator == "C" else "open",
        strike=Decimal(strike),
        expiry=expiry,
        quantity=Decimal(quantity or ("1" if side == "buy" else "-1")),
        realized_pnl=Decimal(pnl),
        net_cash_flow=Decimal(cash),
        assignment_cash_flow=Decimal(assignment_cash),
    )


def test_single_short_put_groups_as_csp() -> None:
    """Standalone short puts are classified as cash-secured puts for v1."""

    result = group_option_strategies([trade("short-put")])
    assert len(result.groups) == 1
    assert result.groups[0].kind == "csp"
    assert result.trade_group_ids["short-put"] == result.groups[0].group_id


def test_two_opposite_same_expiry_puts_group_as_vertical_spread() -> None:
    """Same-day same-expiry opposite-side puts with different strikes form one spread."""

    result = group_option_strategies(
        [trade("short", strike="550", side="sell"), trade("long", strike="545", side="buy", minute=1)]
    )
    assert len(result.groups) == 1
    assert result.groups[0].kind == "vertical_spread"
    assert set(result.groups[0].trade_ids) == {"short", "long"}


def test_vertical_spread_roll_extends_original_group_as_roll_chain() -> None:
    """A same-day close/open roll extends the original spread instead of creating a new group."""

    result = group_option_strategies(
        [
            trade("open-short", strike="550", side="sell", cash="4000"),
            trade("open-long", strike="545", side="buy", minute=1, cash="-1000"),
            trade(
                "close-short", day=date(2025, 2, 14), side="buy", indicator="C", strike="550", cash="-5000", pnl="-1000"
            ),
            trade(
                "open-rolled",
                day=date(2025, 2, 14),
                minute=1,
                side="sell",
                strike="535",
                expiry=date(2025, 4, 18),
                cash="5200",
            ),
        ]
    )
    assert len(result.groups) == 1
    assert result.groups[0].kind == "roll_chain"
    assert set(result.groups[0].trade_ids) == {"open-short", "open-long", "close-short", "open-rolled"}
    assert len(result.roll_events) == 1
    assert result.roll_events[0].classification == "negative"


def test_idempotent_rerun_produces_same_group_ids() -> None:
    """Deterministic UUIDs keep reruns stable."""

    trades = [trade("short", strike="550", side="sell"), trade("long", strike="545", side="buy", minute=1)]
    first = group_option_strategies(trades)
    second = group_option_strategies(list(reversed(trades)))
    assert [group.group_id for group in first.groups] == [group.group_id for group in second.groups]


def test_assignment_synthetic_cash_flow_rolls_into_group_net_cash_flow() -> None:
    """Strategy net cash flow includes synthetic assignment adjustments."""

    result = group_option_strategies(
        [
            trade("open-short-put", cash="200"),
            trade(
                "assignment-close", day=date(2025, 2, 21), indicator="C", side="buy", cash="0", assignment_cash="-2900"
            ),
        ]
    )

    assert result.groups[0].net_cash_flow == Decimal("-2700")
