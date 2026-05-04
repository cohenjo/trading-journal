"""Capital-at-risk examples for Phase 4 options gauges."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.options.strategy_grouper import StrategyTrade, calculate_capital_at_risk, group_option_strategies


def trade(
    trade_id: str, side: str, strike: str, cash: str, quantity: str = "-1", indicator: str = "O"
) -> StrategyTrade:
    """Build a minimal option strategy trade fixture."""

    return StrategyTrade(
        trade_id=trade_id,
        household_id="hh",
        account_id="acct",
        trade_date=date(2025, 1, 2),
        trade_time=datetime(2025, 1, 2, 15, 30, tzinfo=timezone.utc),
        underlying_symbol="SPY",
        right="put",
        side=side,
        open_close_indicator=indicator,
        event_type="open" if indicator == "O" else "close",
        strike=Decimal(strike),
        expiry=date(2025, 2, 21),
        quantity=Decimal(quantity),
        net_cash_flow=Decimal(cash),
        realized_pnl=Decimal("0"),
        currency="USD",
        multiplier=Decimal("100"),
    )


def test_csp_capital_at_risk_is_max_loss_net_of_premium() -> None:
    """A short 50 put collecting $125 has $4,875 at risk."""

    risk, method = calculate_capital_at_risk("csp", [trade("short", "sell", "50", "125")])
    assert risk == Decimal("4875")
    assert method == "csp_net_premium"


def test_vertical_spread_capital_at_risk_caps_at_zero() -> None:
    """A 50/45 put credit spread collecting $150 has $350 at risk."""

    risk, method = calculate_capital_at_risk(
        "vertical_spread",
        [trade("short", "sell", "50", "200"), trade("long", "buy", "45", "-50", quantity="1")],
    )
    assert risk == Decimal("350")
    assert method == "vertical_spread_max_loss"

    zero_risk, _ = calculate_capital_at_risk(
        "vertical_spread",
        [trade("short-rich", "sell", "50", "700"), trade("long-rich", "buy", "45", "-50", quantity="1")],
    )
    assert zero_risk == Decimal("0")


def test_roll_chain_emits_capital_history_for_latest_open_leg() -> None:
    """Rolling a CSP stores initial and replacement risk points."""

    opened = trade("open-short", "sell", "50", "125")
    closed = trade("close-short", "buy", "50", "-250", quantity="1", indicator="C")
    replacement = replace(
        trade("open-roll", "sell", "45", "175"), trade_time=datetime(2025, 1, 2, 15, 31, tzinfo=timezone.utc)
    )
    result = group_option_strategies([opened, closed, replacement])
    assert result.groups[0].kind == "roll_chain"
    assert [entry.capital_at_risk for entry in result.capital_history] == [Decimal("4875"), Decimal("4325")]
