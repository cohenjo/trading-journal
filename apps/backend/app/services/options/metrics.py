"""Monthly options-income metric aggregation using Decimal arithmetic."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, timedelta
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


class OptionMetricTrade(BaseModel):
    """Minimal dated fact required for monthly dashboard metrics."""

    model_config = ConfigDict(frozen=True)

    trade_date: date
    net_cash_flow: Decimal
    realized_pnl: Decimal
    trade_count: int = 1


class MonthlyMetric(BaseModel):
    """Persistable monthly options dashboard row."""

    model_config = ConfigDict(frozen=True)

    period_start: date
    period_end: date
    cash_flow_total: Decimal
    realized_pnl_total: Decimal
    cash_flow_cumulative: Decimal
    realized_pnl_cumulative: Decimal
    variance_gap: Decimal
    variance_gap_cumulative: Decimal
    trade_count: int


def compute_monthly_metrics(trades: Iterable[OptionMetricTrade]) -> list[MonthlyMetric]:
    """Aggregate trades by calendar month and persist rolling cash-vs-P&L gap."""

    buckets: dict[date, dict[str, Decimal | int]] = defaultdict(
        lambda: {"cash": Decimal("0"), "pnl": Decimal("0"), "count": 0}
    )
    for trade in trades:
        month = date(trade.trade_date.year, trade.trade_date.month, 1)
        buckets[month]["cash"] = Decimal(buckets[month]["cash"]) + trade.net_cash_flow
        buckets[month]["pnl"] = Decimal(buckets[month]["pnl"]) + trade.realized_pnl
        buckets[month]["count"] = int(buckets[month]["count"]) + trade.trade_count

    rows: list[MonthlyMetric] = []
    cumulative_cash = Decimal("0")
    cumulative_pnl = Decimal("0")
    for month in sorted(buckets):
        cash = Decimal(buckets[month]["cash"])
        pnl = Decimal(buckets[month]["pnl"])
        cumulative_cash += cash
        cumulative_pnl += pnl
        rows.append(
            MonthlyMetric(
                period_start=month,
                period_end=_month_end(month),
                cash_flow_total=cash,
                realized_pnl_total=pnl,
                cash_flow_cumulative=cumulative_cash,
                realized_pnl_cumulative=cumulative_pnl,
                variance_gap=cash - pnl,
                variance_gap_cumulative=cumulative_cash - cumulative_pnl,
                trade_count=int(buckets[month]["count"]),
            )
        )
    return rows


def _month_end(month_start: date) -> date:
    """Return the inclusive end date for a month start."""

    if month_start.month == 12:
        next_month = date(month_start.year + 1, 1, 1)
    else:
        next_month = date(month_start.year, month_start.month + 1, 1)
    return next_month - timedelta(days=1)
