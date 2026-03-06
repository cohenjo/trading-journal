"""
Tests for Company Analysis financial calculation modules.

Covers DCF, Scorecard, Valuation Multiples, Technical Indicators, and Options Analytics.
Uses known expected results to verify financial accuracy.
"""

import math
import pytest
from app.services.analysis.dcf import calculate_dcf, DCFInput
from app.services.analysis.scorecard import (
    calculate_roic,
    calculate_wacc,
    calculate_cagr,
    calculate_net_debt_to_ebitda,
    calculate_financial_scorecard,
    FinancialScorecardInput,
)
from app.services.analysis.valuation import (
    calculate_forward_pe,
    calculate_peg_ratio,
    calculate_ev_fcf,
    calculate_valuation_multiples,
    ValuationMultiplesInput,
)
from app.services.analysis.technicals import (
    calculate_ema,
    calculate_bollinger_bands,
    calculate_rsi,
    calculate_macd,
    detect_support_resistance,
)
from app.services.analysis.options_analytics import (
    calculate_iv_percentile,
    calculate_iv_rank,
    calculate_csp_breakeven,
    format_greeks,
)


# ===================================================================
# DCF Tests
# ===================================================================

class TestDCF:
    def test_basic_dcf(self):
        """Simple 5-year DCF with known inputs."""
        result = calculate_dcf(DCFInput(
            current_fcf=1_000_000,
            growth_rate=0.10,
            discount_rate=0.12,
            terminal_growth_rate=0.03,
            projection_years=5,
            shares_outstanding=100_000,
            current_price=0,
            net_debt=0,
        ))
        assert len(result.projected_fcfs) == 5
        assert result.intrinsic_value_per_share > 0
        assert result.enterprise_value > 0
        assert result.pv_explicit_period > 0
        assert result.pv_terminal_value > 0
        assert result.margin_of_safety_pct is None  # no price given

    def test_dcf_margin_of_safety(self):
        """Margin of safety calculated when price provided."""
        result = calculate_dcf(DCFInput(
            current_fcf=5_000_000,
            growth_rate=0.15,
            discount_rate=0.10,
            terminal_growth_rate=0.03,
            projection_years=10,
            shares_outstanding=1_000_000,
            current_price=50.0,
            net_debt=0,
        ))
        assert result.margin_of_safety_pct is not None
        # Intrinsic should be well above $50 with 15% growth on $5M FCF / 1M shares
        assert result.intrinsic_value_per_share > 50

    def test_dcf_with_net_debt(self):
        """Net debt reduces equity value."""
        no_debt = calculate_dcf(DCFInput(
            current_fcf=1_000_000, growth_rate=0.10, discount_rate=0.12,
            terminal_growth_rate=0.03, projection_years=5,
            shares_outstanding=100_000, net_debt=0,
        ))
        with_debt = calculate_dcf(DCFInput(
            current_fcf=1_000_000, growth_rate=0.10, discount_rate=0.12,
            terminal_growth_rate=0.03, projection_years=5,
            shares_outstanding=100_000, net_debt=500_000,
        ))
        assert with_debt.intrinsic_value_per_share < no_debt.intrinsic_value_per_share

    def test_dcf_discount_must_exceed_terminal(self):
        """Raises when discount ≤ terminal growth (Gordon model breaks)."""
        with pytest.raises(ValueError, match="Discount rate"):
            calculate_dcf(DCFInput(
                current_fcf=1_000_000, growth_rate=0.10,
                discount_rate=0.03, terminal_growth_rate=0.05,
                projection_years=5, shares_outstanding=100_000,
            ))

    def test_dcf_single_year(self):
        """Works with projection_years=1."""
        result = calculate_dcf(DCFInput(
            current_fcf=1_000_000, growth_rate=0.10, discount_rate=0.12,
            terminal_growth_rate=0.02, projection_years=1,
            shares_outstanding=100_000,
        ))
        assert len(result.projected_fcfs) == 1
        assert result.enterprise_value > 0


# ===================================================================
# Scorecard Tests
# ===================================================================

class TestROIC:
    def test_basic_roic(self):
        """ROIC = NOPAT / Invested Capital × 100."""
        assert calculate_roic(150, 1000) == 15.0

    def test_roic_zero_capital_raises(self):
        with pytest.raises(ValueError):
            calculate_roic(100, 0)

    def test_roic_negative_nopat(self):
        result = calculate_roic(-50, 1000)
        assert result == -5.0


