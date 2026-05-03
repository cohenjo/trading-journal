"""Tests for scheduled NDX market data synchronization."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pandas as pd
from sqlmodel import Session, select

from app.schema.models import Ndx1m
from app.utils.ndx_data import NDX_SYMBOL, sync_ndx_data
from app.worker.ndx_daily_sync import NDX_DAILY_SYNC_CRON, NDX_DAILY_SYNC_JOB_ID, sync_ndx_daily_job
from app.worker.registry import JOB_SCHEDULES


class FakeTicker:
    """Minimal yfinance ticker fake for deterministic history responses."""

    def __init__(self, frame: pd.DataFrame | None = None, exc: Exception | None = None) -> None:
        self.frame = frame
        self.exc = exc

    def history(self, **_kwargs: Any) -> pd.DataFrame:
        """Return the configured frame or raise the configured exception."""

        if self.exc is not None:
            raise self.exc
        assert self.frame is not None
        return self.frame


def _history(close: str) -> pd.DataFrame:
    """Build one yfinance-style OHLCV row."""

    return pd.DataFrame(
        [
            {
                "Open": "100.125",
                "High": "101.250",
                "Low": "99.750",
                "Close": close,
                "Volume": 12345,
            }
        ],
        index=pd.DatetimeIndex(["2026-05-04T13:30:00"]),
    )


def test_sync_ndx_data_upserts_decimal_rows(engine) -> None:
    """NDX sync writes Decimal prices and updates existing timestamp rows."""

    seen_symbols: list[str] = []

    def ticker_factory(symbol: str) -> FakeTicker:
        seen_symbols.append(symbol)
        return FakeTicker(_history("100.500"))

    result = sync_ndx_data(
        "2026-05-04",
        ticker_factory=ticker_factory,
        session_factory=lambda: Session(engine),
    )

    assert result == {"status": "success", "rows": 1, "date": "2026-05-04"}
    assert seen_symbols == [NDX_SYMBOL]

    with Session(engine) as session:
        row = session.exec(select(Ndx1m)).one()
        assert row.open == Decimal("100.125000")
        assert row.close == Decimal("100.500000")

    sync_ndx_data(
        "2026-05-04",
        ticker_factory=lambda _symbol: FakeTicker(_history("102.750")),
        session_factory=lambda: Session(engine),
    )

    with Session(engine) as session:
        rows = session.exec(select(Ndx1m)).all()
        assert len(rows) == 1
        assert rows[0].close == Decimal("102.750000")


def test_sync_ndx_data_skips_and_logs_yfinance_errors(engine, caplog) -> None:
    """Provider errors are skipped so scheduler runs do not crash."""

    result = sync_ndx_data(
        "2026-05-04",
        ticker_factory=lambda _symbol: FakeTicker(exc=RuntimeError("provider down")),
        session_factory=lambda: Session(engine),
    )

    assert result["status"] == "skipped"
    assert result["rows"] == 0
    assert result["error"] == "provider down"
    assert "Skipping NDX sync" in caplog.text

    with Session(engine) as session:
        assert session.exec(select(Ndx1m)).all() == []


def test_ndx_daily_sync_schedule_is_registered() -> None:
    """The worker registers the daily NDX cron schedule."""

    matches = [schedule for schedule in JOB_SCHEDULES if schedule.job_id == NDX_DAILY_SYNC_JOB_ID]

    assert len(matches) == 1
    assert matches[0].kind == "cron"
    assert matches[0].cron_expr == NDX_DAILY_SYNC_CRON
    assert matches[0].handler is sync_ndx_daily_job
