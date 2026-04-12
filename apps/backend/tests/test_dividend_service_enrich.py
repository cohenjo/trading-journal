"""
Tests for dividend service: CAGR edge cases, enrich_positions logic,
and resolve_dividend_data helper.

Uses mock DB sessions and DividendTickerData to avoid yfinance calls.
"""

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime

from app.services.dividend_service import (
    calculate_cagr,
    enrich_positions,
    resolve_dividend_data,
)
from app.schema.dividend_models import (
    DividendPosition,
    DividendTickerData,
)


# ===================================================================
# CAGR Extended Tests
# ===================================================================

class TestCAGRExtended:
    def test_zero_start_value(self):
        assert calculate_cagr(0, 200, 5) == 0.0

    def test_zero_years(self):
        assert calculate_cagr(100, 200, 0) == 0.0

    def test_same_start_end(self):
        """No growth: CAGR = 0%."""
        assert calculate_cagr(100, 100, 5) == pytest.approx(0.0)

    def test_doubling_in_one_year(self):
        assert calculate_cagr(100, 200, 1) == pytest.approx(1.0)

    def test_halving_in_one_year(self):
        assert calculate_cagr(100, 50, 1) == pytest.approx(-0.5)

    def test_10_percent_over_2_years(self):
        # 100 → 121 in 2 years = 10% CAGR
        assert calculate_cagr(100, 121, 2) == pytest.approx(0.1, abs=1e-4)

    def test_negative_end_value(self):
        """End value of 0 gives CAGR = -100%."""
        assert calculate_cagr(100, 0, 1) == pytest.approx(-1.0)

    @pytest.mark.parametrize("start,end,years,expected", [
        (1000, 1331, 3, 0.10),       # 10% over 3 years
        (500, 1000, 7, 0.10409),      # ~10.4% over 7 years
        (200, 200, 10, 0.0),          # No growth
    ])
    def test_cagr_parametrized(self, start, end, years, expected):
        assert calculate_cagr(start, end, years) == pytest.approx(expected, abs=1e-3)


# ===================================================================
# Enrich Positions (mocked market data)
# ===================================================================

