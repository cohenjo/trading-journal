"""
Company Analysis API — endpoints for the Analyze page.

Wraps yfinance data fetching with McManus's calculation services.
Includes Copilot SDK-powered growth story analysis.
"""

import asyncio
import logging
import math
from datetime import datetime, date
from typing import Optional

import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.cache import get_cached, set_cached, get_cache_stats
from app.services.analysis import (
    calculate_roic,
    calculate_wacc,
    calculate_cagr,
    calculate_net_debt_to_ebitda,
    calculate_forward_pe,
    calculate_peg_ratio,
    calculate_ev_fcf,
    calculate_ema,
    calculate_bollinger_bands,
    calculate_rsi,
    calculate_macd,
    detect_support_resistance,
    calculate_iv_percentile,
    calculate_iv_rank,
)
from app.services.growth_story import generate_growth_story

logger = logging.getLogger("trading_journal.analyze")

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_get(d: dict, key: str, default=None):
    """Get a value from a dict, returning default if missing or None."""
    val = d.get(key, default)
    return default if val is None else val


def _safe_float(val, default: float = 0.0) -> float:
    """Convert a value to float safely, handling NaN and None."""
    if val is None:
        return default
    try:
        f = float(val)
        return default if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return default


def _df_column_values(df, col: str) -> list[float]:
    """Extract non-NaN values from a DataFrame column, oldest first."""
    if df is None or df.empty or col not in df.columns:
        # yfinance financials have years as columns and line items as rows
        if df is not None and not df.empty and col in df.index:
            row = df.loc[col].dropna().sort_index()
            return [_safe_float(v) for v in row.values]
        return []
    series = df[col].dropna().sort_index()
    return [_safe_float(v) for v in series.values]


def _df_row_values(df, row_label: str) -> list[float]:
    """Extract row values from yfinance financials (rows=items, cols=dates), oldest first."""
    if df is None or df.empty:
        return []
    if row_label in df.index:
        row = df.loc[row_label].dropna()
        # Columns are dates, sort ascending (oldest first)
        row = row.sort_index(ascending=True)
        return [_safe_float(v) for v in row.values]
    return []


def _latest_value(df, row_label: str, default: float = 0.0) -> float:
    """Get the most recent value from a yfinance financial DataFrame row."""
    vals = _df_row_values(df, row_label)
    return vals[-1] if vals else default


# ---------------------------------------------------------------------------
# 1. GET /api/analyze/fundamentals/{ticker}
# ---------------------------------------------------------------------------

