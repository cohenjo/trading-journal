"""Tests for the scheduled trading sync worker."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterator

import pytest
from sqlmodel import Session, select

from app.schema.trading_models import TradingAccountConfig, TradingAccountSummary, TradingPosition
from app.services import trading_batch
from app.services.trading_service import trading_service
from app.worker.registry import JOB_SCHEDULES
from conftest import TEST_HOUSEHOLD_ID


@dataclass
class SummaryItem:
    """Minimal IB account summary row fixture."""

    tag: str
    value: str
    currency: str = "USD"


@dataclass
class Contract:
    """Minimal IB contract fixture."""

    symbol: str
    secType: str
    conId: int


@dataclass
class Position:
    """Minimal IB position fixture."""

    contract: Contract
    position: str
    avgCost: str


class FakeIB:
    """Small async-compatible IB client fake."""

    def __init__(self) -> None:
        self.connected = False
        self.positions_payload = [Position(Contract("AAPL", "STK", 265598), "3", "150.25")]

    def isConnected(self) -> bool:
        """Return connection state."""

        return self.connected

    async def connectAsync(self, *_args: object, **_kwargs: object) -> None:
        """Mark the fake as connected."""

        self.connected = True

    def disconnect(self) -> None:
        """Mark the fake as disconnected."""

        self.connected = False

    def managedAccounts(self) -> list[str]:
        """Return one fake IB managed account."""

        return ["U1234567"]

    async def accountSummaryAsync(self) -> list[SummaryItem]:
        """Return deterministic account summary data."""

        return [
            SummaryItem("NetLiquidation", "1000.12"),
            SummaryItem("TotalCashValue", "200.34"),
        ]

    def positions(self) -> list[Position]:
        """Return deterministic positions."""

        return self.positions_payload

    async def reqExecutionsAsync(self, _exec_filter: object) -> list[object]:
        """Return no executions for these tests."""

        return []


@contextmanager
def session_context(session: Session) -> Iterator[Session]:
    """Yield the existing SQLModel session without closing it."""

    yield session


def test_trading_sync_schedule_registered() -> None:
    """The worker registers a 15-minute trading_sync interval job."""

    schedule = next((job for job in JOB_SCHEDULES if job.job_id == "trading_sync"), None)

    assert schedule is not None
    assert schedule.kind == "interval"
    assert schedule.seconds == 15 * 60
    assert schedule.handler is trading_batch.run_trading_sync_batch


@pytest.mark.asyncio
async def test_trading_sync_skips_when_ib_gateway_offline(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    """The batch logs and exits without touching IB when the TCP probe fails."""

    monkeypatch.setattr(trading_batch, "is_ib_gateway_available", lambda *_args, **_kwargs: False)

    result = await trading_batch.run_trading_sync_batch_async(session_factory=lambda: session_context(session))

    assert result["status"] == "skipped"
    assert session.exec(select(TradingAccountSummary)).all() == []


@pytest.mark.asyncio
async def test_trading_sync_upserts_positions_on_success(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    """A reachable IB Gateway sync refreshes summary/config freshness and replaces positions."""

    fake_ib = FakeIB()
    original_ib = trading_service.ib
    trading_service.ib = fake_ib  # type: ignore[assignment]
    monkeypatch.setattr(trading_batch, "is_ib_gateway_available", lambda *_args, **_kwargs: True)
    session.add(
        TradingAccountConfig(
            name="IBKR Paper",
            account_type="IBKR",
            host="127.0.0.1",
            port=4002,
            client_id=7,
            household_id=TEST_HOUSEHOLD_ID,
        )
    )
    session.commit()

    try:
        first = await trading_batch.run_trading_sync_batch_async(session_factory=lambda: session_context(session))
        fake_ib.positions_payload = [Position(Contract("AAPL", "STK", 265598), "5", "151.00")]
        second = await trading_batch.run_trading_sync_batch_async(session_factory=lambda: session_context(session))
    finally:
        trading_service.ib = original_ib

    config = session.exec(select(TradingAccountConfig)).one()
    positions = session.exec(select(TradingPosition)).all()
    summaries = session.exec(select(TradingAccountSummary)).all()

    assert first["status"] == "success"
    assert second["status"] == "success"
    assert config.account_id == "U1234567"
    assert config.last_synced_at is not None
    assert len(summaries) == 2
    assert summaries[-1].net_liquidation == Decimal("1000.12")
    assert len(positions) == 1
    assert positions[0].symbol == "AAPL"
    assert positions[0].amount == Decimal("5")
    assert positions[0].avg_cost == Decimal("151.00")
