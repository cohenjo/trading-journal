"""Unit tests for the queued backtest worker handler."""

from __future__ import annotations

from types import TracebackType
from typing import Any

import pytest

from app.worker import backtest_handler


class FakeScalarResult:
    """Minimal scalar result returned by the fake DB session."""

    def scalar_one(self) -> str:
        """Return the inserted run id."""

        return "20000000-0000-0000-0000-000000000001"


class FakeSession:
    """Capture SQL parameters for backtest_runs insert assertions."""

    def __init__(self) -> None:
        self.executions: list[dict[str, Any]] = []
        self.committed = False

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc_value: BaseException | None, traceback: TracebackType | None
    ) -> bool:
        return False

    def execute(self, statement: object, params: dict[str, Any]) -> FakeScalarResult:
        """Record the insert call and mimic SQLAlchemy's scalar result."""

        self.executions.append({"sql": str(statement), "params": params})
        return FakeScalarResult()

    def commit(self) -> None:
        """Record that the handler committed the result row."""

        self.committed = True


def test_run_backtest_job_writes_result_row(monkeypatch: pytest.MonkeyPatch) -> None:
    """The handler stores config/result JSON and returns the backtest run id."""

    fake_session = FakeSession()

    def fake_run_service(request: backtest_handler.BacktestJobRequest) -> dict[str, Any]:
        return {
            "year": request.year,
            "initial_capital": 100000.0,
            "final_equity": 101250.5,
            "realized_pnl": 1200.25,
            "unrealized_pnl": 50.25,
            "trades": [
                {
                    "date": "2026-01-02T00:00:00",
                    "action": "BUY",
                    "symbol": "NDX",
                    "quantity": 1,
                    "price": 100.12,
                    "commission": 1.0,
                    "equity": 99998.88,
                    "conid": 123,
                    "realized_pnl": 0.0,
                }
            ],
            "metrics": {"sharpe_ratio": 1.5},
        }

    monkeypatch.setattr(backtest_handler, "_run_service", fake_run_service)
    monkeypatch.setattr(backtest_handler, "_default_session_factory", lambda: fake_session)
    result = backtest_handler.run_backtest_job(
        {
            "household_id": "10000000-0000-0000-0000-000000000001",
            "compute_job_id": "00000000-0000-0000-0000-000000000001",
            "config": {
                "year": 2026,
                "initial_capital": "100000",
                "step_days": 7,
                "underlying": "ndx",
                "leap_underlying": "qqq",
                "strategy": "iron_condor",
            },
        }
    )
    assert result == {"backtest_run_id": "20000000-0000-0000-0000-000000000001"}
    assert fake_session.committed is True
    params = fake_session.executions[0]["params"]
    assert params["household_id"] == "10000000-0000-0000-0000-000000000001"
    assert params["compute_job_id"] == "00000000-0000-0000-0000-000000000001"
    assert '"initial_capital": "100000"' in params["config"]
    assert '"final_equity": "101250.5"' in params["result"]
    assert '"equity_curve": [{"date": "2026-01-02T00:00:00", "equity": "99998.88"}]' in params["result"]


def test_run_backtest_job_reraises_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    """Handler failures propagate so the queue can mark the job failed."""

    def fake_run_service(_request: backtest_handler.BacktestJobRequest) -> dict[str, Any]:
        raise RuntimeError("service unavailable")

    monkeypatch.setattr(backtest_handler, "_run_service", fake_run_service)
    with pytest.raises(RuntimeError, match="service unavailable"):
        backtest_handler.run_backtest_job(
            {
                "household_id": "10000000-0000-0000-0000-000000000001",
                "compute_job_id": "00000000-0000-0000-0000-000000000001",
                "config": {"year": 2026},
            }
        )
