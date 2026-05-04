"""Tests for Phase 2 same-day options roll detection."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.services.options.roll_detector import RollCandidateTrade, detect_rolls


def trade(
    trade_id: str,
    *,
    trade_date: date = date(2025, 2, 14),
    side: str,
    indicator: str,
    strike: str,
    expiry: date = date(2025, 3, 21),
    pnl: str = "0",
    quantity: str | None = None,
) -> RollCandidateTrade:
    """Build a minimal roll candidate trade."""

    return RollCandidateTrade(
        trade_id=trade_id,
        account_id="U1234567",
        trade_date=trade_date,
        underlying_symbol="SPY",
        right="put",
        side=side,
        open_close_indicator=indicator,
        event_type="close" if indicator == "C" else "open",
        strike=Decimal(strike),
        expiry=expiry,
        quantity=Decimal(quantity or ("10" if side == "buy" else "-10")),
        realized_pnl=Decimal(pnl),
    )


def test_same_day_roll_jony_losing_leg_reconciles() -> None:
    """Jony's worked-example leg roll is detected and classified negative."""

    rolls = detect_rolls(
        [
            trade("closed", side="buy", indicator="C", strike="550", pnl="-1000"),
            trade("opened", side="sell", indicator="O", strike="535", expiry=date(2025, 4, 18)),
        ]
    )
    assert rolls == [("closed", "opened", Decimal("-1000"), "negative")]


def test_same_day_duplicate_fill_is_not_roll() -> None:
    """Same strike and expiry is a duplicate/close-open pair, not a roll."""

    assert (
        detect_rolls(
            [
                trade("closed", side="buy", indicator="C", strike="550"),
                trade("opened", side="sell", indicator="O", strike="550"),
            ]
        )
        == []
    )


def test_multi_day_reposition_is_not_roll() -> None:
    """Phase 2 uses a strict same-calendar-trading-day window."""

    assert (
        detect_rolls(
            [
                trade("closed", side="buy", indicator="C", strike="550", trade_date=date(2025, 2, 14)),
                trade("opened", side="sell", indicator="O", strike="535", trade_date=date(2025, 2, 15)),
            ]
        )
        == []
    )


def test_multiple_candidates_closest_match_wins_without_double_linking() -> None:
    """The closest combined strike/expiry change wins and each leg links once."""

    rolls = detect_rolls(
        [
            trade("closed", side="buy", indicator="C", strike="550"),
            trade("far", side="sell", indicator="O", strike="500", expiry=date(2025, 6, 20)),
            trade("near", side="sell", indicator="O", strike="545", expiry=date(2025, 3, 28)),
        ]
    )
    assert [(closed_id, opened_id) for closed_id, opened_id, _, _ in rolls] == [("closed", "near")]


def test_threshold_edges() -> None:
    """The neutral threshold is inclusive at exactly ±$25.00."""

    cases = [("25.00", "neutral"), ("25.01", "positive"), ("-25.00", "neutral"), ("-25.01", "negative")]
    for pnl, expected in cases:
        rolls = detect_rolls(
            [
                trade("closed", side="buy", indicator="C", strike="550", pnl=pnl),
                trade("opened", side="sell", indicator="O", strike="535"),
            ]
        )
        assert rolls[0][3] == expected


def test_empty_input_returns_empty_list() -> None:
    """No trades means no roll candidates."""

    assert detect_rolls([]) == []
