"""Margin utilization edge cases for Phase 4 gauges."""

from __future__ import annotations

from decimal import Decimal

from app.services.options.metrics import margin_utilization_pct


def test_margin_utilization_pct_uses_used_over_available() -> None:
    """Margin utilization is account-wide margin used divided by margin available."""

    assert margin_utilization_pct(Decimal("2500"), Decimal("10000")) == Decimal("25.00")


def test_margin_utilization_pct_returns_none_for_zero_or_missing_denominator() -> None:
    """Unavailable margin snapshots must not render as zero or infinity."""

    assert margin_utilization_pct(Decimal("2500"), Decimal("0")) is None
    assert margin_utilization_pct(None, Decimal("10000")) is None
    assert margin_utilization_pct(Decimal("2500"), None) is None
