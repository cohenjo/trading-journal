"""Pure strategy grouping heuristics for options-income trades."""

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
GROUP_NAMESPACE = UUID("f6288d91-31d7-4eaf-94f5-090bda327f8e")


@dataclass(frozen=True, slots=True)
class StrategyTrade(RollCandidateTrade):
    """Trade facts needed for deterministic strategy grouping."""

    household_id: str = ""
    trade_time: datetime | None = None


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
    trade_group_ids: dict[str, str]


def group_option_strategies(trades: list[StrategyTrade]) -> StrategyGroupingResult:
    """Classify trades into deterministic Phase 2 strategy groups."""

    ordered = sorted(trades, key=lambda trade: (trade.trade_date, trade.trade_time or datetime.min, trade.trade_id))
    if not ordered:
        return StrategyGroupingResult(groups=[], roll_events=[], trade_group_ids={})

    by_id = {trade.trade_id: trade for trade in ordered}
    rolls = detect_rolls([_roll_trade(trade) for trade in ordered])
    rolled_open_ids = {opened_trade_id for _, opened_trade_id, _, _ in rolls}
    builders: list[_GroupBuilder] = []
    assigned_open_ids: set[str] = set()

    for first, second in _vertical_open_pairs(ordered):
        trade_ids = tuple(sorted((first.trade_id, second.trade_id)))
        builders.append(_GroupBuilder(anchor_ids=trade_ids, kind="vertical_spread", trade_ids=set(trade_ids)))
        assigned_open_ids.update(trade_ids)

    for trade in ordered:
        if trade.trade_id in assigned_open_ids or trade.trade_id in rolled_open_ids or not _is_open_short_put(trade):
            continue
        builders.append(_GroupBuilder(anchor_ids=(trade.trade_id,), kind="csp", trade_ids={trade.trade_id}))
        assigned_open_ids.add(trade.trade_id)

    _attach_matching_closes(builders, ordered)
    roll_events: list[StrategyRollEvent] = []
    for closed_trade_id, opened_trade_id, realized_pnl_at_close, classification in rolls:
        builder = _find_builder_containing(builders, closed_trade_id)
        if builder is None:
            continue
        builder.kind = "roll_chain"
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
        builders.append(_GroupBuilder(anchor_ids=(trade.trade_id,), kind="ungrouped", trade_ids={trade.trade_id}))
        assigned.add(trade.trade_id)

    groups = [_build_group(builder, by_id) for builder in builders]
    trade_group_ids = {trade_id: group.group_id for group in groups for trade_id in group.trade_ids}
    return StrategyGroupingResult(groups=groups, roll_events=roll_events, trade_group_ids=trade_group_ids)


@dataclass(slots=True)
class _GroupBuilder:
    anchor_ids: tuple[str, ...]
    kind: StrategyKind
    trade_ids: set[str]


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
        net_cash_flow=sum((trade.net_cash_flow for trade in group_trades), Decimal("0")),
        realized_pnl=sum((trade.realized_pnl for trade in group_trades), Decimal("0")),
        metadata={"trade_ids": sorted(builder.trade_ids), "anchor_trade_ids": list(builder.anchor_ids)},
    )


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
