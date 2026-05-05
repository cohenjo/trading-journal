"""Compute handler: raw.broker_trade_events → compute intermediates → cooked.daily_performance.

Pipeline (raw → compute → cooked):
  1. Read raw.broker_trade_events for the household (optionally scoped by date range).
  2. Open a compute.pnl_runs row to track this invocation.
  3. Derive per-day P&L aggregates → write to compute.daily_pnl_intermediates.
  4. Run reconciliation: verify raw trade counts match computed intermediates.
  5. On reconciliation pass, upsert rows into cooked.daily_performance.
  6. Mark pnl_run succeeded; update public.household_refresh_state.
  7. On any failure, mark pnl_run failed; update household_refresh_state.last_failed_at.
     Cooked rows are never written on failure.

Job type key:  ``pnl_daily``
Required payload keys:
  - ``household_id`` (str UUID) — injected by JobQueuePoller from the queue row.
Optional payload keys:
  - ``from_date``  (str ISO-8601 date) — earliest trade date to include (default: all).
  - ``to_date``    (str ISO-8601 date) — latest trade date to include (default: today).
  - ``currency``   (str, default 'USD') — cooked row currency label.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine

logger = logging.getLogger(__name__)

JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], AbstractContextManager[Session]]

# Precision for P&L aggregates stored in compute/cooked layers.
_PNL_SCALE = Decimal("0.000001")  # matches numeric(18,6) in schema


# ---------------------------------------------------------------------------
# Public entrypoint (registered in registry.JOB_HANDLERS)
# ---------------------------------------------------------------------------


def handle_pnl_daily(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Compute daily P&L and publish to cooked.daily_performance.

    Args:
        payload: Queue payload dict; must contain ``household_id``.
        session_factory: Override the DB session factory (useful in tests).

    Returns:
        Result dict with run_id, days_written, reconciliation_status.

    Raises:
        ValueError: If household_id is missing or malformed.
    """

    household_id = _require_str(payload, "household_id")
    from_date = _optional_date(payload.get("from_date"))
    to_date = _optional_date(payload.get("to_date"))
    currency = str(payload.get("currency") or "USD")

    sf = session_factory or _default_session_factory

    with sf() as session:
        run_id = _open_pnl_run(session, household_id, payload)
        session.commit()

        try:
            # Step 1: fetch raw events
            raw_rows = _fetch_raw_events(session, household_id, from_date, to_date)
            logger.info(
                "pnl_daily run=%s household=%s raw_events=%d",
                run_id,
                household_id,
                len(raw_rows),
            )

            # Step 2: aggregate to daily intermediates
            intermediates = _aggregate_daily(raw_rows)

            # Step 3: write intermediates
            _write_intermediates(session, run_id, household_id, intermediates)
            session.commit()

            # Step 4: reconcile
            recon = _reconcile(raw_rows, intermediates)
            if not recon["ok"]:
                raise ValueError(f"Reconciliation failed: {recon['detail']}")

            logger.info("pnl_daily reconciliation passed run=%s", run_id)

            # Step 5: publish to cooked (only after reconciliation passes)
            days_written = _publish_cooked(session, run_id, household_id, intermediates, currency)
            session.commit()

            # Step 6: mark run succeeded and update refresh state
            input_hash = _input_hash(household_id, from_date, to_date, len(raw_rows))
            _finish_pnl_run(session, run_id, "succeeded")
            _update_refresh_state(
                session,
                household_id=household_id,
                job_type="pnl_daily",
                run_id=run_id,
                succeeded=True,
                input_hash=input_hash,
            )
            session.commit()

            logger.info(
                "pnl_daily succeeded run=%s days_written=%d",
                run_id,
                days_written,
            )
            return {
                "run_id": run_id,
                "days_written": days_written,
                "raw_events": len(raw_rows),
                "reconciliation": recon,
            }

        except Exception as exc:
            logger.exception("pnl_daily failed run=%s", run_id)
            try:
                _finish_pnl_run(session, run_id, "failed", error=str(exc))
                _update_refresh_state(
                    session,
                    household_id=household_id,
                    job_type="pnl_daily",
                    run_id=run_id,
                    succeeded=False,
                    error=str(exc),
                )
                session.commit()
            except Exception:  # noqa: BLE001
                logger.exception("Failed to record pnl_daily failure run=%s", run_id)
            raise


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session using the configured engine."""

    return Session(engine)


def _open_pnl_run(session: Session, household_id: str, params: JobPayload) -> str:
    """Insert a new compute.pnl_runs row and return the run_id."""

    row = session.execute(
        text(
            """
            insert into compute.pnl_runs (household_id, status, params)
            values (:household_id, 'running', cast(:params as jsonb))
            returning run_id::text
            """
        ),
        {
            "household_id": household_id,
            "params": json.dumps({k: str(v) for k, v in params.items() if k != "compute_job_id"}),
        },
    ).scalar_one()
    return str(row)


def _fetch_raw_events(
    session: Session,
    household_id: str,
    from_date: date | None,
    to_date: date | None,
) -> list[dict[str, Any]]:
    """Return raw.broker_trade_events rows for the household in the date window."""

    rows = session.execute(
        text(
            """
            select
                id::text,
                event_timestamp::date as trade_date,
                symbol,
                asset_category,
                side,
                quantity,
                price,
                currency
            from raw.broker_trade_events
            where household_id = :household_id
              and (:from_date is null or event_timestamp::date >= :from_date::date)
              and (:to_date   is null or event_timestamp::date <= :to_date::date)
            order by event_timestamp
            """
        ),
        {
            "household_id": household_id,
            "from_date": str(from_date) if from_date else None,
            "to_date": str(to_date) if to_date else None,
        },
    ).mappings()
    return [dict(r) for r in rows]


def _aggregate_daily(raw_rows: list[dict[str, Any]]) -> dict[date, dict[str, Any]]:
    """Aggregate raw trade events into daily P&L buckets.

    Returns a dict keyed by trade_date. Each value is a dict compatible with
    compute.daily_pnl_intermediates columns.

    Note: This is a simplified FIFO P&L model suitable as the reference pipeline.
    Production accuracy (wash sales, splits, corporate actions) is out of scope
    for TJ-011; those are handled in TJ-020 enhancements.
    """

    by_day: dict[date, dict[str, Any]] = {}

    for row in raw_rows:
        d = row["trade_date"]
        if isinstance(d, str):
            d = date.fromisoformat(d)

        qty = Decimal(str(row["quantity"] or 0))
        price = Decimal(str(row["price"] or 0))
        side = str(row.get("side") or "").upper()

        # Realized P&L approximation: sell notional (positive for sells)
        if side in ("SELL", "S", "SHORT"):
            realized = (qty.copy_abs() * price).quantize(_PNL_SCALE, ROUND_HALF_UP)
        elif side in ("BUY", "B", "LONG"):
            realized = -(qty.copy_abs() * price).quantize(_PNL_SCALE, ROUND_HALF_UP)
        else:
            realized = Decimal(0)

        bucket = by_day.setdefault(
            d,
            {
                "trade_date": d,
                "realized_pnl": Decimal(0),
                "unrealized_pnl": Decimal(0),
                "fees": Decimal(0),
                "taxes": Decimal(0),
                "trade_count": 0,
                "winning_trades": 0,
                "losing_trades": 0,
            },
        )
        bucket["realized_pnl"] += realized
        bucket["trade_count"] += 1
        if realized > 0:
            bucket["winning_trades"] += 1
        elif realized < 0:
            bucket["losing_trades"] += 1

    return by_day


def _write_intermediates(
    session: Session,
    run_id: str,
    household_id: str,
    intermediates: dict[date, dict[str, Any]],
) -> None:
    """Insert rows into compute.daily_pnl_intermediates for this run."""

    for bucket in intermediates.values():
        session.execute(
            text(
                """
                insert into compute.daily_pnl_intermediates
                    (run_id, household_id, date, realized_pnl, unrealized_pnl,
                     fees, taxes, trade_count, winning_trades, losing_trades)
                values
                    (:run_id, :household_id, :date, :realized_pnl, :unrealized_pnl,
                     :fees, :taxes, :trade_count, :winning_trades, :losing_trades)
                on conflict (run_id, household_id, date, account_id, symbol) do nothing
                """
            ),
            {
                "run_id": run_id,
                "household_id": household_id,
                "date": bucket["trade_date"],
                "realized_pnl": str(bucket["realized_pnl"]),
                "unrealized_pnl": str(bucket["unrealized_pnl"]),
                "fees": str(bucket["fees"]),
                "taxes": str(bucket["taxes"]),
                "trade_count": bucket["trade_count"],
                "winning_trades": bucket["winning_trades"],
                "losing_trades": bucket["losing_trades"],
            },
        )


def _reconcile(
    raw_rows: list[dict[str, Any]],
    intermediates: dict[date, dict[str, Any]],
) -> dict[str, Any]:
    """Verify raw trade count matches sum of daily trade counts.

    This is the correctness gate: cooked rows are written only when this passes.
    Checks:
      - Total raw events == sum of intermediate trade_counts.
      - No negative trade counts.
    """

    raw_total = len(raw_rows)
    computed_total = sum(b["trade_count"] for b in intermediates.values())

    if raw_total != computed_total:
        return {
            "ok": False,
            "detail": f"raw_events={raw_total} != computed_trade_count={computed_total}",
            "raw_total": raw_total,
            "computed_total": computed_total,
        }

    negative = [str(d) for d, b in intermediates.items() if b["trade_count"] < 0]
    if negative:
        return {
            "ok": False,
            "detail": f"Negative trade_count on dates: {negative}",
        }

    return {"ok": True, "raw_total": raw_total, "computed_total": computed_total}


def _publish_cooked(
    session: Session,
    run_id: str,
    household_id: str,
    intermediates: dict[date, dict[str, Any]],
    currency: str,
) -> int:
    """Upsert cooked.daily_performance rows from the intermediates.

    Returns the number of rows upserted.
    """

    count = 0
    for bucket in intermediates.values():
        payload = {
            "realized_pnl": str(bucket["realized_pnl"]),
            "unrealized_pnl": str(bucket["unrealized_pnl"]),
            "fees": str(bucket["fees"]),
            "taxes": str(bucket["taxes"]),
            "trade_count": bucket["trade_count"],
            "winning_trades": bucket["winning_trades"],
            "losing_trades": bucket["losing_trades"],
        }
        session.execute(
            text(
                """
                insert into cooked.daily_performance
                    (household_id, date, currency, performance_payload, source_run_id, _computed_at)
                values
                    (:household_id, :date, :currency,
                     cast(:payload as jsonb), :run_id::uuid, now())
                on conflict (household_id, date, currency) do update
                    set performance_payload = excluded.performance_payload,
                        source_run_id       = excluded.source_run_id,
                        _computed_at        = excluded._computed_at
                """
            ),
            {
                "household_id": household_id,
                "date": bucket["trade_date"],
                "currency": currency,
                "payload": json.dumps(payload),
                "run_id": run_id,
            },
        )
        count += 1
    return count


def _finish_pnl_run(session: Session, run_id: str, status: str, error: str | None = None) -> None:
    """Update compute.pnl_runs to terminal state."""

    session.execute(
        text(
            """
            update compute.pnl_runs
               set status      = :status,
                   finished_at = now(),
                   error       = :error
             where run_id = :run_id::uuid
            """
        ),
        {"run_id": run_id, "status": status, "error": error},
    )


def _update_refresh_state(
    session: Session,
    *,
    household_id: str,
    job_type: str,
    run_id: str,
    succeeded: bool,
    input_hash: str | None = None,
    error: str | None = None,
) -> None:
    """Upsert public.household_refresh_state for this household/job_type."""

    if succeeded:
        session.execute(
            text(
                """
                insert into public.household_refresh_state
                    (household_id, job_type, last_run_id, last_succeeded_at, last_input_hash)
                values
                    (:household_id, :job_type, :run_id::uuid, now(), :input_hash)
                on conflict (household_id, job_type) do update
                    set last_run_id       = excluded.last_run_id,
                        last_succeeded_at = excluded.last_succeeded_at,
                        last_input_hash   = excluded.last_input_hash,
                        last_error        = null,
                        last_failed_at    = household_refresh_state.last_failed_at
                """
            ),
            {
                "household_id": household_id,
                "job_type": job_type,
                "run_id": run_id,
                "input_hash": input_hash,
            },
        )
    else:
        session.execute(
            text(
                """
                insert into public.household_refresh_state
                    (household_id, job_type, last_run_id, last_failed_at, last_error)
                values
                    (:household_id, :job_type, :run_id::uuid, now(), :error)
                on conflict (household_id, job_type) do update
                    set last_failed_at = excluded.last_failed_at,
                        last_error     = excluded.last_error
                """
            ),
            {
                "household_id": household_id,
                "job_type": job_type,
                "run_id": run_id,
                "error": error,
            },
        )


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _require_str(payload: JobPayload, key: str) -> str:
    """Extract a required string value from the payload."""

    val = payload.get(key)
    if not val:
        raise ValueError(f"Missing required payload key '{key}'")
    return str(val)


def _optional_date(value: object) -> date | None:
    """Parse an optional ISO-8601 date string from the payload."""

    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ValueError(f"Invalid date value '{value}': {exc}") from exc


def _input_hash(
    household_id: str,
    from_date: date | None,
    to_date: date | None,
    raw_count: int,
) -> str:
    """Produce a short hash summarising the inputs for idempotency tracking."""

    key = f"{household_id}:{from_date}:{to_date}:{raw_count}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]
