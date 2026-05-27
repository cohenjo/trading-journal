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
    dividend_yield: Decimal | None = None  # trailing 12m yield as percentage form (0.87 = 0.87%)


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


def _yfinance_yield_to_percent(raw: object) -> Decimal | None:
    """Convert a raw yfinance dividend yield value to percentage form.

    CONVENTION: dividend_yield is stored as percentage form (0.87 = 0.87%).
    yfinance's ``trailingAnnualDividendYield`` returns a decimal fraction
    (0.0087 for 0.87%); the ``dividendYield`` info field occasionally returns
    a percentage integer (10.43 for 10.43%).  Both are normalised here so that
    every downstream consumer sees consistent percentage form.

    Args:
        raw: Raw yfinance yield value — decimal fraction (e.g. 0.0087),
             percentage form (e.g. 10.43), zero, or ``None``.

    Returns:
        ``Decimal`` in percentage form (e.g. 0.87), or ``None`` when there
        is no meaningful yield (zero, negative, ``None``, or non-numeric).
    """
    if raw is None:
        return None
    try:
        raw_float = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not (raw_float > 0):
        # Covers zero, negatives, and NaN — no dividend to report.
        return None
    if raw_float > 1:
        # Already in percentage form (e.g. 10.43 from dividendYield info field).
        percent = raw_float
    else:
        # Decimal fraction (e.g. 0.0087 from trailingAnnualDividendYield) → ×100.
        percent = raw_float * 100.0
    return Decimal(str(round(percent, 6)))


def fetch_external_price(symbol: str) -> PriceQuote:
    """Fetch one symbol from Yahoo Finance for the scheduled cache refresh.

    Fetches both the latest mark price and the trailing 12-month dividend yield.
    Yield is stored as percentage form (0.87 = 0.87%) — see
    ``_yfinance_yield_to_percent`` for the normalisation logic.  When the ticker
    pays no dividend or Yahoo does not report a yield, ``dividend_yield`` is
    ``None``.
    """

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

    # Fetch trailing annual dividend yield and normalise to percentage form.
    # trailingAnnualDividendYield returns a decimal fraction (0.0087 for 0.87%);
    # _yfinance_yield_to_percent converts it to percentage form (0.87).
    dividend_yield: Decimal | None = None
    try:
        info = ticker.info or {}
        raw_yield = info.get("trailingAnnualDividendYield") or info.get("dividendYield")
        dividend_yield = _yfinance_yield_to_percent(raw_yield)
    except Exception:  # noqa: BLE001
        pass  # yield is best-effort; price is the critical value

    return PriceQuote(
        symbol=normalized_symbol,
        currency=currency,
        price=price,
        as_of=datetime.now(UTC),
        dividend_yield=dividend_yield,
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
                insert into public.price_cache (symbol, currency, price, dividend_yield, as_of, refreshed_at)
                values (:symbol, :currency, :price, :dividend_yield, :as_of, now())
                on conflict (symbol, currency) do update
                   set price          = excluded.price,
                       dividend_yield = excluded.dividend_yield,
                       as_of          = excluded.as_of,
                       refreshed_at   = now()
                """
            ),
            {
                "symbol": quote.symbol,
                "currency": quote.currency,
                "price": quote.price,
                "dividend_yield": str(quote.dividend_yield) if quote.dividend_yield is not None else None,
                "as_of": quote.as_of,
            },
        )


def refresh_price_cache() -> dict[str, int]:
    """Run one scheduled price-cache refresh using the global DB engine."""

    return PriceCacheRefresher().refresh_once()


@dataclass(frozen=True)
class CachedPriceData:
    """Price and dividend yield returned from the local price_cache table."""

    symbol: str
    currency: str
    price: Decimal
    dividend_yield: Decimal | None
    refreshed_at: datetime


def lookup_cached_price_data(
    symbol: str,
    currency: str,
    session: Session,
) -> CachedPriceData | None:
    """Look up price and dividend yield from the local price_cache table.

    Args:
        symbol: Ticker symbol (case-insensitive, normalised to upper-case).
        currency: ISO currency code (normalised to upper-case, defaults to USD).
        session: Open SQLAlchemy session (caller manages lifecycle).

    Returns:
        A ``CachedPriceData`` instance when the symbol/currency pair is cached,
        ``None`` when the cache has no entry for this symbol.
    """
    sym = normalize_symbol(symbol)
    curr = normalize_currency(currency)
    row = (
        session.execute(
            text(
                """
            SELECT symbol, currency, price, dividend_yield, refreshed_at
              FROM public.price_cache
             WHERE symbol   = :symbol
               AND currency = :currency
            """
            ),
            {"symbol": sym, "currency": curr},
        )
        .mappings()
        .first()
    )

    if row is None:
        return None

    price = _to_decimal(row["price"])
    if price is None:
        return None

    dy_raw = row["dividend_yield"]
    dividend_yield = _to_decimal(dy_raw) if dy_raw is not None else None

    return CachedPriceData(
        symbol=str(row["symbol"]),
        currency=str(row["currency"]),
        price=price,
        dividend_yield=dividend_yield,
        refreshed_at=row["refreshed_at"],
    )
