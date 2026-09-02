"""Exchange rates refresh service for periodic FX updates."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
import logging
from typing import Protocol

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine

logger = logging.getLogger(__name__)

# Currency tickers mapping from Yahoo Finance ticker to target currency code (base ILS)
FX_TICKERS: dict[str, str] = {
    "USDILS=X": "USD",
    "EURILS=X": "EUR",
    "GBPILS=X": "GBP",
}


class SessionFactory(Protocol):
    """Callable protocol for creating database sessions."""

    def __call__(self) -> AbstractContextManager[Session]:
        """Return a database session context manager."""


@dataclass(frozen=True)
class FXRate:
    """Exchange rate against ILS (base = ILS)."""

    currency: str
    rate_to_ils: Decimal
    as_of: datetime


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a SQLModel session using the configured database engine."""
    return Session(engine)


def fetch_external_fx_rate(pair_symbol: str, target_currency: str) -> FXRate:
    """Fetch spot exchange rate from Yahoo Finance."""
    import yfinance as yf

    ticker = yf.Ticker(pair_symbol)
    fast_info = ticker.fast_info
    raw_price = getattr(fast_info, "last_price", None)

    if raw_price is None:
        history = ticker.history(period="5d")
        if not history.empty:
            raw_price = history["Close"].iloc[-1]

    if raw_price is None:
        raise ValueError(f"Could not fetch FX rate for {pair_symbol}")

    try:
        rate = Decimal(str(raw_price))
    except (InvalidOperation, ValueError) as err:
        raise ValueError(f"Invalid rate value for {pair_symbol}: {raw_price}") from err

    if not rate.is_finite() or rate <= 0:
        raise ValueError(f"Non-positive rate for {pair_symbol}: {rate}")

    return FXRate(
        currency=target_currency,
        rate_to_ils=rate,
        as_of=datetime.now(UTC),
    )


class ExchangeRatesRefresher:
    """Refresh public.exchange_rates periodically."""

    def __init__(
        self,
        session_factory: Callable[[], AbstractContextManager[Session]] | None = None,
        rate_fetcher: Callable[[str, str], FXRate] = fetch_external_fx_rate,
    ) -> None:
        self.session_factory = session_factory or _default_session_factory
        self.rate_fetcher = rate_fetcher

    def refresh_once(self) -> dict[str, int]:
        """Fetch FX rates and upsert into database."""
        refreshed = 0
        failed = 0

        with self.session_factory() as session:
            # Always ensure base currency ILS exists
            self._upsert_rate(
                session,
                FXRate(currency="ILS", rate_to_ils=Decimal("1.0"), as_of=datetime.now(UTC)),
            )
            session.commit()
            refreshed += 1

            for pair_symbol, currency in FX_TICKERS.items():
                try:
                    quote = self.rate_fetcher(pair_symbol, currency)
                    self._upsert_rate(session, quote)
                    session.commit()
                    refreshed += 1
                except Exception:  # noqa: BLE001
                    session.rollback()
                    failed += 1
                    logger.exception("Failed to refresh FX rate for %s (%s)", pair_symbol, currency)

        return {"refreshed": refreshed, "failed": failed}

    def _upsert_rate(self, session: Session, quote: FXRate) -> None:
        """Upsert a single FX rate into public.exchange_rates."""
        session.execute(
            text(
                """
                insert into public.exchange_rates (currency, rate_to_ils, as_of, refreshed_at)
                values (:currency, :rate_to_ils, :as_of, now())
                on conflict (currency) do update
                   set rate_to_ils = excluded.rate_to_ils,
                       as_of       = excluded.as_of,
                       refreshed_at = now()
                """
            ),
            {
                "currency": quote.currency,
                "rate_to_ils": quote.rate_to_ils,
                "as_of": quote.as_of,
            },
        )


def refresh_exchange_rates() -> dict[str, int]:
    """Top-level handler for scheduled worker execution."""
    refresher = ExchangeRatesRefresher()
    return refresher.refresh_once()
