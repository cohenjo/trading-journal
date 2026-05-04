"""Monthly options-income metric aggregation using Decimal arithmetic."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pydantic import BaseModel, ConfigDict

ZERO = Decimal("0")
ONE_HUNDRED = Decimal("100")


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


class OptionCapitalHistory(BaseModel):
    """Capital-at-risk amount effective from a timestamp until superseded."""

    model_config = ConfigDict(frozen=True)

    group_id: str
    effective_at: datetime
    capital_at_risk: Decimal | None


class OptionMarginSnapshot(BaseModel):
    """Account-wide margin snapshot used for monthly utilization metrics."""

    model_config = ConfigDict(frozen=True)

    captured_at: datetime
    margin_used: Decimal | None
    margin_available: Decimal | None


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
    avg_capital_at_risk: Decimal | None = None
    return_on_capital_at_risk_pct: Decimal | None = None
    latest_margin_used: Decimal | None = None
    latest_margin_available: Decimal | None = None
    margin_utilization_pct: Decimal | None = None


def compute_monthly_metrics(
    trades: Iterable[OptionMetricTrade],
    rolls: Iterable[OptionMetricRoll] | None = None,
    capital_history: Iterable[OptionCapitalHistory] | None = None,
    margin_snapshots: Iterable[OptionMarginSnapshot] | None = None,
) -> list[MonthlyMetric]:
    """Aggregate trades, rolls, capital risk, and margin snapshots by month."""

    buckets: dict[date, dict[str, Decimal | int]] = defaultdict(
        lambda: {"cash": ZERO, "pnl": ZERO, "count": 0, "positive": 0, "negative": 0, "neutral": 0}
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

    capital_rows = list(capital_history or [])
    margin_rows = sorted(margin_snapshots or [], key=lambda row: row.captured_at)
    for month in _months_from_capital_and_margin(capital_rows, margin_rows):
        buckets.setdefault(month, {"cash": ZERO, "pnl": ZERO, "count": 0, "positive": 0, "negative": 0, "neutral": 0})

    rows: list[MonthlyMetric] = []
    cumulative_cash = ZERO
    cumulative_pnl = ZERO
    for month in sorted(buckets):
        cash = Decimal(buckets[month]["cash"])
        pnl = Decimal(buckets[month]["pnl"])
        positive = int(buckets[month]["positive"])
        negative = int(buckets[month]["negative"])
        neutral = int(buckets[month]["neutral"])
        roll_count = positive + negative + neutral
        cumulative_cash += cash
        cumulative_pnl += pnl
        avg_capital = compute_time_weighted_avg_capital(capital_rows, month, _month_end(month))
        latest_margin = latest_margin_snapshot_for_month(margin_rows, month, _month_end(month))
        margin_used = latest_margin.margin_used if latest_margin else None
        margin_available = latest_margin.margin_available if latest_margin else None
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
                roll_efficiency_pct=(Decimal(positive) / Decimal(roll_count) * ONE_HUNDRED).quantize(Decimal("0.01"))
                if roll_count
                else None,
                avg_capital_at_risk=avg_capital,
                return_on_capital_at_risk_pct=return_on_capital_at_risk_pct(pnl, avg_capital),
                latest_margin_used=margin_used,
                latest_margin_available=margin_available,
                margin_utilization_pct=margin_utilization_pct(margin_used, margin_available),
            )
        )
    return rows


def compute_time_weighted_avg_capital(
    capital_history: Iterable[OptionCapitalHistory], month_start: date, month_end: date
) -> Decimal | None:
    """Compute Σ(CaR × days active in month) / days in month across strategy groups."""

    start_dt = datetime.combine(month_start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(month_end + timedelta(days=1), time.min, tzinfo=timezone.utc)
    days_in_month = Decimal((end_dt - start_dt).days)
    total = ZERO
    by_group: dict[str, list[OptionCapitalHistory]] = defaultdict(list)
    for row in capital_history:
        if row.capital_at_risk is None:
            continue
        by_group[row.group_id].append(row)

    for entries in by_group.values():
        ordered = sorted(entries, key=lambda row: row.effective_at)
        for index, entry in enumerate(ordered):
            period_start = max(_aware(entry.effective_at), start_dt)
            next_effective = _aware(ordered[index + 1].effective_at) if index + 1 < len(ordered) else end_dt
            period_end = min(next_effective, end_dt)
            if period_end <= start_dt or period_start >= end_dt or period_end <= period_start:
                continue
            active_days = Decimal(str((period_end - period_start).total_seconds())) / Decimal("86400")
            total += entry.capital_at_risk * active_days

    if total == ZERO:
        return None
    return (total / days_in_month).quantize(Decimal("0.000001"))


def return_on_capital_at_risk_pct(realized_pnl: Decimal, avg_capital_at_risk: Decimal | None) -> Decimal | None:
    """Return realized P&L divided by average capital at risk as a percentage."""

    if avg_capital_at_risk is None or avg_capital_at_risk == ZERO:
        return None
    return (realized_pnl / avg_capital_at_risk * ONE_HUNDRED).quantize(Decimal("0.0001"))


def margin_utilization_pct(margin_used: Decimal | None, margin_available: Decimal | None) -> Decimal | None:
    """Return account-wide margin used / margin available as a percentage."""

    if margin_used is None or margin_available is None or margin_available == ZERO:
        return None
    return (margin_used / margin_available * ONE_HUNDRED).quantize(Decimal("0.01"))


def latest_margin_snapshot_for_month(
    snapshots: Iterable[OptionMarginSnapshot], month_start: date, month_end: date
) -> OptionMarginSnapshot | None:
    """Return the newest margin snapshot captured inside a month."""

    return next(
        (
            row
            for row in sorted(snapshots, key=lambda item: item.captured_at, reverse=True)
            if month_start <= row.captured_at.date() <= month_end
        ),
        None,
    )


def _months_from_capital_and_margin(
    capital_history: list[OptionCapitalHistory], margin_rows: list[OptionMarginSnapshot]
) -> set[date]:
    months = {date(row.effective_at.year, row.effective_at.month, 1) for row in capital_history}
    months.update(date(row.captured_at.year, row.captured_at.month, 1) for row in margin_rows)
    return months


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _month_end(month_start: date) -> date:
    """Return the inclusive end date for a month start."""

    if month_start.month == 12:
        next_month = date(month_start.year + 1, 1, 1)
    else:
        next_month = date(month_start.year, month_start.month + 1, 1)
    return next_month - timedelta(days=1)
