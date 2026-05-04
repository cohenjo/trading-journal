"""Worker handler that rebuilds monthly options-income dashboard metrics."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.options.metrics import OptionMetricRoll, OptionMetricTrade, compute_monthly_metrics

JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], AbstractContextManager[Session]]


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session."""

    return Session(engine)


def handle_compute_options_monthly_metrics(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Rebuild options dashboard monthly rows for one or more accounts."""

    with (session_factory or _default_session_factory)() as session:
        result = compute_options_monthly_metrics(
            session,
            household_id=_optional_str(payload.get("household_id")),
            account_id=_optional_str(payload.get("account_id")),
            from_date=_optional_date(payload.get("from")),
            to_date=_optional_date(payload.get("to")),
        )
        session.commit()
        return result


def compute_options_monthly_metrics(
    session: Session,
    *,
    household_id: str | None = None,
    account_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> JobResult:
    """Aggregate normalized trade facts and replace affected monthly rows."""

    accounts = _metric_accounts(session, household_id=household_id, account_id=account_id)
    output: dict[str, Any] = {"accounts": [], "row_count": 0}
    for account in accounts:
        rows = _load_trade_facts(session, account["household_id"], account["account_id"], from_date, to_date)
        rolls = _load_roll_facts(session, account["household_id"], account["account_id"], from_date, to_date)
        metrics = compute_monthly_metrics(rows, rolls)
        if metrics:
            start = metrics[0].period_start
            end = metrics[-1].period_start
            session.execute(
                text(
                    """
                    delete from public.options_dashboard_monthly
                     where household_id = :household_id
                       and account_id = :account_id
                       and period_start between :start and :end
                    """
                ),
                {
                    "household_id": account["household_id"],
                    "account_id": account["account_id"],
                    "start": start,
                    "end": end,
                },
            )
            for metric in metrics:
                session.execute(
                    text(
                        """
                        insert into public.options_dashboard_monthly (
                          household_id, account_id, period_start, period_end,
                          cash_flow_total, realized_pnl_total,
                          cash_flow_cumulative, realized_pnl_cumulative,
                          variance_gap, variance_gap_cumulative, trade_count,
                          roll_count, roll_positive_count, roll_negative_count,
                          roll_neutral_count, roll_efficiency_pct, last_computed_at
                        ) values (
                          :household_id, :account_id, :period_start, :period_end,
                          :cash_flow_total, :realized_pnl_total,
                          :cash_flow_cumulative, :realized_pnl_cumulative,
                          :variance_gap, :variance_gap_cumulative, :trade_count,
                          :roll_count, :roll_positive_count, :roll_negative_count,
                          :roll_neutral_count, :roll_efficiency_pct, now()
                        )
                        """
                    ),
                    {
                        "household_id": account["household_id"],
                        "account_id": account["account_id"],
                        **metric.model_dump(),
                    },
                )
        output["accounts"].append(
            {
                "household_id": account["household_id"],
                "account_id": account["account_id"],
                "months": len(metrics),
                "cash_flow_total": str(sum((m.cash_flow_total for m in metrics), Decimal("0"))),
                "realized_pnl_total": str(sum((m.realized_pnl_total for m in metrics), Decimal("0"))),
                "variance_gap_cumulative": str(metrics[-1].variance_gap_cumulative if metrics else Decimal("0")),
                "roll_count": sum(m.roll_count for m in metrics),
                "roll_positive_count": sum(m.roll_positive_count for m in metrics),
                "roll_negative_count": sum(m.roll_negative_count for m in metrics),
                "roll_neutral_count": sum(m.roll_neutral_count for m in metrics),
                "roll_efficiency_pct": str(
                    (
                        Decimal(sum(m.roll_positive_count for m in metrics))
                        / Decimal(sum(m.roll_count for m in metrics))
                        * Decimal("100")
                    ).quantize(Decimal("0.01"))
                    if sum(m.roll_count for m in metrics)
                    else Decimal("0.00")
                ),
            }
        )
        output["row_count"] += len(metrics)
    return output


def _metric_accounts(session: Session, *, household_id: str | None, account_id: str | None) -> list[dict[str, str]]:
    where = ["1=1"]
    params: dict[str, Any] = {}
    if household_id:
        where.append("household_id = :household_id")
        params["household_id"] = household_id
    if account_id:
        where.append("account_id = :account_id")
        params["account_id"] = account_id
    rows = session.execute(
        text(
            f"""
            select distinct household_id::text as household_id, account_id
              from public.options_trades
             where {" and ".join(where)}
             order by account_id
            """
        ),
        params,
    ).mappings()
    return [{"household_id": str(row["household_id"]), "account_id": str(row["account_id"])} for row in rows]


def _load_trade_facts(
    session: Session,
    household_id: str,
    account_id: str,
    from_date: date | None,
    to_date: date | None,
) -> list[OptionMetricTrade]:
    where = ["household_id = :household_id", "account_id = :account_id"]
    params: dict[str, Any] = {"household_id": household_id, "account_id": account_id}
    if from_date:
        where.append("trade_date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        where.append("trade_date <= :to_date")
        params["to_date"] = to_date
    rows = session.execute(
        text(
            f"""
            select trade_date, net_cash_flow, realized_pnl, 1 as trade_count
              from public.options_trades
             where {" and ".join(where)}
            union all
            select event_date as trade_date, amount as net_cash_flow, 0::numeric as realized_pnl, 0 as trade_count
              from public.options_cash_events
             where {" and ".join(where).replace("trade_date", "event_date")}
               and event_category = 'option_related'
             order by trade_date
            """
        ),
        params,
    ).mappings()
    return [
        OptionMetricTrade(
            trade_date=row["trade_date"],
            net_cash_flow=Decimal(str(row["net_cash_flow"])),
            realized_pnl=Decimal(str(row["realized_pnl"])),
            trade_count=int(row["trade_count"]),
        )
        for row in rows
    ]


def _load_roll_facts(
    session: Session,
    household_id: str,
    account_id: str,
    from_date: date | None,
    to_date: date | None,
) -> list[OptionMetricRoll]:
    where = ["r.household_id = :household_id", "r.account_id = :account_id", "r.detection_status != 'rejected'"]
    params: dict[str, Any] = {"household_id": household_id, "account_id": account_id}
    if from_date:
        where.append("t.trade_date >= :from_date")
        params["from_date"] = from_date
    if to_date:
        where.append("t.trade_date <= :to_date")
        params["to_date"] = to_date
    rows = session.execute(
        text(
            f"""
            select t.trade_date as detected_date, r.classification::text as classification
              from public.options_roll_events r
              join public.options_trades t on t.id = r.closed_trade_id
             where {" and ".join(where)}
             order by t.trade_date, r.id
            """
        ),
        params,
    ).mappings()
    return [
        OptionMetricRoll(detected_date=row["detected_date"], classification=str(row["classification"])) for row in rows
    ]


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return date.fromisoformat(value)
