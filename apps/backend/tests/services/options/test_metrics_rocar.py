"""Time-weighted RoCaR examples for Phase 4 monthly metrics."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.options.metrics import OptionCapitalHistory, OptionMetricTrade, compute_monthly_metrics


def test_time_weighted_rocar_for_jony_spread_example() -> None:
    """A $10k spread active for half of January averages $5k of capital at risk."""

    metrics = compute_monthly_metrics(
        [OptionMetricTrade(trade_date=date(2025, 1, 31), net_cash_flow=Decimal("0"), realized_pnl=Decimal("1000"))],
        capital_history=[
            OptionCapitalHistory(
                group_id="spread-1",
                effective_at=datetime(2025, 1, 16, tzinfo=timezone.utc),
                capital_at_risk=Decimal("10000"),
            )
        ],
    )
    assert metrics[0].avg_capital_at_risk == Decimal("5161.290323")
    assert metrics[0].return_on_capital_at_risk_pct == Decimal("19.3750")
