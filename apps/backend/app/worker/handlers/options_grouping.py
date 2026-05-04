"""Worker handler that populates options strategy groups and roll events."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import date
from decimal import Decimal
import json
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.options.strategy_grouper import StrategyGroupingResult, StrategyTrade, group_option_strategies
from app.worker.handlers.options_sync import OptionsAccount, _load_accounts

JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], AbstractContextManager[Session]]


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session."""

    return Session(engine)


def handle_compute_options_strategy_groups(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Populate options strategy groups and roll events for one or more accounts."""

    with (session_factory or _default_session_factory)() as session:
        result = compute_options_strategy_groups(
            session,
            household_id=_optional_str(payload.get("household_id")),
            account_id=_optional_str(payload.get("account_id")),
            from_date=_optional_date(payload.get("from")),
            to_date=_optional_date(payload.get("to")),
        )
        session.commit()
        return result


def compute_options_strategy_groups(
    session: Session,
    *,
    household_id: str | None = None,
    account_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> JobResult:
    """Rebuild deterministic strategy grouping for enabled options accounts."""

    accounts = _grouping_accounts(session, household_id=household_id, account_id=account_id)
    output: dict[str, Any] = {"accounts": [], "group_count": 0, "roll_event_count": 0, "trade_count": 0}
    for account in accounts:
        trades = _load_strategy_trades(session, account.household_id, account.account_id, from_date, to_date)
        result = group_option_strategies(trades)
        _persist_grouping(session, result)
        output["accounts"].append(
            {
                "household_id": account.household_id,
                "account_id": account.account_id,
                "groups": len(result.groups),
                "roll_events": len(result.roll_events),
                "trades": len(result.trade_group_ids),
            }
        )
        output["group_count"] += len(result.groups)
        output["roll_event_count"] += len(result.roll_events)
        output["trade_count"] += len(result.trade_group_ids)
    return output


def _grouping_accounts(session: Session, *, household_id: str | None, account_id: str | None) -> list[OptionsAccount]:
    accounts = _load_accounts(session, account_id=account_id)
    if household_id:
        return [account for account in accounts if account.household_id == household_id]
    return accounts


def _load_strategy_trades(
    session: Session,
    household_id: str,
    account_id: str | None,
    from_date: date | None,
    to_date: date | None,
) -> list[StrategyTrade]:
    if account_id is None:
        return []
    where = ["t.household_id = :household_id", "t.account_id = :account_id"]
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
            select t.id::text as trade_id,
                   t.household_id::text as household_id,
                   t.account_id,
                   t.trade_time,
                   t.trade_date,
                   t.event_type::text as event_type,
                   t.side::text as side,
                   t.quantity,
                   t.net_cash_flow,
                   t.realized_pnl,
                   t.currency,
                   t.raw_payload ->> 'openCloseIndicator' as open_close_indicator,
                   l.underlying_symbol,
                   l."right"::text as right,
                   l.strike,
                   l.expiry,
                   l.multiplier
              from public.options_trades t
              join public.options_legs l on l.id = t.leg_id
             where {" and ".join(where)}
             order by t.trade_date, t.trade_time, t.id
            """
        ),
        params,
    ).mappings()
    return [
        StrategyTrade(
            trade_id=str(row["trade_id"]),
            household_id=str(row["household_id"]),
            account_id=str(row["account_id"]),
            trade_time=row["trade_time"],
            trade_date=row["trade_date"],
            event_type=str(row["event_type"]),
            side=str(row["side"]),
            open_close_indicator=str(row["open_close_indicator"] or "") or None,
            quantity=Decimal(str(row["quantity"])),
            net_cash_flow=Decimal(str(row["net_cash_flow"])),
            realized_pnl=Decimal(str(row["realized_pnl"])),
            currency=str(row["currency"]),
            underlying_symbol=str(row["underlying_symbol"]),
            right=str(row["right"]),
            strike=Decimal(str(row["strike"])),
            expiry=row["expiry"],
            multiplier=Decimal(str(row["multiplier"])),
        )
        for row in rows
    ]