@router.get("/fundamentals/{ticker}")
async def get_fundamentals(ticker: str):
    """Company fundamentals with calculated financial metrics."""
    ticker = ticker.upper().strip()
    cache_key = ticker

    cached = get_cached("fundamentals", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers={"X-Cache": "HIT", "Cache-Control": "max-age=3600"})

    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception as e:
        logger.error(f"yfinance error for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch data for {ticker}")

    if not info or info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")

    try:
        financials = t.financials
        cashflow = t.cashflow
        balance_sheet = t.balance_sheet
    except Exception as e:
        logger.warning(f"Could not fetch financial statements for {ticker}: {e}")
        financials = cashflow = balance_sheet = None

    # --- Extract raw data from info ---
    market_cap = _safe_float(info.get("marketCap"))
    current_price = _safe_float(
        info.get("currentPrice", info.get("regularMarketPrice"))
    )
    forward_eps = _safe_float(info.get("forwardEps"))
    trailing_eps = _safe_float(info.get("trailingEps"))
    dividend_yield = _safe_float(info.get("dividendYield"))
    shares_outstanding = _safe_float(info.get("sharesOutstanding"))

    # --- Calculate ROIC ---
    roic = None
    try:
        operating_income = _latest_value(financials, "Operating Income")
        tax_provision = _latest_value(financials, "Tax Provision")
        pretax_income = _latest_value(financials, "Pretax Income")
        tax_rate = (tax_provision / pretax_income) if pretax_income != 0 else 0.21
        nopat = operating_income * (1 - tax_rate)

        total_equity = _latest_value(balance_sheet, "Stockholders Equity")
        total_debt = _latest_value(balance_sheet, "Total Debt")
        cash = _latest_value(balance_sheet, "Cash And Cash Equivalents")
        invested_capital = total_equity + total_debt - cash

        if invested_capital > 0:
            roic = calculate_roic(nopat, invested_capital) / 100.0  # Convert pct to ratio
    except Exception as e:
        logger.debug(f"ROIC calculation failed for {ticker}: {e}")

    # --- Calculate WACC ---
    wacc = None
    try:
        beta = _safe_float(info.get("beta"), 1.0)
        risk_free = 0.043  # ~10Y Treasury yield approximation
        market_premium = 0.055
        cost_of_equity = risk_free + beta * market_premium
        total_debt_val = _latest_value(balance_sheet, "Total Debt")
        interest_expense = abs(_latest_value(financials, "Interest Expense"))
        cost_of_debt = (interest_expense / total_debt_val) if total_debt_val > 0 else 0.0

        if market_cap > 0:
            wacc = calculate_wacc(
                market_cap=market_cap,
                total_debt=total_debt_val,
                cost_of_equity=cost_of_equity,
                cost_of_debt=cost_of_debt,
                tax_rate=tax_rate if 'tax_rate' in dir() else 0.21,
            ) / 100.0  # Convert pct to ratio
    except Exception as e:
        logger.debug(f"WACC calculation failed for {ticker}: {e}")

    # --- Revenue and FCF CAGRs ---
    revenue_cagr = None
    fcf_cagr = None
    try:
        revenues = _df_row_values(financials, "Total Revenue")
        if len(revenues) >= 2:
            revenue_cagr = calculate_cagr(revenues) / 100.0
    except Exception as e:
        logger.debug(f"Revenue CAGR failed for {ticker}: {e}")

    try:
        fcfs = _df_row_values(cashflow, "Free Cash Flow")
        if len(fcfs) >= 2:
            fcf_cagr = calculate_cagr(fcfs) / 100.0
    except Exception as e:
        logger.debug(f"FCF CAGR failed for {ticker}: {e}")

    # --- Net Debt / EBITDA ---
    net_debt_ebitda = None
    try:
        total_debt_val = _latest_value(balance_sheet, "Total Debt")
        cash_val = _latest_value(balance_sheet, "Cash And Cash Equivalents")
        net_debt_val = total_debt_val - cash_val
        ebitda_val = _safe_float(info.get("ebitda"))
        if ebitda_val > 0:
            net_debt_ebitda = calculate_net_debt_to_ebitda(net_debt_val, ebitda_val)
    except Exception as e:
        logger.debug(f"Net Debt/EBITDA failed for {ticker}: {e}")

    # --- Valuation multiples ---
    forward_pe = None
    peg_ratio_val = None
    ev_fcf = None
    try:
        if forward_eps > 0:
            forward_pe = calculate_forward_pe(current_price, forward_eps)
        eps_growth = _safe_float(info.get("earningsGrowth"))
        if forward_eps > 0 and eps_growth > 0:
            peg_ratio_val = calculate_peg_ratio(current_price, forward_eps, eps_growth)
        ev = _safe_float(info.get("enterpriseValue"))
        latest_fcf = _latest_value(cashflow, "Free Cash Flow") if cashflow is not None else 0.0
        if ev > 0 and latest_fcf > 0:
            ev_fcf = calculate_ev_fcf(ev, latest_fcf)
    except Exception as e:
        logger.debug(f"Valuation multiples failed for {ticker}: {e}")

    # --- DCF inputs ---
    current_fcf = _latest_value(cashflow, "Free Cash Flow") if cashflow is not None else 0.0

    result = {
        "ticker": ticker,
        "name": info.get("longName", info.get("shortName", ticker)),
        "sector": info.get("sector"),
        "market_cap": market_cap,
        "currency": info.get("currency", "USD"),
        "financials": {
            "roic": roic,
            "wacc": wacc,
            "revenue_cagr_5y": revenue_cagr,
            "fcf_cagr_5y": fcf_cagr,
            "net_debt_ebitda": net_debt_ebitda,
            "forward_pe": forward_pe,
            "peg_ratio": peg_ratio_val,
            "ev_fcf": ev_fcf,
            "trailing_eps": trailing_eps,
            "forward_eps": forward_eps,
            "dividend_yield": dividend_yield,
        },
        "dcf_inputs": {
            "current_fcf": current_fcf,
            "shares_outstanding": shares_outstanding,
            "growth_rate_default": 0.08,
            "discount_rate_default": 0.10,
            "terminal_growth": 0.025,
            "projection_years": 10,
        },
    }

    set_cached("fundamentals", cache_key, result)
    return JSONResponse(content=result, headers={"X-Cache": "MISS", "Cache-Control": "max-age=3600"})


