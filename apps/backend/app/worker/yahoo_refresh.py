"""Yahoo Finance daily refresh worker for stock_positions mark_price + dividend_yield.

Schedule: daily at 22:00 UTC (after US market close, weekdays only).
Configurable via YAHOO_REFRESH_CRON env var (five-field crontab expression).

Exchange resolution strategy (listing_exchange → Yahoo suffix):
  NYSE / NASDAQ / ARCA / PINK / None-with-USD  →  ticker as-is (e.g. AAPL)
  IBIS (Xetra)                                 →  ticker.DE   (e.g. DBK.DE)
  SBF  (Paris/Euronext)                        →  ticker.PA   (e.g. SGO.PA)
  LSE  / None-with-GBP                         →  clean(ticker).L  (NG/ → NG.L)
  TASE / None-with-ILA                         →  lookup tase_yahoo_map in DB
  Anything else                                →  WARN and skip

TASE normalization note:
  Leumi IRA imports prices in agorot (ILA = 1/100 ILS).
  Yahoo Finance also returns TASE prices in ILA (agorot) — empirically
  confirmed: info.currency == 'ILA' and LUMI.TA price == 7550 (agorot).
  We store the price as-is and set currency = 'ILA' for all TASE rows
  so that broker data and Yahoo data remain in the same canonical unit.
"""

from __future__ import annotations

import logging
import os
import time
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import direct_engine
from app.worker.registry import JOB_SCHEDULES, JobSchedule

logger = logging.getLogger(__name__)

YAHOO_REFRESH_JOB_ID = "yahoo_price_refresh"
YAHOO_REFRESH_CRON_DEFAULT = "0 22 * * MON-FRI"
# Delay between successive yfinance calls to avoid throttling (seconds).
_INTER_TICKER_DELAY_S = 0.25
# Max retries on transient network errors.
_MAX_RETRIES = 3

# Exchange → Yahoo ticker suffix mapping for exchanges with a reliable suffix.
_EXCHANGE_SUFFIX: dict[str, str] = {
    "IBIS": ".DE",
    "SBF": ".PA",
    "AEB": ".AS",  # Amsterdam
    "LSE": ".L",
    "BVME": ".MI",  # Milan
}

# Exchanges where the ticker is used verbatim (USD-denominated US markets).
_USD_EXCHANGES = {"NYSE", "NASDAQ", "ARCA", "PINK", "BATS", "OTC"}


# ---------------------------------------------------------------------------
# Ticker resolution
# ---------------------------------------------------------------------------


def _clean_lse_ticker(ticker: str) -> str:
    """Remove Bloomberg-style trailing slash from LSE tickers.

    Examples:
        "NG/"  → "NG"
        "RR/"  → "RR"
        "BARC" → "BARC"
    """
    return ticker.rstrip("/").strip()


def resolve_yahoo_ticker(
    ticker: str,
    currency: str,
    listing_exchange: str | None,
    tase_map: dict[str, str] | None = None,
) -> str | None:
    """Resolve a Yahoo Finance ticker from a stock_positions row.

    Args:
        ticker: The raw ticker / paper number stored in stock_positions.
        currency: ISO currency code from stock_positions (e.g. "USD", "GBP", "ILA").
        listing_exchange: Exchange code from stock_positions.listing_exchange (may be None).
        tase_map: Optional pre-loaded {tase_paper: yahoo_ticker} dict. If None, TASE
                  positions cannot be resolved (caller should load from DB).

    Returns:
        A Yahoo Finance ticker string, or None if the ticker cannot be resolved
        (caller should log a warning and skip the row).
    """
    exch = (listing_exchange or "").strip().upper()
    curr = (currency or "USD").strip().upper()

    # --- Known exchange with a suffix mapping ---
    if exch in _EXCHANGE_SUFFIX:
        return ticker.strip() + _EXCHANGE_SUFFIX[exch]

    # --- US market exchanges: ticker verbatim ---
    if exch in _USD_EXCHANGES:
        return ticker.strip()

    # --- listing_exchange is NULL: use currency to infer ---
    if exch == "":
        if curr == "USD":
            return ticker.strip()

        if curr == "GBP":
            return _clean_lse_ticker(ticker) + ".L"

        if curr in ("ILA", "ILS"):
            if tase_map is None:
                logger.warning(
                    "[no-yahoo-resolution] TASE ticker=%s — tase_map not loaded, skipping",
                    ticker,
                )
                return None
            yahoo = tase_map.get(ticker.strip())
            if not yahoo:
                logger.warning(
                    "[no-yahoo-resolution] TASE ticker=%s has no entry in tase_yahoo_map, skipping",
                    ticker,
                )
                return None
            return yahoo

        if curr == "EUR":
            # Ambiguous without listing_exchange; skip rather than guess.
            logger.warning(
                "[no-yahoo-resolution] EUR position ticker=%s has no listing_exchange, skipping",
                ticker,
            )
            return None

    # --- Fallback: unknown ---
    logger.warning(
        "[no-yahoo-resolution] Cannot resolve Yahoo ticker for ticker=%s exchange=%s currency=%s, skipping",
        ticker,
        listing_exchange,
        currency,
    )
    return None