class TestWACC:
    def test_basic_wacc(self):
        """50/50 equity-debt split, 10% equity cost, 5% debt cost, 21% tax."""
        result = calculate_wacc(
            market_cap=500, total_debt=500,
            cost_of_equity=0.10, cost_of_debt=0.05, tax_rate=0.21,
        )
        # 0.5 × 10% + 0.5 × 5% × 0.79 = 5% + 1.975% = 6.975%
        assert result == pytest.approx(6.98, abs=0.01)

    def test_wacc_no_debt(self):
        """All-equity firm: WACC = cost of equity."""
        result = calculate_wacc(
            market_cap=1000, total_debt=0,
            cost_of_equity=0.10, cost_of_debt=0.05,
        )
        assert result == pytest.approx(10.0, abs=0.01)


class TestCAGR:
    def test_known_cagr(self):
        """$100 → $200 in 5 years ≈ 14.87% CAGR."""
        result = calculate_cagr([100, 0, 0, 0, 0, 200])
        assert result == pytest.approx(14.87, abs=0.1)

    def test_flat_growth(self):
        assert calculate_cagr([100, 100, 100]) == 0.0

    def test_negative_start(self):
        """Negative starting value returns 0.0."""
        assert calculate_cagr([-100, 200]) == 0.0

    def test_too_few_values(self):
        with pytest.raises(ValueError):
            calculate_cagr([100])


class TestNetDebtToEBITDA:
    def test_basic(self):
        assert calculate_net_debt_to_ebitda(500, 250) == 2.0

    def test_zero_ebitda(self):
        assert calculate_net_debt_to_ebitda(500, 0) is None

    def test_negative_net_debt(self):
        """Net cash position → negative ratio."""
        result = calculate_net_debt_to_ebitda(-200, 400)
        assert result == -0.5


class TestFinancialScorecard:
    def test_composite_scorecard(self):
        result = calculate_financial_scorecard(FinancialScorecardInput(
            nopat=200, invested_capital=1000,
            market_cap=5000, total_debt=1000,
            cost_of_equity=0.10, cost_of_debt=0.05, tax_rate=0.21,
            revenue_history=[100, 110, 121, 133, 146, 161],
            fcf_history=[50, 55, 60, 66, 73, 80],
            net_debt=500, ebitda=300,
        ))
        assert result.roic_pct == 20.0
        assert result.value_creating is True
        assert result.roic_wacc_spread_pct > 0
        assert result.revenue_cagr_pct > 0
        assert result.fcf_cagr_pct > 0
        assert result.net_debt_to_ebitda is not None


# ===================================================================
# Valuation Multiples Tests
# ===================================================================

class TestValuationMultiples:
    def test_forward_pe(self):
        assert calculate_forward_pe(150.0, 10.0) == 15.0

    def test_forward_pe_negative_eps(self):
        assert calculate_forward_pe(150.0, -5.0) is None

    def test_peg_ratio(self):
        # P/E = 150/10 = 15, Growth = 15%. PEG = 15/15 = 1.0
        assert calculate_peg_ratio(150.0, 10.0, 0.15) == 1.0

    def test_peg_negative_growth(self):
        assert calculate_peg_ratio(150.0, 10.0, -0.05) is None

    def test_ev_fcf(self):
        assert calculate_ev_fcf(10_000, 500) == 20.0

    def test_ev_fcf_negative(self):
        assert calculate_ev_fcf(10_000, -100) is None

    def test_composite(self):
        result = calculate_valuation_multiples(ValuationMultiplesInput(
            current_price=150.0,
            forward_eps=10.0,
            eps_growth_rate=0.15,
            enterprise_value=10_000,
            free_cash_flow=500,
        ))
        assert result.forward_pe == 15.0
        assert result.peg_ratio == 1.0
        assert result.ev_fcf == 20.0


# ===================================================================
# Technical Indicators Tests
# ===================================================================

class TestEMA:
    def test_basic_ema(self):
        prices = [10.0] * 5 + [20.0] * 5
        ema = calculate_ema(prices, 5)
        assert len(ema) == len(prices)
        # First 4 should be NaN
        assert math.isnan(ema[0])
        assert math.isnan(ema[3])
        # SMA seed at index 4 should be 10.0
        assert ema[4] == pytest.approx(10.0, abs=0.01)
        # EMA should trend toward 20 as prices jump
        assert ema[-1] > 15.0

    def test_ema_insufficient_data(self):
        ema = calculate_ema([10.0, 11.0], 5)
        assert all(math.isnan(v) for v in ema)

    def test_ema_period_1(self):
        """EMA with period=1 equals the prices themselves."""
        prices = [10.0, 20.0, 30.0]
        ema = calculate_ema(prices, 1)
        assert ema == pytest.approx(prices, abs=0.01)