# ---------------------------------------------------------------------------
# 2. GET /api/analyze/price-history/{ticker}
# ---------------------------------------------------------------------------

@router.get("/price-history/{ticker}")
async def get_price_history(
    ticker: str,
    period: str = Query("1y", pattern="^(1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$"),
    interval: str = Query("1d", pattern="^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$"),
):
    """OHLCV price history for charting."""
    ticker = ticker.upper().strip()
    cache_key = f"{ticker}:{period}:{interval}"

    cached = get_cached("price", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers={"X-Cache": "HIT", "Cache-Control": "max-age=300"})

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=period, interval=interval)
    except Exception as e:
        logger.error(f"yfinance price history error for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch price history for {ticker}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No price data for '{ticker}'")

    data = []
    for idx, row in hist.iterrows():
        time_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)
        data.append({
            "time": time_str,
            "open": round(_safe_float(row.get("Open")), 2),
            "high": round(_safe_float(row.get("High")), 2),
            "low": round(_safe_float(row.get("Low")), 2),
            "close": round(_safe_float(row.get("Close")), 2),
            "volume": int(_safe_float(row.get("Volume"))),
        })

    result = {
        "ticker": ticker,
        "period": period,
        "interval": interval,
        "data": data,
    }

    set_cached("price", cache_key, result)
    return JSONResponse(content=result, headers={"X-Cache": "MISS", "Cache-Control": "max-age=300"})


# ---------------------------------------------------------------------------
# 3. GET /api/analyze/technicals/{ticker}
# ---------------------------------------------------------------------------

@router.get("/technicals/{ticker}")
async def get_technicals(ticker: str):
    """Technical indicators calculated from 6 months of daily OHLCV."""
    ticker = ticker.upper().strip()
    cache_key = ticker

    cached = get_cached("technicals", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers={"X-Cache": "HIT", "Cache-Control": "max-age=300"})

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="6mo", interval="1d")
    except Exception as e:
        logger.error(f"yfinance error for technicals {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch data for {ticker}")

    if hist is None or hist.empty:
        raise HTTPException(status_code=404, detail=f"No price data for '{ticker}'")

    closes = [_safe_float(c) for c in hist["Close"].tolist()]

    ema_50 = calculate_ema(closes, 50)
    ema_200 = calculate_ema(closes, 200)
    rsi_values = calculate_rsi(closes, 14)
    macd_result = calculate_macd(closes)
    bollinger = calculate_bollinger_bands(closes, 20, 2.0)
    sr_levels = detect_support_resistance(closes)

    # Get latest non-NaN values
    latest_ema_50 = _last_valid(ema_50)
    latest_ema_200 = _last_valid(ema_200)
    latest_rsi = _last_valid(rsi_values)
    latest_macd = _last_valid(macd_result.macd_line)
    latest_signal = _last_valid(macd_result.signal_line)
    latest_histogram = _last_valid(macd_result.histogram)
    latest_bb_upper = _last_valid(bollinger.upper)
    latest_bb_middle = _last_valid(bollinger.middle)
    latest_bb_lower = _last_valid(bollinger.lower)

    # Bandwidth = (upper - lower) / middle
    bb_bandwidth = None
    if latest_bb_middle and latest_bb_middle != 0 and latest_bb_upper and latest_bb_lower:
        bb_bandwidth = round((latest_bb_upper - latest_bb_lower) / latest_bb_middle, 4)

    # Support/resistance: take the strongest of each
    support_1 = None
    resistance_1 = None
    for level in sr_levels:
        if level.kind == "support" and support_1 is None:
            support_1 = round(level.price, 2)
        elif level.kind == "resistance" and resistance_1 is None:
            resistance_1 = round(level.price, 2)

    # Determine trend
    trend = "neutral"
    if latest_ema_50 and latest_ema_200:
        if latest_ema_50 > latest_ema_200:
            trend = "bullish"
        elif latest_ema_50 < latest_ema_200:
            trend = "bearish"

    result = {
        "ticker": ticker,
        "as_of": date.today().isoformat(),
        "indicators": {
            "ema_50": latest_ema_50,
            "ema_200": latest_ema_200,
            "rsi_14": latest_rsi,
            "macd": {
                "macd_line": latest_macd,
                "signal_line": latest_signal,
                "histogram": latest_histogram,
            },
            "bollinger": {
                "upper": latest_bb_upper,
                "middle": latest_bb_middle,
                "lower": latest_bb_lower,
                "bandwidth": bb_bandwidth,
            },
        },
        "support_resistance": {
            "support_1": support_1,
            "resistance_1": resistance_1,
            "trend": trend,
        },
    }

    set_cached("technicals", cache_key, result)
    return JSONResponse(content=result, headers={"X-Cache": "MISS", "Cache-Control": "max-age=300"})


