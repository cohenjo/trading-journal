"""Tests for the scheduled bond scanner refresh worker."""

from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import date, datetime, timezone
from decimal import Decimal
from types import TracebackType
from typing import Any

from app.services.bond_scanner import BondScannerCandidate
from app.worker.bonds_scanner import BondScannerRefreshJob
from app.worker.registry import JOB_SCHEDULES


class FakeSession(AbstractContextManager["FakeSession"]):
    """Minimal session fake that captures worker upsert statements."""

    def __init__(self) -> None:
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

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> None:
        self.executions.append({"sql": str(statement), "params": params or {}})

    def commit(self) -> None:
        self.committed = True


def _candidate(symbol: str) -> BondScannerCandidate:
    return BondScannerCandidate(
        symbol=symbol,
        issuer=f"Issuer {symbol}",
        coupon_rate=Decimal("0.045"),
        maturity_date=date(2037, 6, 30),
        yield_to_maturity=Decimal("0.051"),
        rating="AA",
        currency="USD",
        price=Decimal("99.75"),
    )


def test_bonds_scanner_refresh_schedule_registered() -> None:
    """The worker registry includes the daily 04:00 Asia/Jerusalem batch."""

    schedule = next(item for item in JOB_SCHEDULES if item.job_id == "bonds_scanner_refresh")
    assert schedule.kind == "cron"
    assert schedule.cron_expr == "0 4 * * *"


def test_refresh_upserts_successful_symbols_and_skips_failed_fetches() -> None:
    """The batch writes successful fetches and keeps going after one symbol fails."""

    session = FakeSession()

    def fetcher(symbol: str) -> BondScannerCandidate:
        if symbol == "FAIL":
            raise RuntimeError("provider timeout")
        return _candidate(symbol)

    refreshed_at = datetime(2026, 5, 3, 1, 0, tzinfo=timezone.utc)
    job = BondScannerRefreshJob(
        symbols=("AAA", "FAIL", "BBB"),
        fetcher=fetcher,
        session_factory=lambda: session,
        clock=lambda: refreshed_at,
    )

    assert job.run() == 2
    assert session.committed is True
    assert [call["params"]["symbol"] for call in session.executions] == ["AAA", "BBB"]
    assert all("on conflict (symbol) do update" in call["sql"] for call in session.executions)
    assert '"yield_to_maturity": "0.051"' in session.executions[0]["params"]["data"]
    assert session.executions[0]["params"]["refreshed_at"] == refreshed_at