class TestBollingerBands:
    def test_constant_prices(self):
        """Constant prices → bands collapse to the mean (std=0)."""
        prices = [100.0] * 25
        bb = calculate_bollinger_bands(prices, 20, 2.0)
        # After warm-up, upper == middle == lower
        assert bb.upper[-1] == pytest.approx(100.0)
        assert bb.lower[-1] == pytest.approx(100.0)

    def test_band_width(self):
        """Upper > Middle > Lower for volatile data."""
        prices = [100 + (i % 5) * 2 for i in range(30)]
        bb = calculate_bollinger_bands(prices, 20)
        assert bb.upper[-1] > bb.middle[-1] > bb.lower[-1]


class TestRSI:
    def test_all_up(self):
        """Monotonically rising prices → RSI near 100."""
        prices = list(range(1, 30))
        rsi = calculate_rsi(prices, 14)
        valid = [v for v in rsi if not math.isnan(v)]
        assert all(v > 90 for v in valid)

    def test_all_down(self):
        """Monotonically falling prices → RSI near 0."""
        prices = list(range(30, 0, -1))
        rsi = calculate_rsi(prices, 14)
        valid = [v for v in rsi if not math.isnan(v)]
        assert all(v < 10 for v in valid)

    def test_flat_prices(self):
        """Flat prices → RSI should be NaN for deltas of 0 (no movement)."""
        prices = [50.0] * 20
        rsi = calculate_rsi(prices, 14)
        # When avg_loss is 0, RSI = 100
        valid = [v for v in rsi if not math.isnan(v)]
        assert all(v == 100.0 for v in valid)


class TestMACD:
    def test_macd_length(self):
        prices = [100 + i * 0.5 for i in range(60)]
        result = calculate_macd(prices)
        assert len(result.macd_line) == len(prices)
        assert len(result.signal_line) == len(prices)
        assert len(result.histogram) == len(prices)

    def test_trending_up_positive_macd(self):
        """Uptrend should produce positive MACD line values."""
        prices = [100 + i * 2.0 for i in range(60)]
        result = calculate_macd(prices)
        # Last MACD value should be positive
        valid = [v for v in result.macd_line if not math.isnan(v)]
        assert valid[-1] > 0


class TestSupportResistance:
    def test_simple_pattern(self):
        """V-shaped pattern should detect support at bottom."""
        prices = list(range(100, 90, -1)) + list(range(90, 101))
        levels = detect_support_resistance(prices, window=3)
        support_levels = [l for l in levels if l.kind == "support"]
        assert len(support_levels) >= 1

    def test_insufficient_data(self):
        levels = detect_support_resistance([100, 101, 102], window=5)
        assert levels == []


# ===================================================================
# Options Analytics Tests
# ===================================================================

class TestIVPercentile:
    def test_basic(self):
        """IV at 30, history [10,20,25,30,35,40] → 3 below / 6 = 50%."""
        result = calculate_iv_percentile(30.0, [10, 20, 25, 30, 35, 40])
        assert result == 50.0

    def test_empty_history(self):
        assert calculate_iv_percentile(30.0, []) is None

    def test_all_below(self):
        """Current IV higher than all history → 100%."""
        assert calculate_iv_percentile(50.0, [10, 20, 30, 40]) == 100.0


class TestIVRank:
    def test_basic(self):
        """IV=30, range [20,40] → (30-20)/(40-20)×100 = 50%."""
        result = calculate_iv_rank(30.0, [20, 25, 35, 40])
        assert result == 50.0

    def test_at_high(self):
        assert calculate_iv_rank(40.0, [20, 30, 40]) == 100.0

    def test_at_low(self):
        assert calculate_iv_rank(20.0, [20, 30, 40]) == 0.0

    def test_zero_range(self):
        assert calculate_iv_rank(30.0, [30, 30, 30]) is None


class TestCSPBreakeven:
    def test_basic(self):
        result = calculate_csp_breakeven(strike_price=100.0, premium=3.50)
        assert result.breakeven_price == 96.50
        assert result.strike_price == 100.0
        assert result.premium_received == 3.50
        # Return on capital = 3.50/100 × 100 = 3.5%
        assert result.return_on_capital_pct == 3.5
        # Max loss = 96.50 × 1 × 100 = 9650
        assert result.max_loss == 9650.0

    def test_multiple_contracts(self):
        result = calculate_csp_breakeven(strike_price=50.0, premium=2.0, contracts=5)
        assert result.breakeven_price == 48.0
        assert result.max_loss == 24000.0  # 48 × 5 × 100


class TestGreeksFormatter:
    def test_formatting(self):
        g = format_greeks(delta=0.45, gamma=0.03, theta=-0.05, vega=0.12)
        assert g.delta == "+0.4500"
        assert g.gamma == "0.0300"
        assert g.theta == "-0.05"
        assert g.vega == "0.12"
        assert g.rho is None

    def test_with_rho(self):
        g = format_greeks(delta=-0.30, gamma=0.02, theta=-0.08, vega=0.15, rho=0.01)
        assert g.rho == "+0.0100"
        assert g.delta == "-0.3000"
