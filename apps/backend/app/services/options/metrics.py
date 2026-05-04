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


class OptionMetricRoll(BaseModel):
    """Minimal dated roll fact required for roll-efficiency metrics."""

    model_config = ConfigDict(frozen=True)

    detected_date: date
    classification: str


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
    roll_count: int = 0
    roll_positive_count: int = 0
    roll_negative_count: int = 0
    roll_neutral_count: int = 0
    roll_efficiency_pct: Decimal | None = None


def compute_monthly_metrics(
    trades: Iterable[OptionMetricTrade], rolls: Iterable[OptionMetricRoll] | None = None
) -> list[MonthlyMetric]:
    """Aggregate trades and rolls by month for cash, P&L, gap, and roll efficiency."""

    buckets: dict[date, dict[str, Decimal | int]] = defaultdict(
        lambda: {"cash": Decimal("0"), "pnl": Decimal("0"), "count": 0, "positive": 0, "negative": 0, "neutral": 0}
    )
    for trade in trades:
        month = date(trade.trade_date.year, trade.trade_date.month, 1)
        buckets[month]["cash"] = Decimal(buckets[month]["cash"]) + trade.net_cash_flow
        buckets[month]["pnl"] = Decimal(buckets[month]["pnl"]) + trade.realized_pnl
        buckets[month]["count"] = int(buckets[month]["count"]) + trade.trade_count

    for roll in rolls or []:
        month = date(roll.detected_date.year, roll.detected_date.month, 1)
        if roll.classification == "positive":
            buckets[month]["positive"] = int(buckets[month]["positive"]) + 1
        elif roll.classification == "negative":
            buckets[month]["negative"] = int(buckets[month]["negative"]) + 1
        elif roll.classification == "neutral":
            buckets[month]["neutral"] = int(buckets[month]["neutral"]) + 1

    rows: list[MonthlyMetric] = []
    cumulative_cash = Decimal("0")
    cumulative_pnl = Decimal("0")
    for month in sorted(buckets):
        cash = Decimal(buckets[month]["cash"])
        pnl = Decimal(buckets[month]["pnl"])
        positive = int(buckets[month]["positive"])
        negative = int(buckets[month]["negative"])
        neutral = int(buckets[month]["neutral"])
        roll_count = positive + negative + neutral
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
                roll_count=roll_count,
                roll_positive_count=positive,
                roll_negative_count=negative,
                roll_neutral_count=neutral,
                roll_efficiency_pct=(Decimal(positive) / Decimal(roll_count) * Decimal("100")).quantize(Decimal("0.01"))
                if roll_count
                else None,
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
