"""Pure roll-detection heuristics for options-income trades."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

RollClassification = Literal["positive", "negative", "neutral"]
NEUTRAL_THRESHOLD = Decimal("25.00")
CLOSE_EVENT_TYPES = frozenset({"close", "expire", "assign", "exercise"})
HEURISTIC_VERSION = "phase2_same_day_v1"


@dataclass(frozen=True, slots=True)
class RollCandidateTrade:
    """Minimal option trade facts needed to detect a same-day roll."""

    trade_id: str
    account_id: str
    trade_date: date
    underlying_symbol: str
    right: str
    side: str
    open_close_indicator: str | None
    event_type: str
    strike: Decimal
    expiry: date
    quantity: Decimal
    realized_pnl: Decimal
    net_cash_flow: Decimal = Decimal("0")
    currency: str = "USD"


RollDetection = tuple[str, str, Decimal, RollClassification]


def detect_rolls(trades: list[RollCandidateTrade]) -> list[RollDetection]:
    """Detect same-trading-day rolls as closed/opened/P&L/classification tuples."""

    if not trades:
        return []

    closes = [trade for trade in trades if _is_close_trade(trade)]
    opens = [trade for trade in trades if _is_open_trade(trade)]
    scored: list[tuple[Decimal, str, str, RollCandidateTrade, RollCandidateTrade]] = []
    for closed in closes:
        for opened in opens:
            if not _is_candidate_pair(closed, opened):
                continue
            score = abs(closed.strike - opened.strike) + Decimal(abs((opened.expiry - closed.expiry).days))
            scored.append((score, closed.trade_id, opened.trade_id, closed, opened))

    linked_closes: set[str] = set()
    linked_opens: set[str] = set()
    matches: list[RollDetection] = []
    for _, _, _, closed, opened in sorted(scored, key=lambda item: (item[0], item[1], item[2])):
        if closed.trade_id in linked_closes or opened.trade_id in linked_opens:
            continue
        linked_closes.add(closed.trade_id)
        linked_opens.add(opened.trade_id)
        matches.append((closed.trade_id, opened.trade_id, closed.realized_pnl, classify_roll(closed.realized_pnl)))
    return matches


def classify_roll(realized_pnl_at_close: Decimal) -> RollClassification:
    """Classify roll quality from closed-leg realized P&L with a ±$25 neutral band."""

    if abs(realized_pnl_at_close) <= NEUTRAL_THRESHOLD:
        return "neutral"
    if realized_pnl_at_close > NEUTRAL_THRESHOLD:
        return "positive"
    return "negative"


def _is_candidate_pair(closed: RollCandidateTrade, opened: RollCandidateTrade) -> bool:
    return (
        closed.account_id == opened.account_id
        and closed.trade_date == opened.trade_date
        and closed.underlying_symbol == opened.underlying_symbol
        and closed.currency == opened.currency
        and closed.right == opened.right
        and closed.side != opened.side
        and (closed.strike != opened.strike or closed.expiry != opened.expiry)
        and _quantity_overlap(closed, opened) >= Decimal("0.80")
    )


def _is_close_trade(trade: RollCandidateTrade) -> bool:
    indicator = (trade.open_close_indicator or "").upper()
    return indicator == "C" or trade.event_type in CLOSE_EVENT_TYPES


def _is_open_trade(trade: RollCandidateTrade) -> bool:
    indicator = (trade.open_close_indicator or "").upper()
    return indicator == "O" or trade.event_type == "open"


def _quantity_overlap(closed: RollCandidateTrade, opened: RollCandidateTrade) -> Decimal:
    closed_qty = abs(closed.quantity)
    opened_qty = abs(opened.quantity)
    if closed_qty == 0 or opened_qty == 0:
        return Decimal("0")
    return min(closed_qty, opened_qty) / closed_qty