def _last_valid(values: list[float]) -> Optional[float]:
    """Return the last non-NaN value from a list, or None."""
    for v in reversed(values):
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            return round(v, 4) if isinstance(v, float) else v
    return None


# ---------------------------------------------------------------------------
# 4. GET /api/analyze/options/{ticker}
# ---------------------------------------------------------------------------

@router.get("/options/{ticker}")
async def get_option_chain(
    ticker: str,
    expiry: Optional[str] = Query(None, description="Expiration date YYYY-MM-DD"),
):
    """Option chain with IV analytics."""
    ticker = ticker.upper().strip()
    cache_key = f"{ticker}:{expiry or 'default'}"

    cached = get_cached("options", cache_key)
    if cached is not None:
        return JSONResponse(content=cached, headers={"X-Cache": "HIT", "Cache-Control": "max-age=300"})

    try:
        t = yf.Ticker(ticker)
        expirations = t.options  # tuple of date strings
    except Exception as e:
        logger.error(f"yfinance options error for {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch options for {ticker}")

    if not expirations:
        raise HTTPException(status_code=404, detail=f"No options data for '{ticker}'")

    # Select expiry
    selected_expiry = expiry if expiry and expiry in expirations else expirations[0]

    try:
        chain = t.option_chain(selected_expiry)
    except Exception as e:
        logger.error(f"yfinance option chain error for {ticker} {selected_expiry}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch option chain for {ticker}")

    info = t.info or {}
    current_price = _safe_float(
        info.get("currentPrice", info.get("regularMarketPrice"))
    )

    # --- Format calls ---
    calls = []
    for _, row in chain.calls.iterrows():
        calls.append(_format_option_row(row))

    # --- Format puts ---
    puts = []
    for _, row in chain.puts.iterrows():
        puts.append(_format_option_row(row))

    # --- IV Percentile & Rank ---
    # Collect IV values from the chain as a proxy for historical IV distribution
    all_ivs = []
    for df in [chain.calls, chain.puts]:
        if "impliedVolatility" in df.columns:
            ivs = df["impliedVolatility"].dropna().tolist()
            all_ivs.extend([_safe_float(iv) for iv in ivs if _safe_float(iv) > 0])

    # Use ATM IV as "current" IV
    current_iv = _get_atm_iv(chain.calls, current_price)

    iv_percentile = None
    iv_rank = None
    if current_iv and all_ivs:
        iv_percentile = calculate_iv_percentile(current_iv, all_ivs)
        iv_rank = calculate_iv_rank(current_iv, all_ivs)

    result = {
        "ticker": ticker,
        "current_price": current_price,
        "expirations": list(expirations),
        "selected_expiry": selected_expiry,
        "iv_percentile": iv_percentile,
        "iv_rank": iv_rank,
        "calls": calls,
        "puts": puts,
    }

    set_cached("options", cache_key, result)
    return JSONResponse(content=result, headers={"X-Cache": "MISS", "Cache-Control": "max-age=300"})


