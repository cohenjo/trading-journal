"""Tests for options monthly dashboard metric formulas."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services.options.metrics import OptionMetricTrade, compute_monthly_metrics


def test_jony_worked_example_variance_gap() -> None:
    """Jony's example persists cumulative cash flow, realized P&L, and gap."""

    rows = compute_monthly_metrics(
        [
            OptionMetricTrade(trade_date=date(2025, 1, 17), net_cash_flow=Decimal("3000"), realized_pnl=Decimal("0")),
            OptionMetricTrade(
                trade_date=date(2025, 2, 14), net_cash_flow=Decimal("200"), realized_pnl=Decimal("-1000")
            ),
            OptionMetricTrade(
                trade_date=date(2025, 3, 21), net_cash_flow=Decimal("-500"), realized_pnl=Decimal("2000")
            ),
        ]
    )
    assert rows[-1].cash_flow_cumulative == Decimal("2700")
    assert rows[-1].realized_pnl_cumulative == Decimal("1000")
    assert rows[-1].variance_gap_cumulative == Decimal("1700")
    assert [row.variance_gap_cumulative for row in rows] == [Decimal("3000"), Decimal("4200"), Decimal("1700")]
