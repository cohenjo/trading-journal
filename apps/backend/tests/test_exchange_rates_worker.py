"""Tests for periodic exchange-rates refresh worker."""

from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from app.services.exchange_rates import ExchangeRatesRefresher, FXRate
from app.worker.registry import JOB_SCHEDULES
from app.worker.runtime import start_worker  # noqa: F401 - ensures schedules are registered


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal session fake for testing exchange rate upserts."""

    def __init__(self) -> None:
        self.executions: list[dict[str, Any]] = []
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> None:
        self.executions.append({"sql": str(statement), "params": params or {}})

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def test_exchange_rates_worker_registered():
    """Verify exchange_rates_refresh job is present in JOB_SCHEDULES with 24h interval."""
    job = next((s for s in JOB_SCHEDULES if s.job_id == "exchange_rates_refresh"), None)
    assert job is not None
    assert job.kind == "interval"
    assert job.seconds == 24 * 60 * 60


def test_exchange_rates_refresher_upserts_rates():
    """Verify refresher executes upserts for ILS + all target currencies."""
    fake_session = FakeSession()

    def fake_fetcher(pair_symbol: str, target_currency: str) -> FXRate:
        rates = {"USD": Decimal("3.12"), "EUR": Decimal("3.42"), "GBP": Decimal("4.05")}
        return FXRate(
            currency=target_currency,
            rate_to_ils=rates[target_currency],
            as_of=datetime.now(UTC),
        )

    refresher = ExchangeRatesRefresher(
        session_factory=lambda: fake_session,
        rate_fetcher=fake_fetcher,
    )
    result = refresher.refresh_once()

    assert result["failed"] == 0
    assert result["refreshed"] == 4  # ILS + USD + EUR + GBP
    assert fake_session.commits == 4

    upserted_currencies = {
        exec_item["params"]["currency"] for exec_item in fake_session.executions if "currency" in exec_item["params"]
    }
    assert upserted_currencies == {"ILS", "USD", "EUR", "GBP"}


def test_exchange_rates_refresher_handles_single_ticker_failure():
    """Verify a failure on one FX ticker isolates and does not abort the remaining."""
    fake_session = FakeSession()

    def failing_fetcher(pair_symbol: str, target_currency: str) -> FXRate:
        if target_currency == "GBP":
            raise RuntimeError("Yahoo down for GBP")
        return FXRate(currency=target_currency, rate_to_ils=Decimal("3.12"), as_of=datetime.now(UTC))

    refresher = ExchangeRatesRefresher(
        session_factory=lambda: fake_session,
        rate_fetcher=failing_fetcher,
    )
    result = refresher.refresh_once()

    assert result["failed"] == 1
    assert result["refreshed"] == 3  # ILS + USD + EUR succeeded
    assert fake_session.rollbacks == 1
