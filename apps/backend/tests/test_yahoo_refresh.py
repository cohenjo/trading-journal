"""Tests for the Yahoo Finance price refresh worker.

Unit tests cover:
  - resolve_yahoo_ticker: exchange/currency detection, LSE normalization, TASE lookup
  - refresh_stock_positions: DB interactions, yfinance calls, error isolation
  - CLI entrypoint importability

Integration tests (marked @pytest.mark.integration) hit real Yahoo Finance API
for well-known tickers and are SKIPPED by default in CI.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pandas as pd
import pytest

from app.worker.yahoo_refresh import (
    YAHOO_REFRESH_CRON_DEFAULT,
    YAHOO_REFRESH_JOB_ID,
    _clean_lse_ticker,
    _fetch_yahoo_data,
    refresh_stock_positions,
    resolve_yahoo_ticker,
)
from app.worker.registry import JOB_SCHEDULES


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_TASE_MAP = {
    "1081843": "LUMI.TA",
    "224014": "POLI.TA",
    "604611": "MZTF.TA",
}


# ---------------------------------------------------------------------------
# resolve_yahoo_ticker unit tests
# ---------------------------------------------------------------------------


class TestCleanLseTicker:
    def test_removes_trailing_slash(self) -> None:
        assert _clean_lse_ticker("NG/") == "NG"

    def test_rolls_royce_slash(self) -> None:
        assert _clean_lse_ticker("RR/") == "RR"

    def test_plain_ticker_unchanged(self) -> None:
        assert _clean_lse_ticker("BARC") == "BARC"

    def test_strips_whitespace(self) -> None:
        assert _clean_lse_ticker(" LGEN ") == "LGEN"


class TestResolveYahooTicker:
    # --- US exchanges (explicit listing_exchange) ---
    def test_nyse_verbatim(self) -> None:
        assert resolve_yahoo_ticker("JEPI", "USD", "NYSE") == "JEPI"

    def test_nasdaq_verbatim(self) -> None:
        assert resolve_yahoo_ticker("AAPL", "USD", "NASDAQ") == "AAPL"

    def test_arca_verbatim(self) -> None:
        assert resolve_yahoo_ticker("SPY", "USD", "ARCA") == "SPY"

    def test_pink_verbatim(self) -> None:
        assert resolve_yahoo_ticker("SOME", "USD", "PINK") == "SOME"

    # --- EUR exchanges (explicit listing_exchange) ---
    def test_ibis_xetra_suffix(self) -> None:
        assert resolve_yahoo_ticker("DBK", "EUR", "IBIS") == "DBK.DE"

    def test_sbf_paris_suffix(self) -> None:
        assert resolve_yahoo_ticker("SGO", "EUR", "SBF") == "SGO.PA"

    # --- LSE (explicit listing_exchange) ---
    def test_lse_suffix(self) -> None:
        assert resolve_yahoo_ticker("BARC", "GBP", "LSE") == "BARC.L"

    # --- NULL listing_exchange, currency-based ---
    def test_null_exchange_usd_verbatim(self) -> None:
        assert resolve_yahoo_ticker("QQQI", "USD", None) == "QQQI"

    def test_null_exchange_gbp_appends_l(self) -> None:
        assert resolve_yahoo_ticker("LGEN", "GBP", None) == "LGEN.L"

    def test_null_exchange_gbp_bloomberg_slash_normalized(self) -> None:
        assert resolve_yahoo_ticker("NG/", "GBP", None) == "NG.L"

    def test_null_exchange_gbp_rr_slash(self) -> None:
        assert resolve_yahoo_ticker("RR/", "GBP", None) == "RR.L"

    def test_null_exchange_ila_known_tase(self) -> None:
        result = resolve_yahoo_ticker("1081843", "ILA", None, SAMPLE_TASE_MAP)
        assert result == "LUMI.TA"

    def test_null_exchange_ils_known_tase(self) -> None:
        result = resolve_yahoo_ticker("604611", "ILS", None, SAMPLE_TASE_MAP)
        assert result == "MZTF.TA"

    def test_null_exchange_ila_unknown_tase_returns_none(self) -> None:
        result = resolve_yahoo_ticker("9999999", "ILA", None, SAMPLE_TASE_MAP)
        assert result is None

    def test_null_exchange_ila_no_map_returns_none(self) -> None:
        result = resolve_yahoo_ticker("1081843", "ILA", None, tase_map=None)
        assert result is None

    def test_null_exchange_eur_returns_none(self) -> None:
        result = resolve_yahoo_ticker("SOME", "EUR", None)
        assert result is None

    def test_unknown_exchange_returns_none(self) -> None:
        result = resolve_yahoo_ticker("ZZZZ", "XXX", "UNKNOWN_EXCHANGE")
        assert result is None

    # --- case insensitivity ---
    def test_lowercase_currency_handled(self) -> None:
        assert resolve_yahoo_ticker("O", "usd", "NYSE") == "O"

    def test_lowercase_exchange_handled(self) -> None:
        assert resolve_yahoo_ticker("AAPL", "USD", "nasdaq") == "AAPL"


# ---------------------------------------------------------------------------
# _fetch_yahoo_data unit tests (mocked yfinance)
# ---------------------------------------------------------------------------


def _make_yfinance_mock(
    close: float = 100.5,
    div_yield: float | None = 0.05,
    history_empty: bool = False,
    raise_exc: Exception | None = None,
) -> MagicMock:
    """Build a minimal yfinance.Ticker mock."""
    mock_ticker = MagicMock()

    if raise_exc is not None:
        mock_ticker.history.side_effect = raise_exc
    elif history_empty:
        mock_ticker.history.return_value = pd.DataFrame()
    else:
        df = pd.DataFrame(
            [{"Close": close, "Open": close, "High": close, "Low": close, "Volume": 1000}],
            index=pd.DatetimeIndex(["2026-05-11"]),
        )
        mock_ticker.history.return_value = df

    mock_ticker.info = {"trailingAnnualDividendYield": div_yield}
    return mock_ticker


class TestFetchYahooData:
    @patch("app.worker.yahoo_refresh.time.sleep")
    def test_returns_price_and_yield(self, _mock_sleep: MagicMock) -> None:
        mock_tkr = _make_yfinance_mock(close=150.0, div_yield=0.07)
        with patch("yfinance.Ticker", return_value=mock_tkr):
            result = _fetch_yahoo_data("AAPL")

        assert result is not None
        assert result["mark_price"] == Decimal("150.0")
        assert result["dividend_yield"] == Decimal("0.07")

    @patch("app.worker.yahoo_refresh.time.sleep")
    def test_returns_none_yield_when_missing(self, _mock_sleep: MagicMock) -> None:
        mock_tkr = _make_yfinance_mock(close=50.0, div_yield=None)
        mock_tkr.info = {}
        with patch("yfinance.Ticker", return_value=mock_tkr):
            result = _fetch_yahoo_data("NOYD")

        assert result is not None
        assert result["dividend_yield"] is None

    @patch("app.worker.yahoo_refresh.time.sleep")
    def test_returns_none_on_empty_history(self, _mock_sleep: MagicMock) -> None:
        mock_tkr = _make_yfinance_mock(history_empty=True)
        with patch("yfinance.Ticker", return_value=mock_tkr):
            result = _fetch_yahoo_data("DEAD")

        assert result is None

    @patch("app.worker.yahoo_refresh.time.sleep")
    def test_retries_and_fails(self, _mock_sleep: MagicMock) -> None:
        mock_tkr = _make_yfinance_mock(raise_exc=Exception("network error"))
        with patch("yfinance.Ticker", return_value=mock_tkr):
            result = _fetch_yahoo_data("ERR")

        assert result is None


# ---------------------------------------------------------------------------
# refresh_stock_positions unit tests (mocked DB + yfinance)
# ---------------------------------------------------------------------------


def _pos(
    ticker: str = "AAPL",
    currency: str = "USD",
    listing_exchange: str | None = "NASDAQ",
    quantity: float = 10.0,
    mark_price: float | None = 100.0,
    market_value: float | None = None,
    market_value_local: float | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid4(),
        "ticker": ticker,
        "currency": currency,
        "listing_exchange": listing_exchange,
        "quantity": quantity,
        "mark_price": mark_price,
        "dividend_yield": None,
        "market_value": market_value,
        "market_value_local": market_value_local,
    }


class TestRefreshStockPositions:
    """Integration-style unit tests with mocked DB + yfinance."""

    def _run_with_positions(
        self, positions: list[dict[str, Any]], yf_close: float = 120.0, yf_yield: float = 0.03
    ) -> dict[str, Any]:
        mock_yf = _make_yfinance_mock(close=yf_close, div_yield=yf_yield)
        fake_session = MagicMock()
        fake_session.__enter__ = MagicMock(return_value=fake_session)
        fake_session.__exit__ = MagicMock(return_value=False)

        # tase_map
        fake_session.exec.return_value.all.return_value = []
        # positions query (second call)
        fake_pos_rows = []
        for p in positions:
            row = MagicMock()
            row._mapping = p
            fake_pos_rows.append(row)

        exec_calls: list[Any] = []

        def fake_exec(stmt, params=None):
            exec_calls.append((stmt, params))
            mock_result = MagicMock()
            if not exec_calls or len(exec_calls) == 1:
                # first exec = tase_map
                mock_result.all.return_value = []
            else:
                mock_result.all.return_value = fake_pos_rows
            return mock_result

        fake_session.exec.side_effect = fake_exec

        with (
            patch("app.worker.yahoo_refresh.Session", return_value=fake_session),
            patch("app.worker.yahoo_refresh._load_tase_map", return_value={}),
            patch("app.worker.yahoo_refresh._fetch_active_positions", return_value=positions),
            patch("yfinance.Ticker", return_value=mock_yf),
            patch("app.worker.yahoo_refresh.time.sleep"),
        ):
            return refresh_stock_positions()

    def test_refreshes_usd_position(self) -> None:
        result = self._run_with_positions([_pos("AAPL", "USD", "NASDAQ")])
        assert result["refreshed"] == 1
        assert result["failed"] == 0
        assert result["skipped"] == 0

    def test_refreshes_gbp_position(self) -> None:
        result = self._run_with_positions([_pos("BARC", "GBP", None)])
        assert result["refreshed"] == 1

    def test_skips_unknown_tase_without_map_entry(self) -> None:
        result = self._run_with_positions([_pos("9999999", "ILA", None)])
        assert result["skipped"] == 1
        assert result["refreshed"] == 0

    def test_failure_one_position_does_not_crash_others(self) -> None:
        good = _pos("AAPL", "USD", "NASDAQ")
        bad = _pos("DEAD", "USD", "NASDAQ")
        mock_yf_good = _make_yfinance_mock(close=120.0)
        mock_yf_bad = _make_yfinance_mock(history_empty=True)

        def ticker_side_effect(symbol: str) -> MagicMock:
            if "DEAD" in symbol:
                return mock_yf_bad
            return mock_yf_good

        with (
            patch("app.worker.yahoo_refresh._load_tase_map", return_value={}),
            patch("app.worker.yahoo_refresh._fetch_active_positions", return_value=[good, bad]),
            patch("yfinance.Ticker", side_effect=ticker_side_effect),
            patch("app.worker.yahoo_refresh.time.sleep"),
            patch("app.worker.yahoo_refresh.Session") as mock_sess_cls,
        ):
            mock_sess = MagicMock()
            mock_sess.__enter__ = MagicMock(return_value=mock_sess)
            mock_sess.__exit__ = MagicMock(return_value=False)
            mock_sess_cls.return_value = mock_sess

            result = refresh_stock_positions()

        # One refreshed, one failed — worker did not crash
        assert result["total"] == 2
        assert result["refreshed"] + result["failed"] == 2


# ---------------------------------------------------------------------------
# Schedule registration test
# ---------------------------------------------------------------------------


def test_yahoo_refresh_registered_in_job_schedules() -> None:
    """The yahoo refresh job must be present in JOB_SCHEDULES after module import."""
    ids = [s.job_id for s in JOB_SCHEDULES]
    assert YAHOO_REFRESH_JOB_ID in ids


def test_yahoo_refresh_default_cron() -> None:
    """Default cron should be weekdays at 22:00 UTC."""
    assert YAHOO_REFRESH_CRON_DEFAULT == "0 22 * * MON-FRI"


def test_yahoo_refresh_job_is_cron_kind() -> None:
    schedule = next(s for s in JOB_SCHEDULES if s.job_id == YAHOO_REFRESH_JOB_ID)
    assert schedule.kind == "cron"
    assert schedule.cron_expr is not None


# ---------------------------------------------------------------------------
# Integration tests — hit real Yahoo Finance (skipped in CI)
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestIntegration:
    """Real yfinance calls — skipped unless RUN_INTEGRATION_TESTS=1."""

    @pytest.fixture(autouse=True)
    def require_integration_flag(self) -> None:
        import os

        if not os.getenv("RUN_INTEGRATION_TESTS"):
            pytest.skip("Set RUN_INTEGRATION_TESTS=1 to run integration tests")

    def test_aapl_has_price(self) -> None:
        result = _fetch_yahoo_data("AAPL")
        assert result is not None
        assert result["mark_price"] > Decimal("1")

    def test_lumi_ta_has_price(self) -> None:
        """LUMI.TA — Bank Leumi on Tel Aviv Stock Exchange (priced in ILS)."""
        result = _fetch_yahoo_data("LUMI.TA")
        assert result is not None
        assert result["mark_price"] > Decimal("1")

    def test_barc_l_has_price(self) -> None:
        """BARC.L — Barclays on the London Stock Exchange (priced in GBp)."""
        result = _fetch_yahoo_data("BARC.L")
        assert result is not None
        assert result["mark_price"] > Decimal("0")
