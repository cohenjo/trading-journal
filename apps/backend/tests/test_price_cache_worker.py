"""Tests for TJ-020 scheduled price-cache refresh."""

from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from app.services.price_cache import PriceCacheRefresher, PriceQuote
from app.worker.registry import JOB_SCHEDULES
from app.worker.runtime import start_worker  # noqa: F401 - imports schedule registration


class FakeMappings:
    """Result wrapper that mimics SQLAlchemy's mappings() API."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        """Return mapping rows."""

        return self.rows


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal SQLAlchemy session fake for refresh assertions."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.executions: list[dict[str, Any]] = []
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        sql = str(statement)
        self.executions.append({"sql": sql, "params": params or {}})
        if "with referenced_symbols as" in sql:
            return FakeMappings(self.rows)
        return FakeMappings([])

    def commit(self) -> None:
        """Record a successful per-symbol commit."""

        self.commits += 1

    def rollback(self) -> None:
        """Record isolated per-symbol failure rollback."""

        self.rollbacks += 1


def test_prices_refresh_schedule_registered() -> None:
    """The backend worker registers the hourly price refresh interval."""

    schedule = next(s for s in JOB_SCHEDULES if s.job_id == "prices_refresh")
    assert schedule.kind == "interval"
    assert schedule.seconds == 60 * 60


def test_price_refresher_fetches_and_upserts_symbols() -> None:
    """The refresher loads referenced symbols, fetches prices, and upserts cache rows."""

    session = FakeSession(
        [
            {"symbol": "aapl", "currency": "usd"},
            {"symbol": "msft", "currency": "USD"},
        ]
    )
    seen_symbols: list[str] = []

    def fetcher(symbol: str) -> PriceQuote:
        seen_symbols.append(symbol)
        return PriceQuote(
            symbol=symbol,
            currency="USD",
            price=Decimal("123.45"),
            as_of=datetime(2026, 5, 3, 12, tzinfo=UTC),
        )

    refresher = PriceCacheRefresher(session_factory=lambda: session, price_fetcher=fetcher)

    result = refresher.refresh_once()

    assert result == {"symbols": 2, "refreshed": 2, "failed": 0}
    assert seen_symbols == ["AAPL", "MSFT"]
    upserts = [call for call in session.executions if "insert into public.price_cache" in call["sql"]]
    assert len(upserts) == 2
    assert upserts[0]["params"] == {
        "symbol": "AAPL",
        "currency": "USD",
        "price": Decimal("123.45"),
        "as_of": datetime(2026, 5, 3, 12, tzinfo=UTC),
    }
    assert "on conflict (symbol, currency) do update" in upserts[0]["sql"]
    assert session.commits == 2


def test_price_refresher_continues_after_symbol_failure() -> None:
    """External lookup failures are isolated per symbol."""

    session = FakeSession(
        [
            {"symbol": "bad", "currency": "USD"},
            {"symbol": "good", "currency": "USD"},
        ]
    )

    def fetcher(symbol: str) -> PriceQuote:
        if symbol == "BAD":
            raise RuntimeError("lookup failed")
        return PriceQuote(
            symbol=symbol,
            currency="USD",
            price=Decimal("10.00"),
            as_of=datetime(2026, 5, 3, 12, tzinfo=UTC),
        )

    refresher = PriceCacheRefresher(session_factory=lambda: session, price_fetcher=fetcher)

    result = refresher.refresh_once()

    assert result == {"symbols": 2, "refreshed": 1, "failed": 1}
    assert session.rollbacks == 1
    assert session.commits == 1
    assert any(call["params"].get("symbol") == "GOOD" for call in session.executions)