class TestEnrichPositions:
    def _make_position(self, id: int, ticker: str, shares: float, account: str = "IRA") -> DividendPosition:
        return DividendPosition(id=id, account=account, ticker=ticker, shares=shares)

    def _make_ticker_data(
        self, ticker: str, price: float, currency: str,
        dividend_rate: float, dividend_yield: float,
        dgr_3y: float = 0.0, dgr_5y: float = 0.0,
    ) -> DividendTickerData:
        return DividendTickerData(
            ticker=ticker,
            last_updated=datetime.now(),
            price=price,
            currency=currency,
            dividend_yield=dividend_yield,
            dividend_rate=dividend_rate,
            dgr_3y=dgr_3y,
            dgr_5y=dgr_5y,
            previous_close=price,
        )

    def test_empty_positions(self):
        mock_db = MagicMock()
        result = enrich_positions([], mock_db, target_currency="USD")
        assert result["stats"].annual_income == 0
        assert result["stats"].portfolio_yield == 0
        assert result["positions"] == []

    @patch("app.services.dividend_service.get_market_data_batch")
    @patch("app.services.dividend_service.convert_currency")
    def test_single_position_usd(self, mock_convert, mock_batch):
        """Single USD position, no currency conversion needed."""
        mock_convert.side_effect = lambda amount, from_c, to_c: amount  # 1:1
        td = self._make_ticker_data("AAPL", price=150.0, currency="USD",
                                     dividend_rate=3.28, dividend_yield=0.0219)
        mock_batch.return_value = {"AAPL": td}

        pos = self._make_position(1, "AAPL", 100)
        mock_db = MagicMock()
        result = enrich_positions([pos], mock_db, target_currency="USD")

        assert len(result["positions"]) == 1
        enriched = result["positions"][0]
        assert enriched.price == 150.0
        assert enriched.annual_income == pytest.approx(328.0)  # 100 * 3.28
        assert result["stats"].annual_income == pytest.approx(328.0)

    @patch("app.services.dividend_service.get_market_data_batch")
    @patch("app.services.dividend_service.convert_currency")
    def test_portfolio_yield_calculation(self, mock_convert, mock_batch):
        """Portfolio yield = total_annual_income / total_value."""
        mock_convert.side_effect = lambda amount, from_c, to_c: amount

        mock_batch.return_value = {
            "A": self._make_ticker_data("A", 100, "USD", 4.0, 0.04),
            "B": self._make_ticker_data("B", 50, "USD", 2.0, 0.04),
        }

        positions = [
            self._make_position(1, "A", 10),  # value=1000, income=40
            self._make_position(2, "B", 20),  # value=1000, income=40
        ]
        mock_db = MagicMock()
        result = enrich_positions(positions, mock_db, target_currency="USD")

        # Total value = 2000, total income = 80
        assert float(result["stats"].portfolio_yield) == pytest.approx(0.04)
        assert float(result["stats"].annual_income) == pytest.approx(80.0)

    @patch("app.services.dividend_service.get_market_data_batch")
    @patch("app.services.dividend_service.convert_currency")
    def test_missing_ticker_data_defaults_to_zero(self, mock_convert, mock_batch):
        """Position with no market data should have zero values."""
        mock_convert.side_effect = lambda amount, from_c, to_c: amount
        mock_batch.return_value = {}  # No data

        pos = self._make_position(1, "UNKNOWN", 100)
        mock_db = MagicMock()
        result = enrich_positions([pos], mock_db, target_currency="USD")

        enriched = result["positions"][0]
        assert enriched.price == 0.0
        assert enriched.annual_income == 0.0
        assert enriched.dividend_yield == 0.0

    @patch("app.services.dividend_service.get_market_data_batch")
    @patch("app.services.dividend_service.convert_currency")
    def test_dgr_5y_average(self, mock_convert, mock_batch):
        """Average DGR-5Y across positions with non-zero values."""
        mock_convert.side_effect = lambda amount, from_c, to_c: amount

        mock_batch.return_value = {
            "X": self._make_ticker_data("X", 100, "USD", 2.0, 0.02, dgr_5y=0.10),
            "Y": self._make_ticker_data("Y", 100, "USD", 2.0, 0.02, dgr_5y=0.06),
            "Z": self._make_ticker_data("Z", 100, "USD", 2.0, 0.02, dgr_5y=0.0),
        }

        positions = [
            self._make_position(1, "X", 10),
            self._make_position(2, "Y", 10),
            self._make_position(3, "Z", 10),  # dgr_5y=0, excluded from average
        ]
        mock_db = MagicMock()
        result = enrich_positions(positions, mock_db, target_currency="USD")

        # Only X(0.10) and Y(0.06) count: avg = 0.08
        assert float(result["stats"].dgr_5y) == pytest.approx(0.08)


# ===================================================================
# resolve_dividend_data
# ===================================================================

class TestResolveDividendData:
    def test_basic_with_info_rate(self):
        info = {"dividendRate": 2.0, "dividendYield": 0.04}
        div_rate, div_yield = resolve_dividend_data("AAPL", info, None, 50.0, False)
        assert div_rate == pytest.approx(2.0)
        assert div_yield == pytest.approx(0.04)

    def test_zero_price_uses_target_yield(self):
        info = {"dividendRate": 0, "dividendYield": 0.05}
        div_rate, div_yield = resolve_dividend_data("X", info, None, 0.0, False)
        # With price=0, falls through to target_yield path
        assert div_yield == pytest.approx(0.05)

    def test_no_info_returns_zeros(self):
        div_rate, div_yield = resolve_dividend_data("X", {}, None, 100.0, False)
        assert div_rate == 0.0
        assert div_yield == 0.0
