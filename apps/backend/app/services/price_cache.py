"""Price-cache refresh service for TJ-020 scheduled workers."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
import logging
from typing import Protocol, cast

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine

logger = logging.getLogger(__name__)
DEFAULT_CURRENCY = "USD"


class SessionFactory(Protocol):
    """Callable protocol for creating worker database sessions."""

    def __call__(self) -> AbstractContextManager[Session]:
        """Return a database session context manager."""


@dataclass(frozen=True)
class PriceSymbol:
    """A market symbol and target display currency referenced by user data."""

    symbol: str
    currency: str


@dataclass(frozen=True)
class PriceQuote:
    """External market price quote represented with Decimal precision."""

    symbol: str
    currency: str
    price: Decimal
    as_of: datetime


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a SQLModel session using the configured privileged DB engine."""

    return Session(engine)


def normalize_symbol(symbol: str) -> str:
    """Normalize ticker symbols before lookup/cache writes."""

    return symbol.strip().upper()


def normalize_currency(currency: str | None) -> str:
    """Normalize currency codes, defaulting blank values to USD."""

    normalized = (currency or DEFAULT_CURRENCY).strip().upper()
    return normalized or DEFAULT_CURRENCY


def _to_decimal(value: object) -> Decimal | None:
    """Convert yfinance numeric values to Decimal without retaining binary floats."""

    if value is None:
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    return amount


def fetch_external_price(symbol: str) -> PriceQuote:
    """Fetch one symbol from Yahoo Finance for the scheduled cache refresh."""

    import yfinance as yf

    normalized_symbol = normalize_symbol(symbol)
    ticker = yf.Ticker(normalized_symbol)
    fast_info = ticker.fast_info
    price = _to_decimal(getattr(fast_info, "last_price", None))

    if price is None:
        history = ticker.history(period="1d")
        if not history.empty:
            price = _to_decimal(history["Close"].iloc[-1])

    if price is None:
        raise ValueError(f"Could not fetch price for {normalized_symbol}")

    currency = normalize_currency(getattr(fast_info, "currency", None))
    return PriceQuote(
        symbol=normalized_symbol,
        currency=currency,
        price=price,
        as_of=datetime.now(UTC),
    )


class PriceCacheRefresher:
    """Refresh public.price_cache from all symbols referenced by holdings."""

    def __init__(
        self,
        session_factory: Callable[[], AbstractContextManager[Session]] | None = None,
        price_fetcher: Callable[[str], PriceQuote] = fetch_external_price,
    ) -> None:
        """Initialize the refresher with injectable DB and market-data adapters."""

        self.session_factory = session_factory or _default_session_factory
        self.price_fetcher = price_fetcher

    def refresh_once(self) -> dict[str, int]:
        """Refresh every referenced symbol, isolating external errors per symbol."""

        refreshed = 0
        failed = 0
        with self.session_factory() as session:
            symbols = self._load_symbols(session)
            for symbol_ref in symbols:
                try:
                    quote = self.price_fetcher(symbol_ref.symbol)
                    self._upsert_quote(session, quote)
                    session.commit()
                    refreshed += 1
                except Exception:  # noqa: BLE001 - one bad ticker must not stop the batch
                    session.rollback()
                    failed += 1
                    logger.exception("Failed to refresh price for %s", symbol_ref.symbol)
        return {"symbols": len(symbols), "refreshed": refreshed, "failed": failed}

    def _load_symbols(self, session: Session) -> list[PriceSymbol]:
        """Return distinct symbols from holdings, positions, snapshots, and plans."""

        rows = session.execute(
            text(
                """
                with referenced_symbols as (
                  select symbol, currency
                    from public.trading_positions
                   where nullif(trim(symbol), '') is not null
                  union
                  select ticker as symbol, 'USD' as currency
                    from public.dividend_positions
                   where nullif(trim(ticker), '') is not null
                  union
                  select ticker as symbol, currency
                    from public.bond_holdings
                   where nullif(trim(ticker), '') is not null
                     and deleted_at is null
                  union
                  select item->'account_settings'->>'stock_symbol' as symbol,
                         coalesce(item->>'currency', 'USD') as currency
                    from public.finance_snapshots fs
                    cross join lateral jsonb_array_elements(
                      case when jsonb_typeof(fs.data->'items') = 'array' then fs.data->'items' else '[]'::jsonb end
                    ) item
                   where nullif(trim(item->'account_settings'->>'stock_symbol'), '') is not null
                  union
                  select item->'account_settings'->>'stock_symbol' as symbol,
                         coalesce(item->>'currency', 'USD') as currency
                    from public.plans p
                    cross join lateral jsonb_array_elements(
                      case when jsonb_typeof(p.data->'items') = 'array' then p.data->'items' else '[]'::jsonb end
                    ) item
                   where nullif(trim(item->'account_settings'->>'stock_symbol'), '') is not null
                )
                select distinct upper(trim(symbol)) as symbol,
                       coalesce(nullif(upper(trim(currency)), ''), 'USD') as currency
                  from referenced_symbols
                 where nullif(trim(symbol), '') is not null
                 order by symbol, currency
                """
            )
        ).mappings()

        return [
            PriceSymbol(
                symbol=normalize_symbol(cast(str, row["symbol"])),
                currency=normalize_currency(cast(str | None, row["currency"])),
            )
            for row in rows
        ]

    def _upsert_quote(self, session: Session, quote: PriceQuote) -> None:
        """Upsert a fetched quote into public.price_cache using quote currency."""

        session.execute(
            text(
                """
                insert into public.price_cache (symbol, currency, price, as_of, refreshed_at)
                values (:symbol, :currency, :price, :as_of, now())
                on conflict (symbol, currency) do update
                   set price = excluded.price,
                       as_of = excluded.as_of,
                       refreshed_at = now()
                """
            ),
            {
                "symbol": quote.symbol,
                "currency": quote.currency,
                "price": quote.price,
                "as_of": quote.as_of,
            },
        )


def refresh_price_cache() -> dict[str, int]:
    """Run one scheduled price-cache refresh using the global DB engine."""

    return PriceCacheRefresher().refresh_once()
