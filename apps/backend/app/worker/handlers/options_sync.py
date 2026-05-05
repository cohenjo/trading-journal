"""Worker handler for IBKR Flex options-income ingestion."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
import json
import logging
import os
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.options.flex_parser import (
    FlexCashTransaction,
    FlexOpenPosition,
    FlexParseResult,
    FlexTradeConfirm,
    OptionLegKey,
    parse_flex_files,
)
from app.worker.handlers.options_metrics import compute_options_monthly_metrics

logger = logging.getLogger(__name__)
JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], AbstractContextManager[Session]]
PROJECT_ROOT = Path(__file__).resolve().parents[4]
SYNTHETIC_DIR = PROJECT_ROOT / "tmp" / "flex"


@dataclass(frozen=True)
class OptionsAccount:
    """Trading account configuration selected for options-income computation."""

    household_id: str
    account_id: str | None
    config_id: int | None = None


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session."""

    return Session(engine)


def handle_flex_options_sync(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Ingest Flex XML option facts and then rebuild monthly dashboard metrics."""

    with (session_factory or _default_session_factory)() as session:
        result = run_flex_options_sync(
            session,
            from_date=_optional_date(payload.get("from")),
            to_date=_optional_date(payload.get("to")),
            account_id=_optional_str(payload.get("account_id")),
            synthetic=_optional_bool(payload.get("synthetic")),
        )
        from app.worker.handlers.options_grouping import compute_options_strategy_groups

        grouping_result = compute_options_strategy_groups(
            session,
            household_id=_optional_str(payload.get("household_id")),
            account_id=_optional_str(payload.get("account_id")),
            from_date=_optional_date(payload.get("from")),
            to_date=_optional_date(payload.get("to")),
        )
        from app.worker.handlers.options_margin_sync import run_options_margin_sync

        margin_result = run_options_margin_sync(session, account_id=_optional_str(payload.get("account_id")))
        metric_result = compute_options_monthly_metrics(
            session,
            household_id=_optional_str(payload.get("household_id")),
            account_id=_optional_str(payload.get("account_id")),
            from_date=_optional_date(payload.get("from")),
            to_date=_optional_date(payload.get("to")),
        )
        session.commit()
        return {**result, "strategy_groups": grouping_result, "margin": margin_result, "monthly_metrics": metric_result}


def run_scheduled_flex_options_sync() -> None:
    """Run the daily scheduled Flex sync with configured source selection."""

    with _default_session_factory() as session:
        from app.worker.handlers.options_grouping import compute_options_strategy_groups

        result = run_flex_options_sync(session)
        compute_options_strategy_groups(session)
        from app.worker.handlers.options_margin_sync import run_options_margin_sync

        run_options_margin_sync(session)
        compute_options_monthly_metrics(session)
        session.commit()
    logger.info("Scheduled flex_options_sync completed: %s", result)


def run_flex_options_sync(
    session: Session,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    account_id: str | None = None,
    synthetic: bool | None = None,
) -> JobResult:
    """Parse selected Flex source files and upsert normalized option facts."""

    accounts = _load_accounts(session, account_id=account_id)
    if not accounts:
        return {"accounts": [], "trade_count": 0, "cash_event_count": 0, "position_count": 0, "leg_count": 0}

    paths = _select_flex_source(from_date=from_date, to_date=to_date, synthetic=synthetic)
    total_trades = 0
    total_cash = 0
    total_positions = 0
    summaries: list[dict[str, Any]] = []
    for account in accounts:
        parsed = parse_flex_files(paths, account.account_id)
        if account.account_id is None:
            account_ids = _parsed_account_ids(parsed)
        else:
            account_ids = {account.account_id}
        for parsed_account_id in sorted(account_ids):
            scoped = _scope_result(parsed, parsed_account_id)
            counts = _ingest_account(session, account.household_id, parsed_account_id, scoped, from_date, to_date)
            total_trades += counts["trade_count"]
            total_cash += counts["cash_event_count"]
            total_positions += counts["position_count"]
            summaries.append({"account_id": parsed_account_id, **counts})
    total_legs = sum(int(summary.get("leg_count", 0)) for summary in summaries)
    return {
        "accounts": summaries,
        "trade_count": total_trades,
        "cash_event_count": total_cash,
        "position_count": total_positions,
        "leg_count": total_legs,
        "source_files": [str(path) for path in paths],
    }


def _load_accounts(session: Session, *, account_id: str | None) -> list[OptionsAccount]:
    params: dict[str, Any] = {}
    filters = ["coalesce(compute_options_income, true) = true", "deleted_at is null"]
    if account_id:
        filters.append("account_id = :account_id")
        params["account_id"] = account_id
    rows = session.execute(
        text(
            f"""
            select id, household_id::text as household_id, account_id
              from public.trading_account_config
             where {" and ".join(filters)}
             order by id
            """
        ),
        params,
    ).mappings()
    return [
        OptionsAccount(
            household_id=str(row["household_id"]),
            account_id=str(row["account_id"]) if row["account_id"] else None,
            config_id=int(row["id"]),
        )
        for row in rows
        if row["household_id"]
    ]


def _select_flex_source(*, from_date: date | None, to_date: date | None, synthetic: bool | None) -> list[Path]:
    token = os.getenv("IBKR_FLEX_TOKEN")
    source_env = os.getenv("OPTIONS_FLEX_SOURCE")
    source = source_env.lower() if source_env else None
    if source == "live" and not token:
        raise RuntimeError("OPTIONS_FLEX_SOURCE=live requires IBKR_FLEX_TOKEN to be set in the environment")
    use_synthetic = synthetic is True or source == "synthetic" or (source is None and not token)
    if use_synthetic:
        return _synthetic_files()
    try:
        from scripts.flex_probe import fetch_live_xml, parse_args, query_configs_from_env
    except ModuleNotFoundError as exc:
        if exc.name != "scripts":
            raise
        from flex_probe import fetch_live_xml, parse_args, query_configs_from_env

    args = parse_args([])
    args.from_date = from_date
    args.to_date = to_date
    configs = query_configs_from_env()
    token = os.environ["IBKR_FLEX_TOKEN"]
    return fetch_live_xml(configs, token, args)


def _synthetic_files() -> list[Path]:
    expected_years = {"2021", "2022", "2023", "2024"}
    paths = sorted(SYNTHETIC_DIR.glob("synthetic_*.xml"))
    present_years = {
        path.stem.removeprefix("synthetic_") for path in paths if path.stem.removeprefix("synthetic_").isdigit()
    }
    if paths and expected_years.issubset(present_years):
        return paths
    from scripts.flex_synthetic import write_synthetic_files

    return sorted(write_synthetic_files(SYNTHETIC_DIR))


def _parsed_account_ids(parsed: FlexParseResult) -> set[str]:
    ids = {row.account_id for row in parsed.trades}
    ids.update(row.account_id for row in parsed.cash_transactions)
    ids.update(row.account_id for row in parsed.open_positions)
    ids.update(row.account_id for row in parsed.option_eae)
    ids.update(row.account_id for row in parsed.account_information)
    return ids


def _scope_result(parsed: FlexParseResult, account_id: str) -> FlexParseResult:
    return FlexParseResult(
        trades=[row for row in parsed.trades if row.account_id == account_id],
        cash_transactions=[row for row in parsed.cash_transactions if row.account_id == account_id],
        open_positions=[row for row in parsed.open_positions if row.account_id == account_id],
        option_eae=[row for row in parsed.option_eae if row.account_id == account_id],
        account_information=[row for row in parsed.account_information if row.account_id == account_id],
        section_counts=parsed.section_counts,
    )


def _ingest_account(
    session: Session,
    household_id: str,
    account_id: str,
    parsed: FlexParseResult,
    from_date: date | None,
    to_date: date | None,
) -> dict[str, int]:
    parsed = _filter_result_by_dates(parsed, from_date, to_date)
    leg_ids: dict[OptionLegKey, str] = {}
    trades_to_insert = parsed.trades
    for trade in trades_to_insert:
        leg_ids[trade.leg] = _upsert_leg(session, household_id, trade.leg)
        _upsert_trade(session, household_id, trade, leg_ids[trade.leg])
    for cash in parsed.cash_transactions:
        _upsert_cash_event(session, household_id, cash)
    snapshot_dates = {position.as_of_date for position in parsed.open_positions}
    for snapshot_date in snapshot_dates:
        session.execute(
            text(
                """
                delete from public.options_positions
                 where household_id = :household_id and account_id = :account_id and as_of_date = :as_of_date
                """
            ),
            {"household_id": household_id, "account_id": account_id, "as_of_date": snapshot_date},
        )
    for position in parsed.open_positions:
        leg_id = leg_ids.get(position.leg) or _upsert_leg(session, household_id, position.leg)
        leg_ids[position.leg] = leg_id
        _insert_position(session, household_id, position, leg_id)
    for account_info in parsed.account_information:
        _upsert_flex_margin_snapshot(session, household_id, account_info)
    _upsert_sync_state(session, household_id, account_id, parsed, from_date, to_date)
    return {
        "trade_count": len(trades_to_insert),
        "cash_event_count": len(parsed.cash_transactions),
        "position_count": len(parsed.open_positions),
        "leg_count": len(leg_ids),
    }


def _filter_result_by_dates(parsed: FlexParseResult, from_date: date | None, to_date: date | None) -> FlexParseResult:
    """Keep parsed Flex rows whose business date falls inside the requested window."""

    if from_date is None and to_date is None:
        return parsed

    def in_window(value: date | None) -> bool:
        if value is None:
            return True
        if from_date and value < from_date:
            return False
        if to_date and value > to_date:
            return False
        return True

    return FlexParseResult(
        trades=[row for row in parsed.trades if in_window(row.trade_date)],
        cash_transactions=[row for row in parsed.cash_transactions if in_window(row.event_date)],
        open_positions=[row for row in parsed.open_positions if in_window(row.as_of_date)],
        option_eae=[row for row in parsed.option_eae if in_window(row.trade_date)],
        account_information=[
            row for row in parsed.account_information if in_window(row.as_of.date() if row.as_of else None)
        ],
        section_counts=parsed.section_counts,
    )


def _upsert_leg(session: Session, household_id: str, leg: OptionLegKey) -> str:
    source_conid = _source_conid_for_insert(session, household_id, leg)
    row = session.execute(
        text(
            """
            insert into public.options_legs (
              household_id, account_id, source_conid, underlying_symbol, option_symbol,
              expiry, strike, "right", multiplier, currency, metadata
            ) values (
              :household_id, :account_id, :source_conid, :underlying_symbol, :option_symbol,
              :expiry, :strike, :right, :multiplier, :currency, cast(:metadata as jsonb)
            )
            on conflict on constraint options_legs_natural_key do update set
              option_symbol = excluded.option_symbol,
              source_conid = coalesce(public.options_legs.source_conid, excluded.source_conid),
              metadata = excluded.metadata,
              updated_at = now()
            returning id::text
            """
        ),
        {
            "household_id": household_id,
            "account_id": leg.account_id,
            "source_conid": source_conid,
            "underlying_symbol": leg.underlying_symbol,
            "option_symbol": leg.option_symbol,
            "expiry": leg.expiry,
            "strike": leg.strike,
            "right": leg.right,
            "multiplier": leg.multiplier,
            "currency": leg.currency,
            "metadata": _json({}),
        },
    ).scalar_one()
    return str(row)


def _source_conid_for_insert(session: Session, household_id: str, leg: OptionLegKey) -> int | None:
    if leg.source_conid is None:
        return None
    conflicting_leg_id = session.execute(
        text(
            """
            select id::text
              from public.options_legs
             where household_id = :household_id
               and account_id = :account_id
               and source_conid = :source_conid
               and not (
                 underlying_symbol = :underlying_symbol
                 and expiry = :expiry
                 and strike = :strike
                 and "right" = :right
                 and multiplier = :multiplier
                 and currency = :currency
               )
             limit 1
            """
        ),
        {
            "household_id": household_id,
            "account_id": leg.account_id,
            "source_conid": leg.source_conid,
            "underlying_symbol": leg.underlying_symbol,
            "expiry": leg.expiry,
            "strike": leg.strike,
            "right": leg.right,
            "multiplier": leg.multiplier,
            "currency": leg.currency,
        },
    ).scalar_one_or_none()
    return None if conflicting_leg_id else leg.source_conid


def _upsert_trade(session: Session, household_id: str, trade: FlexTradeConfirm, leg_id: str) -> None:
    session.execute(
        text(
            """
            insert into public.options_trades (
              household_id, account_id, leg_id, source, source_trade_id, source_transaction_id, source_exec_id,
              event_type, side, trade_time, trade_date, quantity, price, gross_amount, commission, fees,
              net_cash_flow, realized_pnl, currency, raw_payload
            ) values (
              :household_id, :account_id, :leg_id, 'ibkr_flex', :source_trade_id, :source_transaction_id, :source_exec_id,
              :event_type, :side, :trade_time, :trade_date, :quantity, :price, :gross_amount, :commission, :fees,
              :net_cash_flow, :realized_pnl, :currency, cast(:raw_payload as jsonb)
            )
            on conflict on constraint options_trades_source_trade_key do update set
              leg_id = excluded.leg_id,
              source_transaction_id = excluded.source_transaction_id,
              source_exec_id = excluded.source_exec_id,
              event_type = excluded.event_type,
              side = excluded.side,
              trade_time = excluded.trade_time,
              trade_date = excluded.trade_date,
              quantity = excluded.quantity,
              price = excluded.price,
              gross_amount = excluded.gross_amount,
              commission = excluded.commission,
              fees = excluded.fees,
              net_cash_flow = excluded.net_cash_flow,
              realized_pnl = excluded.realized_pnl,
              currency = excluded.currency,
              raw_payload = excluded.raw_payload,
              updated_at = now()
            """
        ),
        {
            "household_id": household_id,
            "leg_id": leg_id,
            **trade.model_dump(exclude={"leg"}),
            "raw_payload": _json(trade.raw_payload),
        },
    )


def _upsert_cash_event(session: Session, household_id: str, cash: FlexCashTransaction) -> None:
    session.execute(
        text(
            """
            insert into public.options_cash_events (
              household_id, account_id, source, source_transaction_id, event_date, event_time,
              event_category, description, amount, currency, raw_payload
            ) values (
              :household_id, :account_id, 'ibkr_flex', :source_transaction_id, :event_date, :event_time,
              :event_category, :description, :amount, :currency, cast(:raw_payload as jsonb)
            )
            on conflict on constraint options_cash_events_source_transaction_key do update set
              event_date = excluded.event_date,
              event_time = excluded.event_time,
              event_category = excluded.event_category,
              description = excluded.description,
              amount = excluded.amount,
              currency = excluded.currency,
              raw_payload = excluded.raw_payload,
              updated_at = now()
            """
        ),
        {"household_id": household_id, **cash.model_dump(), "raw_payload": _json(cash.raw_payload)},
    )


def _insert_position(session: Session, household_id: str, position: FlexOpenPosition, leg_id: str) -> None:
    session.execute(
        text(
            """
            insert into public.options_positions (
              household_id, account_id, as_of_date, leg_id, opened_at, quantity_open,
              average_open_price, open_cash_flow, ib_margin_requirement, last_broker_sync_at, raw_payload
            ) values (
              :household_id, :account_id, :as_of_date, :leg_id, :opened_at, :quantity_open,
              :average_open_price, :open_cash_flow, :ib_margin_requirement, :last_broker_sync_at, cast(:raw_payload as jsonb)
            )
            """
        ),
        {
            "household_id": household_id,
            "leg_id": leg_id,
            **position.model_dump(exclude={"leg"}),
            "raw_payload": _json(position.raw_payload),
        },
    )


def _upsert_flex_margin_snapshot(session: Session, household_id: str, account_info: Any) -> None:
    raw = account_info.raw_payload
    margin_used = _first_decimal(raw, ("MaintMarginReq", "maintenanceMargin", "maintMarginReq"))
    net_liq = _first_decimal(raw, ("NetLiquidation", "netLiquidation", "netLiq"))
    margin_available = _first_decimal(raw, ("AvailableFunds", "availableFunds", "ExcessLiquidity"))
    buying_power = _first_decimal(raw, ("BuyingPower", "buyingPower"))
    if margin_used is None and margin_available is None and buying_power is None:
        return
    if margin_available is None and net_liq is not None and margin_used is not None:
        margin_available = net_liq - margin_used
    captured_at = (account_info.as_of or datetime.now(timezone.utc)).replace(second=0, microsecond=0)
    session.execute(
        text(
            """
            insert into public.options_margin_snapshots (
              household_id, account_id, captured_at, margin_used, margin_available, buying_power, source
            ) values (
              :household_id, :account_id, :captured_at, :margin_used, :margin_available, :buying_power, 'flex'
            )
            on conflict on constraint options_margin_snapshots_account_captured_key do update set
              margin_used = excluded.margin_used,
              margin_available = excluded.margin_available,
              buying_power = excluded.buying_power,
              source = 'flex',
              updated_at = now()
            """
        ),
        {
            "household_id": household_id,
            "account_id": account_info.account_id,
            "captured_at": captured_at,
            "margin_used": margin_used,
            "margin_available": margin_available,
            "buying_power": buying_power,
        },
    )


def _first_decimal(raw: dict[str, str], names: tuple[str, ...]) -> Decimal | None:
    for name in names:
        value = raw.get(name)
        if value not in (None, ""):
            try:
                return Decimal(str(value).replace(",", ""))
            except Exception:  # noqa: BLE001 - ignore malformed optional Flex account fields
                return None
    return None


def _upsert_sync_state(
    session: Session,
    household_id: str,
    account_id: str,
    parsed: FlexParseResult,
    from_date: date | None,
    to_date: date | None,
) -> None:
    counts = {
        "TradeConfirms": len(parsed.trades),
        "CashTransactions": len(parsed.cash_transactions),
        "OpenPositions": len(parsed.open_positions),
        "OptionEAE": len(parsed.option_eae),
        "AccountInformation": len(parsed.account_information),
    }
    rows_seen = sum(counts.values())
    session.execute(
        text(
            """
            insert into public.options_flex_sync_state (
              household_id, account_id, query_name, source, status, last_sync_at,
              last_from_date, last_through_date, rows_seen, rows_inserted, row_counts, metadata
            ) values (
              :household_id, :account_id, 'all', 'ibkr_flex', 'succeeded', now(),
              :from_date, :to_date, :rows_seen, :rows_seen, cast(:row_counts as jsonb), cast(:metadata as jsonb)
            )
            on conflict on constraint options_flex_sync_state_account_query_key do update set
              status = 'succeeded',
              last_sync_at = now(),
              last_from_date = excluded.last_from_date,
              last_through_date = excluded.last_through_date,
              rows_seen = excluded.rows_seen,
              rows_inserted = excluded.rows_inserted,
              row_counts = excluded.row_counts,
              metadata = excluded.metadata,
              error = null,
              updated_at = now()
            """
        ),
        {
            "household_id": household_id,
            "account_id": account_id,
            "from_date": from_date,
            "to_date": to_date,
            "rows_seen": rows_seen,
            "row_counts": _json(counts),
            "metadata": _json({"accountInformation": [row.raw_payload for row in parsed.account_information]}),
        },
    )


def _json(value: Any) -> str:
    return json.dumps(value, default=str, sort_keys=True)


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "synthetic"}
    return None


def _optional_date(value: object) -> date | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return date.fromisoformat(value)
