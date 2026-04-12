"""
Extended edge-case and Decimal precision tests for options analytics.

Complements the basic tests in test_analysis.py with:
  - IV percentile/rank boundary conditions
  - CSP breakeven Decimal rounding verification
  - Greeks formatter edge cases
"""

import pytest
from decimal import Decimal

from app.services.analysis.options_analytics import (
    calculate_iv_percentile,
    calculate_iv_rank,
    calculate_csp_breakeven,
    format_greeks,
    _r2,
)


# ===================================================================
# Decimal Rounding Helper
# ===================================================================

class TestDecimalRounding:
    def test_r2_rounds_half_up(self):
        assert _r2(Decimal("1.005")) == 1.01
        assert _r2(Decimal("1.004")) == 1.00
        assert _r2(Decimal("2.555")) == 2.56

    def test_r2_negative_values(self):
        assert _r2(Decimal("-1.005")) == -1.01  # ROUND_HALF_UP rounds away from zero
        assert _r2(Decimal("-1.006")) == -1.01

    def test_r2_zero(self):
        assert _r2(Decimal("0")) == 0.0

    def test_r2_large_value(self):
        assert _r2(Decimal("999999.999")) == 1000000.0


# ===================================================================
# IV Percentile Edge Cases
# ===================================================================

class TestIVPercentileEdgeCases:
    def test_empty_history_returns_none(self):
        assert calculate_iv_percentile(30.0, []) is None

    def test_single_value_below(self):
        """Current IV above the only history value: 100% below."""
        result = calculate_iv_percentile(50.0, [30.0])
        assert result == 100.0

    def test_single_value_above(self):
        """Current IV below the only history value: 0% below."""
        result = calculate_iv_percentile(20.0, [30.0])
        assert result == 0.0

    def test_single_value_equal(self):
        """Current IV equals the only history value: 0% strictly below."""
        result = calculate_iv_percentile(30.0, [30.0])
        assert result == 0.0

    def test_all_below(self):
        result = calculate_iv_percentile(100.0, [10.0, 20.0, 30.0, 40.0, 50.0])
        assert result == 100.0

    def test_all_above(self):
        result = calculate_iv_percentile(5.0, [10.0, 20.0, 30.0])
        assert result == 0.0

    def test_known_percentile(self):
        history = [10.0, 20.0, 30.0, 40.0, 50.0]
        result = calculate_iv_percentile(35.0, history)
        # 3 values below 35: 60%
        assert result == 60.0


# ===================================================================
# IV Rank Edge Cases
# ===================================================================

class TestIVRankEdgeCases:
    def test_empty_history_returns_none(self):
        assert calculate_iv_rank(30.0, []) is None

    def test_single_value_returns_none(self):
        """Range is zero when there's only one value."""
        assert calculate_iv_rank(30.0, [30.0]) is None

    def test_all_same_values_returns_none(self):
        assert calculate_iv_rank(30.0, [30.0, 30.0, 30.0]) is None

    def test_current_at_low(self):
        result = calculate_iv_rank(10.0, [10.0, 20.0, 30.0])
        assert result == 0.0

    def test_current_at_high(self):
        result = calculate_iv_rank(30.0, [10.0, 20.0, 30.0])
        assert result == 100.0

    def test_current_at_midpoint(self):
        result = calculate_iv_rank(20.0, [10.0, 20.0, 30.0])
        assert result == 50.0

    def test_current_above_range(self):
        """IV above historical max gives rank > 100."""
        result = calculate_iv_rank(40.0, [10.0, 20.0, 30.0])
        assert result == 150.0

    def test_current_below_range(self):
        """IV below historical min gives negative rank."""
        result = calculate_iv_rank(5.0, [10.0, 20.0, 30.0])
        assert result == -25.0


# ===================================================================
# CSP Breakeven — Decimal Precision
# ===================================================================

class TestCSPBreakevenPrecision:
    def test_basic_csp(self):
        result = calculate_csp_breakeven(strike_price=50.0, premium=2.50)
        assert result.breakeven_price == 47.50
        assert result.max_loss == 4750.0  # 47.50 * 1 * 100
        assert result.return_on_capital_pct == 5.0  # 2.50/50 * 100

    def test_multiple_contracts(self):
        result = calculate_csp_breakeven(strike_price=100.0, premium=5.0, contracts=10)
        assert result.breakeven_price == 95.0
        assert result.max_loss == 95000.0  # 95 * 10 * 100

    def test_custom_multiplier(self):
        result = calculate_csp_breakeven(strike_price=100.0, premium=5.0, multiplier=50)
        assert result.breakeven_price == 95.0
        assert result.max_loss == 4750.0  # 95 * 1 * 50

    def test_zero_strike_roc_is_zero(self):
        """Division by zero for ROC when strike is 0."""
        result = calculate_csp_breakeven(strike_price=0.0, premium=2.0)
        assert result.return_on_capital_pct == 0.0
        assert result.breakeven_price == -2.0

    def test_fractional_premium_rounding(self):
        """Verify Decimal rounding with non-trivial fractions."""
        result = calculate_csp_breakeven(strike_price=45.50, premium=1.35)
        # breakeven = 45.50 - 1.35 = 44.15
        assert result.breakeven_price == 44.15
        # max_loss = 44.15 * 1 * 100 = 4415.0
        assert result.max_loss == 4415.0
        # roc = 1.35/45.50 * 100 = 2.967... → rounds to 2.97
        assert result.return_on_capital_pct == pytest.approx(2.97, abs=0.01)

    def test_very_small_premium(self):
        result = calculate_csp_breakeven(strike_price=200.0, premium=0.01)
        assert result.breakeven_price == 199.99
        assert result.return_on_capital_pct == pytest.approx(0.01, abs=0.005)

    def test_premium_equals_strike(self):
        """Premium covers full strike: breakeven = 0, max_loss = 0."""
        result = calculate_csp_breakeven(strike_price=50.0, premium=50.0)
        assert result.breakeven_price == 0.0
        assert result.max_loss == 0.0
        assert result.return_on_capital_pct == 100.0


# ===================================================================
# Greeks Formatter
# ===================================================================

class TestFormatGreeksEdgeCases:
    def test_positive_delta(self):
        result = format_greeks(delta=0.55, gamma=0.03, theta=-0.05, vega=0.15)
        assert result.delta == "+0.5500"
        assert result.gamma == "0.0300"
        assert result.theta == "-0.05"
        assert result.vega == "0.15"
        assert result.rho is None

    def test_negative_delta(self):
        result = format_greeks(delta=-0.45, gamma=0.02, theta=-0.10, vega=0.20)
        assert result.delta == "-0.4500"

    def test_rho_provided(self):
        result = format_greeks(delta=0.5, gamma=0.03, theta=-0.05, vega=0.15, rho=0.0123)
        assert result.rho == "+0.0123"

    def test_zero_values(self):
        result = format_greeks(delta=0.0, gamma=0.0, theta=0.0, vega=0.0)
        assert result.delta == "+0.0000"
        assert result.theta == "+0.00"