def _format_option_row(row) -> dict:
    """Format a single option row from yfinance DataFrame."""
    return {
        "strike": _safe_float(row.get("strike")),
        "bid": _safe_float(row.get("bid")),
        "ask": _safe_float(row.get("ask")),
        "iv": _safe_float(row.get("impliedVolatility")),
        "delta": _safe_float(row.get("delta")) if "delta" in row.index else None,
        "gamma": _safe_float(row.get("gamma")) if "gamma" in row.index else None,
        "theta": _safe_float(row.get("theta")) if "theta" in row.index else None,
        "volume": int(_safe_float(row.get("volume"))),
        "open_interest": int(_safe_float(row.get("openInterest"))),
    }


def _get_atm_iv(calls_df, current_price: float) -> Optional[float]:
    """Find implied volatility of the option closest to ATM."""
    if calls_df is None or calls_df.empty or current_price <= 0:
        return None
    if "strike" not in calls_df.columns or "impliedVolatility" not in calls_df.columns:
        return None
    try:
        idx = (calls_df["strike"] - current_price).abs().idxmin()
        iv = calls_df.loc[idx, "impliedVolatility"]
        return _safe_float(iv) if _safe_float(iv) > 0 else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 5. GET /api/analyze/synthesis/{ticker}
# ---------------------------------------------------------------------------

@router.get("/synthesis/{ticker}")
async def get_synthesis(ticker: str):
    """
    Template-based company synthesis — Phase 1 (no LLM).

    Derives observations from fundamentals data.
    """
    ticker = ticker.upper().strip()
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception as e:
        logger.error(f"yfinance error for synthesis {ticker}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch data for {ticker}")

    if not info or info.get("regularMarketPrice") is None and info.get("currentPrice") is None:
        raise HTTPException(status_code=404, detail=f"Ticker '{ticker}' not found")

    name = info.get("longName", info.get("shortName", ticker))
    sector = info.get("sector", "Unknown")
    market_cap = _safe_float(info.get("marketCap"))
    forward_pe = _safe_float(info.get("forwardPE"))
    trailing_pe = _safe_float(info.get("trailingPE"))
    revenue_growth = _safe_float(info.get("revenueGrowth"))
    earnings_growth = _safe_float(info.get("earningsGrowth"))
    profit_margins = _safe_float(info.get("profitMargins"))
    dividend_yield = _safe_float(info.get("dividendYield"))
    beta = _safe_float(info.get("beta"), 1.0)

    # --- Build growth engine observations ---
    growth_engine: list[str] = []

    if revenue_growth > 0.10:
        growth_engine.append(
            f"Revenue growing {revenue_growth:.0%} YoY, indicating strong top-line momentum"
        )
    elif revenue_growth > 0:
        growth_engine.append(
            f"Moderate revenue growth at {revenue_growth:.0%} YoY"
        )

    if earnings_growth > 0.15:
        growth_engine.append(
            f"Earnings expanding {earnings_growth:.0%} YoY, outpacing revenue growth"
        )

    if profit_margins > 0.20:
        growth_engine.append(
            f"High profit margins at {profit_margins:.0%}, suggesting pricing power and operational efficiency"
        )

    if dividend_yield > 0.02:
        growth_engine.append(
            f"Attractive dividend yield of {dividend_yield:.1%} provides income component"
        )

    if sector:
        growth_engine.append(f"Positioned in {sector} sector")

    if not growth_engine:
        growth_engine.append(f"{name} financial data is limited — further research recommended")

    # --- Build bear case observations ---
    bear_case: list[str] = []

    if forward_pe > 30:
        bear_case.append(
            f"Premium valuation at {forward_pe:.1f}x forward P/E leaves limited margin of safety"
        )
    elif forward_pe > 0 and forward_pe < 8:
        bear_case.append(
            f"Low {forward_pe:.1f}x forward P/E may signal market concerns about future earnings"
        )

    if revenue_growth < 0:
        bear_case.append(
            f"Revenue declining {revenue_growth:.0%} YoY — growth story may be deteriorating"
        )

    if beta > 1.5:
        bear_case.append(
            f"High beta of {beta:.2f} implies elevated volatility relative to the broader market"
        )

    if profit_margins < 0.05 and profit_margins > 0:
        bear_case.append(
            f"Thin profit margins at {profit_margins:.0%} leave little room for execution errors"
        )

    if profit_margins < 0:
        bear_case.append(f"Currently unprofitable with {profit_margins:.0%} margins")

    if not bear_case:
        bear_case.append("No significant red flags identified from available data")

    # --- Price action summary (simple template) ---
    current_price = _safe_float(
        info.get("currentPrice", info.get("regularMarketPrice"))
    )
    fifty_two_high = _safe_float(info.get("fiftyTwoWeekHigh"))
    fifty_two_low = _safe_float(info.get("fiftyTwoWeekLow"))

    if fifty_two_high > 0 and fifty_two_low > 0 and current_price > 0:
        range_position = (current_price - fifty_two_low) / (fifty_two_high - fifty_two_low) if (fifty_two_high - fifty_two_low) > 0 else 0.5
        if range_position > 0.8:
            setup_quality = "Trading near 52-week highs — momentum is strong but entry risk is elevated"
        elif range_position < 0.3:
            setup_quality = "Trading near 52-week lows — potential value opportunity, but confirm support"
        else:
            setup_quality = "Mid-range within 52-week band — neutral positioning"
        support_text = f"${fifty_two_low:.2f} (52-week low)"
    else:
        setup_quality = "Insufficient data for price action assessment"
        support_text = "N/A"

    return {
        "ticker": ticker,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "growth_engine": growth_engine,
        "bear_case": bear_case,
        "price_action_summary": {
            "current_support": support_text,
            "setup_quality": setup_quality,
        },
    }


