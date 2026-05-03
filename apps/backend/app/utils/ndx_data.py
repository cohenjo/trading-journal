"""NDX market data synchronization helpers."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import date as date_type
from datetime import datetime, timedelta
from decimal import Decimal
import logging
from typing import Any

import yfinance as yf
from sqlmodel import Session

from app.dal.database import engine
from app.schema.models import Ndx1m

logger = logging.getLogger(__name__)
NDX_SYMBOL = "^NDX"


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a database session using the configured worker engine."""

    return Session(engine)


def _decimal_from_market_value(value: object) -> Decimal:
    """Convert yfinance numeric values to Decimal for financial precision."""

    return Decimal(str(value))


def _to_python_datetime(timestamp: Any) -> datetime:
    """Convert a pandas/yfinance timestamp object to a Python datetime."""

    if hasattr(timestamp, "to_pydatetime"):
        return timestamp.to_pydatetime()
    if isinstance(timestamp, datetime):
        return timestamp
    raise TypeError(f"Unsupported timestamp value: {timestamp!r}")


def sync_ndx_data(
    target_date: str | date_type,
    *,
    ticker_factory: Callable[[str], Any] = yf.Ticker,
    session_factory: Callable[[], AbstractContextManager[Session]] = _default_session_factory,
) -> dict[str, object]:
    """Download 1-minute NDX data for a date and upsert it into ``ndx1m``.

    yfinance failures are logged and returned as skipped results so scheduled
    worker runs do not crash on transient market-data errors.
    """

    if isinstance(target_date, str):
        start_date = datetime.strptime(target_date, "%Y-%m-%d")
        date_str = target_date
    else:
        start_date = datetime.combine(target_date, datetime.min.time())
        date_str = target_date.isoformat()
    end_date = start_date + timedelta(days=1)

    try:
        ndx_ticker = ticker_factory(NDX_SYMBOL)
        hist = ndx_ticker.history(
            start=start_date.strftime("%Y-%m-%d"),
            end=end_date.strftime("%Y-%m-%d"),
            interval="1m",
        )
    except Exception as exc:  # noqa: BLE001 - scheduled market-data sync must skip on provider failures
        logger.warning("Skipping NDX sync for %s after yfinance error: %s", date_str, exc)
        return {"status": "skipped", "rows": 0, "date": date_str, "error": str(exc)}

    if hist.empty:
        logger.info("No NDX data returned for %s", date_str)
        return {"status": "skipped", "rows": 0, "date": date_str, "message": f"No data found for {date_str}"}

    rows_written = 0
    with session_factory() as session:
        with session.begin():
            for i in range(len(hist)):
                row = hist.iloc[i]
                timestamp = _to_python_datetime(hist.index[i])
                session.merge(
                    Ndx1m(
                        timestamp=timestamp,
                        open=_decimal_from_market_value(row["Open"]),
                        high=_decimal_from_market_value(row["High"]),
                        low=_decimal_from_market_value(row["Low"]),
                        close=_decimal_from_market_value(row["Close"]),
                        volume=int(row["Volume"]),
                    )
                )
                rows_written += 1

    logger.info("Synced %d NDX row(s) for %s", rows_written, date_str)
    return {"status": "success", "rows": rows_written, "date": date_str}
