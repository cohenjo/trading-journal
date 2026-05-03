"""Compute-job handler for on-demand backtest runs."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import logging
from typing import Any, cast
from uuid import UUID

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.backtest_service import BacktestService

logger = logging.getLogger(__name__)

JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], Session]
MONETARY_KEYS = frozenset(
    {
        "avg_price",
        "cash",
        "commission",
        "equity",
        "final_equity",
        "initial_capital",
        "price",
        "realized_pnl",
        "strike",
        "total_realized_pnl",
        "total_unrealized_pnl",
        "unrealized_pnl",
    }
)


@dataclass(frozen=True)
class BacktestJobRequest:
    """Validated payload for a queued backtest job."""

    household_id: UUID
    compute_job_id: UUID
    config: dict[str, Any]
    year: int
    initial_capital: Decimal
    step_days: int
    underlying: str
    leap_underlying: str
    strategy: str


def run_backtest_job(payload: JobPayload) -> JobResult:
    """Run a queued backtest, persist its result row, and return the run id."""

    try:
        request = _parse_payload(payload)
        started_at = datetime.now(timezone.utc)
        result = _normalize_backtest_result(_run_service(request))
        finished_at = datetime.now(timezone.utc)
        run_id = _insert_backtest_run(request, result, started_at, finished_at)
        return {"backtest_run_id": run_id}
    except Exception:
        logger.exception("Backtest compute job failed")
        raise


def _default_session_factory() -> Session:
    """Return a database session for handler writes."""

    return Session(engine)


def _run_service(request: BacktestJobRequest) -> dict[str, Any]:
    """Execute the existing async backtest service from the sync worker."""

    service = BacktestService()
    return asyncio.run(
        service.run_backtest(
            request.year,
            float(request.initial_capital),
            request.step_days,
            request.underlying,
            request.leap_underlying,
            request.strategy,
        )
    )


def _insert_backtest_run(
    request: BacktestJobRequest,
    result: dict[str, Any],
    started_at: datetime,
    finished_at: datetime,
    session_factory: SessionFactory | None = None,
) -> str:
    """Insert the queue result row and return its UUID."""

    factory = session_factory or _default_session_factory
    with factory() as session:
        row = session.execute(
            text("""
                insert into public.backtest_runs (household_id, compute_job_id, config, result, started_at, finished_at)
                values (:household_id, :compute_job_id, cast(:config as jsonb), cast(:result as jsonb), :started_at, :finished_at)
                returning id
                """),
            {
                "household_id": str(request.household_id),
                "compute_job_id": str(request.compute_job_id),
                "config": json.dumps(_normalize_for_json(request.config), default=str),
                "result": json.dumps(result, default=str),
                "started_at": started_at,
                "finished_at": finished_at,
            },
        ).scalar_one()
        session.commit()
        return str(row)


def _parse_payload(payload: JobPayload) -> BacktestJobRequest:
    """Validate and coerce queue payload into backtest service arguments."""

    household_id = _parse_uuid(payload.get("household_id"), "household_id")
    compute_job_id = _parse_uuid(payload.get("compute_job_id"), "compute_job_id")
    config_value = payload.get("config")
    if not isinstance(config_value, dict):
        raise ValueError("Backtest job payload must include a config object.")
    config = cast(dict[str, Any], config_value)
    year = _parse_int(config.get("year", date.today().year), "year")
    if year < 2018 or year > date.today().year:
        raise ValueError("Backtest year must be between 2018 and the current year.")
    step_days = _parse_int(config.get("step_days", 1), "step_days")
    if step_days < 1 or step_days > 31:
        raise ValueError("Backtest step_days must be between 1 and 31.")
    initial_capital = _parse_decimal(config.get("initial_capital", "100000"), "initial_capital")
    if initial_capital <= 0:
        raise ValueError("Backtest initial_capital must be positive.")
    underlying = _parse_symbol(config.get("underlying", "NDX"), "underlying")
    leap_underlying = _parse_symbol(config.get("leap_underlying", underlying), "leap_underlying")
    strategy = _parse_symbol(config.get("strategy", "IRON_CONDOR"), "strategy")
    normalized_config = {
        **config,
        "year": year,
        "initial_capital": str(initial_capital),
        "step_days": step_days,
        "underlying": underlying,
        "leap_underlying": leap_underlying,
        "strategy": strategy,
    }
    return BacktestJobRequest(
        household_id,
        compute_job_id,
        normalized_config,
        year,
        initial_capital,
        step_days,
        underlying,
        leap_underlying,
        strategy,
    )


def _normalize_backtest_result(result: dict[str, Any]) -> dict[str, Any]:
    """Make the service result JSON-safe with monetary values as strings."""

    normalized = cast(dict[str, Any], _normalize_for_json(result))
    trades = normalized.get("trades")
    if isinstance(trades, list):
        normalized["equity_curve"] = [
            {"date": trade["date"], "equity": trade["equity"]}
            for trade in trades
            if isinstance(trade, dict) and "date" in trade and "equity" in trade
        ]
    else:
        normalized["trades"] = []
        normalized["equity_curve"] = []
    return normalized


def _normalize_for_json(value: Any, key: str | None = None) -> Any:
    """Recursively convert dates and Decimals into stable JSON values."""

    if isinstance(value, dict):
        return {str(item_key): _normalize_for_json(item_value, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, list | tuple):
        return [_normalize_for_json(item, key) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if key in MONETARY_KEYS and isinstance(value, int | float | str):
        try:
            return str(Decimal(str(value)))
        except InvalidOperation:
            return value
    return value


def _parse_uuid(value: object, field_name: str) -> UUID:
    if not isinstance(value, str):
        raise ValueError(f"Backtest job payload must include {field_name}.")
    try:
        return UUID(value)
    except ValueError as exc:
        raise ValueError(f"Backtest job payload has invalid {field_name}.") from exc


def _parse_int(value: object, field_name: str) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Backtest config has invalid {field_name}.") from exc


def _parse_decimal(value: object, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"Backtest config has invalid {field_name}.") from exc


def _parse_symbol(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Backtest config has invalid {field_name}.")
    return value.strip().upper()