# ---------------------------------------------------------------------------
# Cache Stats
# ---------------------------------------------------------------------------

@router.get("/cache-stats")
async def cache_stats():
    """Cache hit/miss statistics for monitoring."""
    return get_cache_stats()


# ---------------------------------------------------------------------------
# 6. POST /api/analyze/growth-story/{ticker}
# ---------------------------------------------------------------------------


class GrowthStoryRequest(BaseModel):
    """Optional body for the growth-story endpoint."""

    company_name: str = Field(default="", description="Full company name for context")
    sector: str = Field(default="", description="Company sector for context")


@router.post("/growth-story/{ticker}")
async def post_growth_story(ticker: str, body: Optional[GrowthStoryRequest] = None):
    """AI-powered multi-scenario growth narrative using Copilot SDK.

    Triggers an expensive AI operation that searches the web, analyzes
    SEC filings, news, and social sentiment to produce three investment
    scenarios (best / probable / worst case).

    Falls back to yfinance ticker.info for company_name and sector if
    not provided in the request body.
    """
    ticker = ticker.upper().strip()

    company_name = body.company_name if body else ""
    sector = body.sector if body else ""

    # Auto-fill from yfinance when not supplied
    if not company_name or not sector:
        try:
            info = yf.Ticker(ticker).info or {}
            if not company_name:
                company_name = info.get("longName", info.get("shortName", ""))
            if not sector:
                sector = info.get("sector", "")
        except Exception as e:
            logger.warning(f"Could not fetch ticker info for {ticker}: {e}")

    try:
        result = await asyncio.wait_for(
            generate_growth_story(ticker, company_name, sector),
            timeout=180.0,  # 3 min — agent needs time to search the web
        )
        return result
    except asyncio.TimeoutError:
        logger.error(f"Growth story generation timed out for {ticker}")
        raise HTTPException(
            status_code=504,
            detail=f"Growth story generation timed out for {ticker}. Try again later.",
        )
    except RuntimeError as e:
        logger.error(f"Copilot SDK error for {ticker}: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"AI analysis service unavailable: {e}",
        )
    except ValueError as e:
        logger.error(f"Response parsing error for {ticker}: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Failed to parse AI response for {ticker}: {e}",
        )