# ---------------------------------------------------------------------------
# yfinance helpers
# ---------------------------------------------------------------------------


def _fetch_yahoo_data(yahoo_ticker: str) -> dict[str, Any] | None:
    """Fetch latest price and trailing dividend yield from Yahoo Finance.

    Returns a dict with keys:
        mark_price: Decimal  — latest close price
        dividend_yield: Decimal | None  — trailing 12m yield as decimal (0.05 for 5%)

    Returns None on any error (caller logs and skips).
    """
    try:
        import yfinance as yf  # noqa: PLC0415  local import keeps module importable w/o yfinance
    except ImportError:
        logger.error("yfinance not installed — cannot refresh prices")
        return None

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            tkr = yf.Ticker(yahoo_ticker)
            info = tkr.info or {}
            hist = tkr.history(period="5d")

            if hist is None or hist.empty:
                logger.warning("yfinance returned empty history for %s", yahoo_ticker)
                return None

            close_series = hist["Close"].dropna()
            if close_series.empty:
                logger.warning("yfinance Close column is all-NaN for %s", yahoo_ticker)
                return None

            raw_price = float(close_series.iloc[-1])
            mark_price = Decimal(str(raw_price))

            raw_yield = info.get("trailingAnnualDividendYield") or info.get("dividendYield")
            dividend_yield: Decimal | None = None
            if raw_yield is not None:
                try:
                    raw_float = float(raw_yield)
                    # Yahoo's `dividendYield` field occasionally returns a percentage
                    # (e.g. 10.43 for 10.43%) rather than a decimal fraction (0.1043).
                    # Normalise to [0, 1] so the DB always stores the decimal form.
                    if raw_float > 1:
                        raw_float = raw_float / 100
                    dividend_yield = Decimal(str(raw_float))
                except (InvalidOperation, ValueError):
                    pass

            return {"mark_price": mark_price, "dividend_yield": dividend_yield}

        except Exception as exc:  # noqa: BLE001
            is_rate_limit = "429" in str(exc) or "Too Many Requests" in str(exc)
            if attempt < _MAX_RETRIES:
                delay = _INTER_TICKER_DELAY_S * (3**attempt) if is_rate_limit else _INTER_TICKER_DELAY_S
                logger.warning(
                    "yfinance error for %s (attempt %d/%d, retrying in %.1fs): %s",
                    yahoo_ticker,
                    attempt,
                    _MAX_RETRIES,
                    delay,
                    exc,
                )
                time.sleep(delay)
            else:
                logger.error("yfinance failed for %s after %d attempts: %s", yahoo_ticker, _MAX_RETRIES, exc)
                return None
    return None  # unreachable but satisfies mypy


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _load_tase_map(session: Session) -> dict[str, str]:
    """Load the full tase_yahoo_map table into an in-memory dict."""
    rows = session.execute(text("SELECT tase_paper, yahoo_ticker FROM tase_yahoo_map")).all()
    return {row[0]: row[1] for row in rows}


def _fetch_active_positions(session: Session) -> list[dict[str, Any]]:
    """Return all stock_positions rows that are candidates for Yahoo refresh.

    Includes positions that:
    - Are not bond/cash sub-categories
    - Have a non-zero quantity
    """
    rows = session.execute(
        text(
            """
            SELECT id, ticker, currency, listing_exchange, quantity, mark_price,
                   dividend_yield, market_value, market_value_local
            FROM stock_positions
            WHERE quantity IS NOT NULL
              AND quantity <> 0
              AND (sub_category IS NULL OR sub_category NOT IN ('BOND', 'CASH', 'BILL'))
            ORDER BY ticker
            """
        )
    ).all()
    return [dict(row._mapping) for row in rows]


def _upsert_position_price(
    session: Session,
    position_id: Any,
    yahoo_ticker: str,
    mark_price: Decimal,
    dividend_yield: Decimal | None,
    market_value: Decimal,
    is_tase: bool,
) -> None:
    """Write refreshed market data back to the position row."""
    params: dict[str, Any] = {
        "id": str(position_id),
        "yahoo_ticker": yahoo_ticker,
        "mark_price": str(mark_price),
        "dividend_yield": str(dividend_yield) if dividend_yield is not None else None,
        "market_value": str(market_value),
        "market_value_local": str(market_value),
    }
    if is_tase:
        session.execute(
            text(
                """
                UPDATE stock_positions
                SET yahoo_ticker      = :yahoo_ticker,
                    mark_price        = :mark_price,
                    dividend_yield    = :dividend_yield,
                    market_value      = :market_value,
                    market_value_local= :market_value_local,
                    currency          = 'ILA',
                    prices_refreshed_at = NOW(),
                    updated_at        = NOW()
                WHERE id = CAST(:id AS UUID)
                """
            ),
            params,
        )
    else:
        session.execute(
            text(
                """
                UPDATE stock_positions
                SET yahoo_ticker      = :yahoo_ticker,
                    mark_price        = :mark_price,
                    dividend_yield    = :dividend_yield,
                    market_value      = :market_value,
                    market_value_local= :market_value_local,
                    prices_refreshed_at = NOW(),
                    updated_at        = NOW()
                WHERE id = CAST(:id AS UUID)
                """
            ),
            params,
        )


