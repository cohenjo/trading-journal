"""Pure strategy grouping and capital-at-risk heuristics for options-income trades."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid5

from app.services.options.roll_detector import HEURISTIC_VERSION, RollCandidateTrade, detect_rolls

StrategyKind = Literal["csp", "vertical_spread", "roll_chain", "ungrouped"]
StrategyStatus = Literal["open", "closed", "expired", "assigned", "mixed"]
RiskCalculationMethod = Literal["csp_net_premium", "vertical_spread_max_loss", "roll_chain_latest_leg", "ungrouped"]
GROUP_NAMESPACE = UUID("f6288d91-31d7-4eaf-94f5-090bda327f8e")
ZERO = Decimal("0")
DEFAULT_MULTIPLIER = Decimal("100")


@dataclass(frozen=True, slots=True)
class StrategyTrade(RollCandidateTrade):
    """Trade facts needed for deterministic strategy grouping and risk math."""

    household_id: str = ""
    trade_time: datetime | None = None
    multiplier: Decimal = DEFAULT_MULTIPLIER
    assignment_cash_flow: Decimal = ZERO


@dataclass(frozen=True, slots=True)
class StrategyCapitalHistory:
    """Time-varying capital-at-risk value for one strategy group."""

    group_id: str
    effective_at: datetime
    capital_at_risk: Decimal | None
    risk_calculation_method: RiskCalculationMethod


@dataclass(frozen=True, slots=True)
class StrategyGroup:
    """Persistable grouped options strategy summary."""

    group_id: str
    household_id: str
    account_id: str
    underlying_symbol: str
    kind: StrategyKind
    status: StrategyStatus
    trade_ids: tuple[str, ...]
    opened_at: datetime
    closed_at: datetime | None
    net_cash_flow: Decimal
    realized_pnl: Decimal
    capital_at_risk_open: Decimal | None = None
    risk_calculation_method: RiskCalculationMethod = "ungrouped"
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class StrategyRollEvent:
    """Persistable roll linkage attached to a strategy group."""

    group_id: str
    closed_trade_id: str
    opened_trade_id: str
    classification: str
    closed_leg_realized_pnl: Decimal
    incremental_cash_flow: Decimal
    old_expiry: date
    new_expiry: date
    old_strike: Decimal
    new_strike: Decimal
    heuristic_version: str = HEURISTIC_VERSION


@dataclass(frozen=True, slots=True)
class StrategyGroupingResult:
    """Pure grouping output for worker persistence."""

    groups: list[StrategyGroup]
    roll_events: list[StrategyRollEvent]
    capital_history: list[StrategyCapitalHistory]
    trade_group_ids: dict[str, str]


def group_option_strategies(trades: list[StrategyTrade]) -> StrategyGroupingResult:
    """Classify trades into deterministic strategy groups and risk history."""

    ordered = sorted(trades, key=lambda trade: (trade.trade_date, trade.trade_time or datetime.min, trade.trade_id))
    if not ordered:
        return StrategyGroupingResult(groups=[], roll_events=[], capital_history=[], trade_group_ids={})

    by_id = {trade.trade_id: trade for trade in ordered}
    rolls = detect_rolls([_roll_trade(trade) for trade in ordered])
    rolled_open_ids = {opened_trade_id for _, opened_trade_id, _, _ in rolls}
    builders: list[_GroupBuilder] = []
    assigned_open_ids: set[str] = set()

    for first, second in _vertical_open_pairs(ordered):
        trade_ids = tuple(sorted((first.trade_id, second.trade_id)))
        builders.append(
            _GroupBuilder(
                anchor_ids=trade_ids, kind="vertical_spread", base_kind="vertical_spread", trade_ids=set(trade_ids)
            )
        )
        assigned_open_ids.update(trade_ids)

    for trade in ordered:
        if trade.trade_id in assigned_open_ids or trade.trade_id in rolled_open_ids or not _is_open_short_put(trade):
            continue
        builders.append(
            _GroupBuilder(anchor_ids=(trade.trade_id,), kind="csp", base_kind="csp", trade_ids={trade.trade_id})
        )
        assigned_open_ids.add(trade.trade_id)

    _attach_matching_closes(builders, ordered)
    roll_events: list[StrategyRollEvent] = []
    for closed_trade_id, opened_trade_id, realized_pnl_at_close, classification in rolls:
        builder = _find_builder_containing(builders, closed_trade_id)
        if builder is None:
            continue
        builder.kind = "roll_chain"
        builder.roll_open_ids.append(opened_trade_id)
        builder.trade_ids.add(opened_trade_id)
        opened = by_id[opened_trade_id]
        closed = by_id[closed_trade_id]
        roll_events.append(
            StrategyRollEvent(
                group_id=_group_id(builder.anchor_ids),
                closed_trade_id=closed_trade_id,
                opened_trade_id=opened_trade_id,
                classification=classification,
                closed_leg_realized_pnl=realized_pnl_at_close,
                incremental_cash_flow=closed.net_cash_flow + opened.net_cash_flow,
                old_expiry=closed.expiry,
                new_expiry=opened.expiry,
                old_strike=closed.strike,
                new_strike=opened.strike,
            )
        )
    _attach_matching_closes(builders, ordered)

    assigned = {trade_id for builder in builders for trade_id in builder.trade_ids}
    for trade in ordered:
        if trade.trade_id in assigned:
            continue
        builders.append(
            _GroupBuilder(
                anchor_ids=(trade.trade_id,), kind="ungrouped", base_kind="ungrouped", trade_ids={trade.trade_id}
            )
        )
        assigned.add(trade.trade_id)

    groups = [_build_group(builder, by_id) for builder in builders]
    history = [entry for builder in builders for entry in _build_capital_history(builder, by_id)]
    trade_group_ids = {trade_id: group.group_id for group in groups for trade_id in group.trade_ids}
    return StrategyGroupingResult(
        groups=groups, roll_events=roll_events, capital_history=history, trade_group_ids=trade_group_ids
    )


@dataclass(slots=True)
class _GroupBuilder:
    anchor_ids: tuple[str, ...]
    kind: StrategyKind
    base_kind: StrategyKind
    trade_ids: set[str]
    roll_open_ids: list[str] = field(default_factory=list)


def calculate_capital_at_risk(
    kind: StrategyKind,
    trades: list[StrategyTrade],
    *,
    roll_chain: bool = False,
) -> tuple[Decimal | None, RiskCalculationMethod]:
    """Return max-loss capital at risk net of premium received for a strategy."""

    if kind == "ungrouped" or not trades:
        return None, "ungrouped"

    open_trades = [trade for trade in trades if _is_open(trade)]
    if not open_trades:
        return None, "ungrouped"

    method: RiskCalculationMethod = "roll_chain_latest_leg" if roll_chain else "csp_net_premium"
    short_puts = [trade for trade in open_trades if trade.right == "put" and trade.side == "sell"]
    if kind == "csp" or (kind == "roll_chain" and len(open_trades) == 1 and short_puts):
        short = short_puts[-1] if short_puts else open_trades[-1]
        contracts = abs(short.quantity)
        premium_received = _net_credit(open_trades)
        risk = (short.strike * _multiplier(short) * contracts) - premium_received
        return max(risk, ZERO), method if roll_chain else "csp_net_premium"

    if kind == "vertical_spread" or kind == "roll_chain":
        if len(open_trades) < 2:
            return calculate_capital_at_risk("csp", open_trades, roll_chain=roll_chain)
        short_leg = next((trade for trade in open_trades if trade.side == "sell"), open_trades[0])
        long_leg = next(
            (trade for trade in open_trades if trade.trade_id != short_leg.trade_id and trade.side == "buy"),
            open_trades[1],
        )
        width = abs(short_leg.strike - long_leg.strike)
        contracts = min(abs(short_leg.quantity), abs(long_leg.quantity)) or abs(short_leg.quantity)
        premium_received = _net_credit(open_trades)
        risk = (width * _multiplier(short_leg) * contracts) - premium_received
        return max(risk, ZERO), method if roll_chain else "vertical_spread_max_loss"

    return None, "ungrouped"


def _vertical_open_pairs(trades: list[StrategyTrade]) -> list[tuple[StrategyTrade, StrategyTrade]]:
    opens = [trade for trade in trades if _is_open(trade)]
    buckets: dict[tuple[str, str, date, str, str, date], list[StrategyTrade]] = defaultdict(list)
    for trade in opens:
        buckets[
            (trade.household_id, trade.account_id, trade.trade_date, trade.underlying_symbol, trade.right, trade.expiry)
        ].append(trade)

    used: set[str] = set()
    pairs: list[tuple[StrategyTrade, StrategyTrade]] = []
    for bucket in buckets.values():
        sorted_bucket = sorted(bucket, key=lambda trade: (trade.trade_time or datetime.min, trade.trade_id))
        for first in sorted_bucket:
            if first.trade_id in used:
                continue
            candidates = [
                trade
                for trade in sorted_bucket
                if trade.trade_id not in used
                and trade.trade_id != first.trade_id
                and trade.side != first.side
                and trade.strike != first.strike
            ]
            if not candidates:
                continue
            second = min(candidates, key=lambda trade: (abs(trade.strike - first.strike), trade.trade_id))
            used.update({first.trade_id, second.trade_id})
            pairs.append((first, second))
    return pairs


def _attach_matching_closes(builders: list[_GroupBuilder], trades: list[StrategyTrade]) -> None:
    by_id = {trade.trade_id: trade for trade in trades}
    changed = True
    while changed:
        changed = False
        for builder in builders:
            contracts = {_contract_key(by_id[trade_id]) for trade_id in builder.trade_ids if _is_open(by_id[trade_id])}
            for trade in trades:
                if trade.trade_id in builder.trade_ids or not _is_close(trade):
                    continue
                if _contract_key(trade) in contracts:
                    builder.trade_ids.add(trade.trade_id)
                    changed = True


def _build_group(builder: _GroupBuilder, by_id: dict[str, StrategyTrade]) -> StrategyGroup:
    group_trades = [by_id[trade_id] for trade_id in sorted(builder.trade_ids)]
    times = [trade.trade_time or datetime.combine(trade.trade_date, datetime.min.time()) for trade in group_trades]
    close_times = [time for trade, time in zip(group_trades, times, strict=True) if _is_close(trade)]
    initial_trades = [by_id[trade_id] for trade_id in builder.anchor_ids]
    capital_at_risk, method = calculate_capital_at_risk(builder.base_kind, initial_trades)
    if builder.kind == "roll_chain" and method != "ungrouped":
        method = "roll_chain_latest_leg"
    return StrategyGroup(
        group_id=_group_id(builder.anchor_ids),
        household_id=group_trades[0].household_id,
        account_id=group_trades[0].account_id,
        underlying_symbol=group_trades[0].underlying_symbol,
        kind=builder.kind,
        status=_status(group_trades),
        trade_ids=tuple(sorted(builder.trade_ids)),
        opened_at=min(times),
        closed_at=max(close_times)
        if close_times and all(_is_close(trade) or _has_close(trade, group_trades) for trade in group_trades)
        else None,
        net_cash_flow=sum((trade.net_cash_flow + trade.assignment_cash_flow for trade in group_trades), ZERO),
        realized_pnl=sum((trade.realized_pnl for trade in group_trades), ZERO),
        capital_at_risk_open=capital_at_risk,
        risk_calculation_method=method,
        metadata={"trade_ids": sorted(builder.trade_ids), "anchor_trade_ids": list(builder.anchor_ids)},
    )


def _build_capital_history(builder: _GroupBuilder, by_id: dict[str, StrategyTrade]) -> list[StrategyCapitalHistory]:
    group_id = _group_id(builder.anchor_ids)
    anchor_trades = [by_id[trade_id] for trade_id in builder.anchor_ids]
    opened_at = min(
        trade.trade_time or datetime.combine(trade.trade_date, datetime.min.time()) for trade in anchor_trades
    )
    initial_risk, initial_method = calculate_capital_at_risk(builder.base_kind, anchor_trades)
    if builder.kind == "roll_chain" and initial_method != "ungrouped":
        initial_method = "roll_chain_latest_leg"
    entries = [StrategyCapitalHistory(group_id, opened_at, initial_risk, initial_method)]

    group_trades = [by_id[trade_id] for trade_id in builder.trade_ids]
    for opened_id in builder.roll_open_ids:
        opened = by_id[opened_id]
        effective_at = opened.trade_time or datetime.combine(opened.trade_date, datetime.min.time())
        active = _active_open_trades(group_trades, effective_at)
        risk, method = calculate_capital_at_risk("roll_chain", active, roll_chain=True)
        entries.append(StrategyCapitalHistory(group_id, effective_at, risk, method))
    return entries


def _active_open_trades(trades: list[StrategyTrade], as_of: datetime) -> list[StrategyTrade]:
    active: dict[tuple[str, str, str, date, Decimal], StrategyTrade] = {}
    for trade in sorted(
        trades,
        key=lambda item: (
            item.trade_time or datetime.combine(item.trade_date, datetime.min.time()),
            0 if _is_open(item) else 1,
            item.trade_id,
        ),
    ):
        trade_time = trade.trade_time or datetime.combine(trade.trade_date, datetime.min.time())
        if trade_time > as_of:
            continue
        key = _contract_key(trade)
        if _is_open(trade):
            active[key] = trade
        elif _is_close(trade):
            active.pop(key, None)
    return list(active.values())


def _status(trades: list[StrategyTrade]) -> StrategyStatus:
    if any(trade.event_type == "assign" for trade in trades):
        return "assigned"
    if any(trade.event_type == "expire" for trade in trades):
        return "expired"
    opens = [trade for trade in trades if _is_open(trade)]
    if opens and all(_has_close(trade, trades) for trade in opens):
        return "closed"
    return "open"


def _has_close(open_trade: StrategyTrade, trades: list[StrategyTrade]) -> bool:
    return any(_is_close(trade) and _contract_key(trade) == _contract_key(open_trade) for trade in trades)


def _find_builder_containing(builders: list[_GroupBuilder], trade_id: str) -> _GroupBuilder | None:
    return next((builder for builder in builders if trade_id in builder.trade_ids), None)


def _group_id(anchor_ids: tuple[str, ...]) -> str:
    return str(uuid5(GROUP_NAMESPACE, ":".join(sorted(anchor_ids))))


def _contract_key(trade: StrategyTrade) -> tuple[str, str, str, date, Decimal]:
    return (trade.account_id, trade.underlying_symbol, trade.right, trade.expiry, trade.strike)


def _is_open_short_put(trade: StrategyTrade) -> bool:
    return _is_open(trade) and trade.right == "put" and trade.side == "sell"


def _is_open(trade: StrategyTrade) -> bool:
    return (trade.open_close_indicator or "").upper() == "O" or trade.event_type == "open"


def _is_close(trade: StrategyTrade) -> bool:
    return (trade.open_close_indicator or "").upper() == "C" or trade.event_type in {
        "close",
        "expire",
        "assign",
        "exercise",
    }


def _net_credit(trades: list[StrategyTrade]) -> Decimal:
    return sum((trade.net_cash_flow for trade in trades), ZERO)


def _multiplier(trade: StrategyTrade) -> Decimal:
    return trade.multiplier or DEFAULT_MULTIPLIER


def _roll_trade(trade: StrategyTrade) -> RollCandidateTrade:
    return RollCandidateTrade(
        trade_id=trade.trade_id,
        account_id=trade.account_id,
        trade_date=trade.trade_date,
        underlying_symbol=trade.underlying_symbol,
        right=trade.right,
        side=trade.side,
        open_close_indicator=trade.open_close_indicator,
        event_type=trade.event_type,
        strike=trade.strike,
        expiry=trade.expiry,
        quantity=trade.quantity,
        realized_pnl=trade.realized_pnl,
        net_cash_flow=trade.net_cash_flow,
        currency=trade.currency,
    )
