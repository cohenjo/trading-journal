"""Tests for scheduled analyze batch jobs."""

from __future__ import annotations

from contextlib import AbstractContextManager
from types import TracebackType
from typing import Any
from uuid import UUID

import pytest

from app.services import analyze_batch
from app.services.analyze_batch import AnalyzeBatchRefresher, TickerInput
from app.worker import analyze_schedules
from app.worker.registry import JOB_SCHEDULES


class FakeMappings:
    """Result wrapper that mimics SQLAlchemy's mappings API."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> "FakeMappings":
        return self

    def first(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def __iter__(self):
        return iter(self.rows)


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal SQLAlchemy session fake for batch assertions."""

    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []
        self.executions: list[dict[str, Any]] = []
        self.committed = False

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> FakeMappings:
        sql = str(statement)
        self.executions.append({"sql": sql, "params": params or {}})
        if "from public.trading_positions" in sql:
            return FakeMappings(self.rows)
        return FakeMappings([])

    def commit(self) -> None:
        self.committed = True


def test_analyze_schedules_register_daily_crons() -> None:
    """The worker registry includes both TJ-020 daily analyze schedules."""

    schedule_by_id = {schedule.job_id: schedule for schedule in JOB_SCHEDULES}

    assert schedule_by_id[analyze_schedules.ANALYZE_TICKERS_JOB_ID].cron_expr == "0 3 * * *"
    assert schedule_by_id[analyze_schedules.ANALYZE_GROWTH_STORIES_JOB_ID].cron_expr == "30 3 * * *"


def test_refresh_specific_ticker_upserts_mocked_yfinance(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fake ticker run writes one idempotent analysis_tickers upsert."""

    session = FakeSession()

    async def fake_build_ticker_analysis(ticker: str) -> dict[str, Any]:
        return {"ticker": ticker, "sections": {"fundamentals": {"ticker": ticker, "market_cap": "123.45"}}}

    monkeypatch.setattr(analyze_batch, "build_ticker_analysis", fake_build_ticker_analysis)

    refresher = AnalyzeBatchRefresher(session_factory=lambda: session)  # type: ignore[arg-type]
    refreshed = refresher.refresh_specific_tickers(
        session,
        [TickerInput(ticker="MSFT", household_id=UUID("00000000-0000-0000-0000-000000000101"))],
    )

    assert refreshed == 1
    upsert = session.executions[-1]
    assert "insert into public.analysis_tickers" in upsert["sql"]
    assert "on conflict (household_scope, ticker) do update" in upsert["sql"]
    assert upsert["params"]["ticker"] == "MSFT"
    assert '"market_cap": "123.45"' in upsert["params"]["data"]


def test_refresh_ticker_analyses_skips_failed_ticker(monkeypatch: pytest.MonkeyPatch) -> None:
    """One failing yfinance ticker is logged and skipped without aborting the batch."""

    household_id = UUID("00000000-0000-0000-0000-000000000101")
    session = FakeSession(
        [
            {"ticker": "GOOD", "household_id": household_id},
            {"ticker": "BAD", "household_id": household_id},
        ]
    )

    async def fake_build_ticker_analysis(ticker: str) -> dict[str, Any]:
        if ticker == "BAD":
            raise RuntimeError("yfinance down")
        return {"ticker": ticker, "sections": {}}

    monkeypatch.setattr(analyze_batch, "build_ticker_analysis", fake_build_ticker_analysis)

    refreshed = AnalyzeBatchRefresher(session_factory=lambda: session).refresh_ticker_analyses()  # type: ignore[arg-type]

    assert refreshed == 1
    assert session.committed is True
    assert sum("insert into public.analysis_tickers" in call["sql"] for call in session.executions) == 1