def _persist_grouping(session: Session, result: StrategyGroupingResult) -> None:
    for group in result.groups:
        session.execute(
            text(
                """
                insert into public.options_strategy_groups (
                  id, household_id, account_id, underlying_symbol, kind, status, opened_at, closed_at,
                  net_cash_flow, realized_pnl, capital_at_risk_open, risk_calculation_method, metadata
                ) values (
                  :id, :household_id, :account_id, :underlying_symbol, :kind, :status, :opened_at, :closed_at,
                  :net_cash_flow, :realized_pnl, :capital_at_risk_open, :risk_calculation_method, cast(:metadata as jsonb)
                )
                on conflict (id) do update set
                  underlying_symbol = excluded.underlying_symbol,
                  kind = excluded.kind,
                  status = excluded.status,
                  opened_at = excluded.opened_at,
                  closed_at = excluded.closed_at,
                  net_cash_flow = excluded.net_cash_flow,
                  realized_pnl = excluded.realized_pnl,
                  capital_at_risk_open = excluded.capital_at_risk_open,
                  risk_calculation_method = excluded.risk_calculation_method,
                  metadata = excluded.metadata,
                  updated_at = now()
                """
            ),
            {
                "id": group.group_id,
                "household_id": group.household_id,
                "account_id": group.account_id,
                "underlying_symbol": group.underlying_symbol,
                "kind": group.kind,
                "status": group.status,
                "opened_at": group.opened_at,
                "closed_at": group.closed_at,
                "net_cash_flow": group.net_cash_flow,
                "realized_pnl": group.realized_pnl,
                "capital_at_risk_open": group.capital_at_risk_open,
                "risk_calculation_method": group.risk_calculation_method,
                "metadata": _json(group.metadata),
            },
        )
        session.execute(
            text("delete from public.options_strategy_capital_history where group_id = :group_id"),
            {"group_id": group.group_id},
        )
    for history in result.capital_history:
        session.execute(
            text(
                """
                insert into public.options_strategy_capital_history (
                  group_id, effective_at, capital_at_risk, risk_calculation_method
                ) values (
                  :group_id, :effective_at, :capital_at_risk, :risk_calculation_method
                )
                on conflict on constraint options_strategy_capital_history_group_effective_key do update set
                  capital_at_risk = excluded.capital_at_risk,
                  risk_calculation_method = excluded.risk_calculation_method,
                  updated_at = now()
                """
            ),
            {
                "group_id": history.group_id,
                "effective_at": history.effective_at,
                "capital_at_risk": history.capital_at_risk,
                "risk_calculation_method": history.risk_calculation_method,
            },
        )
    for trade_id, group_id in result.trade_group_ids.items():
        session.execute(
            text(
                "update public.options_trades set strategy_group_id = :group_id, updated_at = now() where id = :trade_id"
            ),
            {"group_id": group_id, "trade_id": trade_id},
        )
    for roll in result.roll_events:
        session.execute(
            text(
                """
                insert into public.options_roll_events (
                  household_id, account_id, strategy_group_id, closed_trade_id, opened_trade_id,
                  classification, closed_leg_realized_pnl, incremental_cash_flow, old_expiry,
                  new_expiry, old_strike, new_strike, heuristic_version, metadata
                )
                select g.household_id, g.account_id, :group_id, :closed_trade_id, :opened_trade_id,
                       :classification, :closed_leg_realized_pnl, :incremental_cash_flow, :old_expiry,
                       :new_expiry, :old_strike, :new_strike, :heuristic_version, cast(:metadata as jsonb)
                  from public.options_strategy_groups g
                 where g.id = :group_id
                on conflict on constraint options_roll_events_trade_pair_key do update set
                  strategy_group_id = excluded.strategy_group_id,
                  classification = excluded.classification,
                  closed_leg_realized_pnl = excluded.closed_leg_realized_pnl,
                  incremental_cash_flow = excluded.incremental_cash_flow,
                  old_expiry = excluded.old_expiry,
                  new_expiry = excluded.new_expiry,
                  old_strike = excluded.old_strike,
                  new_strike = excluded.new_strike,
                  heuristic_version = excluded.heuristic_version,
                  metadata = excluded.metadata,
                  updated_at = now()
                """
            ),
            {
                "group_id": roll.group_id,
                "closed_trade_id": roll.closed_trade_id,
                "opened_trade_id": roll.opened_trade_id,
                "classification": roll.classification,
                "closed_leg_realized_pnl": roll.closed_leg_realized_pnl,
                "incremental_cash_flow": roll.incremental_cash_flow,
                "old_expiry": roll.old_expiry,
                "new_expiry": roll.new_expiry,
                "old_strike": roll.old_strike,
                "new_strike": roll.new_strike,
                "heuristic_version": roll.heuristic_version,
                "metadata": _json({}),
            },
        )


def _json(value: Any) -> str:
    return json.dumps(value, default=str, sort_keys=True)


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return date.fromisoformat(value)