# ---------------------------------------------------------------------------
# Main refresh function
# ---------------------------------------------------------------------------


def refresh_stock_positions() -> dict[str, Any]:
    """Refresh mark_price, dividend_yield, and market_value for all active stock positions.

    This is the scheduled entry point. It runs synchronously because the worker
    runs it on a background thread managed by APScheduler — no async needed.

    Returns:
        A summary dict: {total, refreshed, skipped, failed}
    """
    logger.info("Yahoo price refresh: starting")

    with Session(direct_engine) as session:
        tase_map = _load_tase_map(session)
        positions = _fetch_active_positions(session)

    total = len(positions)
    refreshed = 0
    skipped = 0
    failed = 0

    with Session(direct_engine) as session:
        for pos in positions:
            pos_id = pos["id"]
            ticker: str = pos["ticker"] or ""
            currency: str = pos["currency"] or "USD"
            listing_exchange: str | None = pos["listing_exchange"]
            quantity: Decimal = Decimal(str(pos["quantity"] or 0))
            old_price = pos["mark_price"]

            yahoo_ticker = resolve_yahoo_ticker(ticker, currency, listing_exchange, tase_map)
            if yahoo_ticker is None:
                skipped += 1
                continue

            is_tase = currency.upper() in ("ILA", "ILS") and not listing_exchange

            data = _fetch_yahoo_data(yahoo_ticker)
            if data is None:
                failed += 1
                logger.error(
                    "Yahoo refresh failed: ticker=%s yahoo=%s — skipping row %s",
                    ticker,
                    yahoo_ticker,
                    pos_id,
                )
                time.sleep(_INTER_TICKER_DELAY_S)
                continue

            mark_price: Decimal = data["mark_price"]
            dividend_yield: Decimal | None = data["dividend_yield"]
            # TASE mark_price is in ILA (agorot = 1/100 ILS).
            # Divide by 100 so market_value is stored in ILS, matching the
            # broker XLS "שווי אחזקה ב ₪" column and all non-TASE positions.
            if is_tase:
                market_value = (quantity * mark_price / Decimal("100")).quantize(Decimal("0.01"))
            else:
                market_value = (quantity * mark_price).quantize(Decimal("0.01"))

            try:
                _upsert_position_price(
                    session=session,
                    position_id=pos_id,
                    yahoo_ticker=yahoo_ticker,
                    mark_price=mark_price,
                    dividend_yield=dividend_yield,
                    market_value=market_value,
                    is_tase=is_tase,
                )
                session.commit()
                refreshed += 1
                logger.info(
                    "Yahoo refresh OK: ticker=%s yahoo=%s old_price=%s new_price=%s yield=%s market_value=%s",
                    ticker,
                    yahoo_ticker,
                    old_price,
                    mark_price,
                    dividend_yield,
                    market_value,
                )
            except Exception:  # noqa: BLE001
                session.rollback()
                failed += 1
                logger.exception(
                    "DB upsert failed: ticker=%s yahoo=%s id=%s",
                    ticker,
                    yahoo_ticker,
                    pos_id,
                )

            time.sleep(_INTER_TICKER_DELAY_S)

    summary = {"total": total, "refreshed": refreshed, "skipped": skipped, "failed": failed}
    logger.info("Yahoo price refresh complete: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# Schedule registration (side-effect on import, matching ndx_daily_sync pattern)
# ---------------------------------------------------------------------------


def _yahoo_refresh_cron() -> str:
    """Return the configured cron expression for the Yahoo refresh job."""
    return os.getenv("YAHOO_REFRESH_CRON", YAHOO_REFRESH_CRON_DEFAULT)


def _run_yahoo_refresh_job() -> None:
    """Scheduler entry point — swallows exceptions so the worker keeps running."""
    try:
        refresh_stock_positions()
    except Exception:  # noqa: BLE001
        logger.exception("Yahoo price refresh job raised an unexpected exception")


if not any(schedule.job_id == YAHOO_REFRESH_JOB_ID for schedule in JOB_SCHEDULES):
    JOB_SCHEDULES.append(
        JobSchedule(
            job_id=YAHOO_REFRESH_JOB_ID,
            kind="cron",
            cron_expr=_yahoo_refresh_cron(),
            handler=_run_yahoo_refresh_job,
        )
    )
