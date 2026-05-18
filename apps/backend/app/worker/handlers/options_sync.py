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
import re
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.options.flex_parser import (
    FlexBondPosition,
    FlexCashTransaction,
    FlexDividendAccrual,
    FlexDividendPayment,
    FlexOpenPosition,
    FlexParseResult,
    FlexSecurityInfo,
    FlexStockPosition,
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


def _fetch_flex_options_paths(
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    synthetic: bool | None = None,
    poll_seconds: int = 10,
    max_polls: int = 60,
    xml_dir: Path | None = None,
) -> list[Path]:
    """Fetch Flex XML paths from live API, synthetic fixtures, or manual XML drop.

    This function performs the network roundtrip (if live) and does NOT require
    a database session. Use this to decouple slow Flex API calls from SQLAlchemy
    session lifetimes, preventing idle connection timeouts.

    Args:
        from_date: Inclusive start date for filtering
        to_date: Inclusive end date for filtering
        synthetic: If True, use synthetic fixtures
        poll_seconds: Seconds between GetStatement polls (live mode)
        max_polls: Maximum GetStatement polls before timeout (live mode)
        xml_dir: Directory containing manual Activity Flex XML exports. If set,
            reads files from this directory instead of fetching from live API.
    """
    return _select_flex_source(
        from_date=from_date,
        to_date=to_date,
        synthetic=synthetic,
        poll_seconds=poll_seconds,
        max_polls=max_polls,
        xml_dir=xml_dir,
    )


def run_flex_options_sync(
    session: Session,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    account_id: str | None = None,
    synthetic: bool | None = None,
    poll_seconds: int = 10,
    max_polls: int = 60,
    pre_fetched_paths: list[Path] | None = None,
) -> JobResult:
    """Parse selected Flex source files and upsert normalized option facts.

    Args:
        session: SQLAlchemy session for database writes
        from_date: Inclusive start date for Flex query window
        to_date: Inclusive end date for Flex query window
        account_id: Optional account filter
        synthetic: If True, use synthetic fixtures instead of live API
        poll_seconds: Seconds between GetStatement polls (live mode)
        max_polls: Maximum GetStatement polls before timeout (live mode)
        pre_fetched_paths: Optional pre-fetched XML paths. If provided, skips the
            slow network fetch. Use _fetch_flex_options_paths() to pre-fetch paths
            before opening a database session, then pass them here.

    Returns:
        Job result dict with trade/cash/position counts
    """

    accounts = _load_accounts(session, account_id=account_id)
    if not accounts:
        return {
            "accounts": [],
            "trade_count": 0,
            "cash_event_count": 0,
            "dividend_payment_count": 0,
            "position_count": 0,
            "bond_position_count": 0,
            "leg_count": 0,
        }

    if pre_fetched_paths is not None:
        paths = pre_fetched_paths
    else:
        paths = _select_flex_source(
            from_date=from_date, to_date=to_date, synthetic=synthetic, poll_seconds=poll_seconds, max_polls=max_polls
        )
    total_trades = 0
    total_cash = 0
    total_positions = 0
    total_stock_positions = 0
    total_bond_positions = 0
    total_dividends = 0
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
            stk_count = _sync_stock_positions(
                session, account.household_id, account.config_id, parsed_account_id, scoped
            )
            bond_count = _sync_bond_positions(
                session, account.household_id, account.config_id, parsed_account_id, scoped
            )
            # Write last_synced only after the full per-account pipeline succeeds.
            _update_config_last_synced(session, account.config_id)
            total_trades += counts["trade_count"]
            total_cash += counts["cash_event_count"]
            total_positions += counts["position_count"]
            total_stock_positions += stk_count
            total_bond_positions += bond_count
            total_dividends += counts.get("dividend_payment_count", 0)
            summaries.append(
                {
                    "account_id": parsed_account_id,
                    **counts,
                    "stock_position_count": stk_count,
                    "bond_position_count": bond_count,
                }
            )
    total_legs = sum(int(summary.get("leg_count", 0)) for summary in summaries)
    return {
        "accounts": summaries,
        "trade_count": total_trades,
        "cash_event_count": total_cash,
        "dividend_payment_count": total_dividends,
        "position_count": total_positions,
        "stock_position_count": total_stock_positions,
        "bond_position_count": total_bond_positions,
        "leg_count": total_legs,
        "source_files": [str(path) for path in paths],
    }


def _sync_stock_positions(
    session: Session,
    household_id: str,
    config_id: int | None,
    parsed_account_id: str,
    parsed: FlexParseResult,
) -> int:
    """Delete-then-insert stock positions for all snapshot dates found in the parsed result.

    Idempotency: for each (household_id, account_id, as_of_date) combination present in
    the parsed STK rows, deletes existing flex-sourced rows first, then bulk-inserts the
    new ones.  This mirrors the options_positions write pattern.

    Args:
        session: Active SQLAlchemy session (caller commits).
        household_id: UUID string for the owning household.
        config_id: trading_account_config.id for the IBKR account.  If None the
            account config cannot be linked and rows are skipped (logged as warning).
        parsed_account_id: IBKR account ID string (e.g. "U2515365") used for logging.
        parsed: Full parse result; only ``parsed.stock_positions`` is consumed here.

    Returns:
        Number of stock position rows inserted.
    """
    if not parsed.stock_positions:
        return 0
    if config_id is None:
        logger.warning(
            "Skipping stock position sync for account %s — no config_id resolved",
            parsed_account_id,
        )
        return 0

    # Group by snapshot date for targeted delete-then-insert
    by_date: dict[str, list[FlexStockPosition]] = {}
    for sp in parsed.stock_positions:
        key = sp.as_of_date.isoformat()
        by_date.setdefault(key, []).append(sp)

    inserted = 0
    for as_of_date_str, rows in by_date.items():
        session.execute(
            text(
                """
                delete from public.stock_positions
                 where household_id = :household_id
                   and account_id   = :account_id
                   and as_of_date   = :as_of_date
                   and source       = 'flex'
                """
            ),
            {"household_id": household_id, "account_id": config_id, "as_of_date": as_of_date_str},
        )
        for row in rows:
            session.execute(
                text(
                    """
                    insert into public.stock_positions (
                      household_id, account_id, ticker, quantity, cost_basis,
                      currency, as_of_date, source, con_id,
                      description, sub_category, mark_price, market_value,
                      unrealized_pnl, last_broker_sync_at, raw_payload,
                      cost_basis_total, listing_exchange, cusip, isin, figi,
                      security_id, security_id_type
                    ) values (
                      :household_id, :account_id, :ticker, :quantity, :cost_basis,
                      :currency, :as_of_date, 'flex', :con_id,
                      :description, :sub_category, :mark_price, :market_value,
                      :unrealized_pnl, :last_broker_sync_at, cast(:raw_payload as jsonb),
                      :cost_basis_total, :listing_exchange, :cusip, :isin, :figi,
                      :security_id, :security_id_type
                    )
                    """
                ),
                {
                    "household_id": household_id,
                    "account_id": config_id,
                    "ticker": row.symbol,
                    "quantity": row.quantity,
                    "cost_basis": row.cost_basis,
                    "currency": row.currency,
                    "as_of_date": row.as_of_date,
                    "con_id": row.con_id,
                    "description": row.description,
                    "sub_category": row.sub_category,
                    "mark_price": row.mark_price,
                    "market_value": row.market_value,
                    "unrealized_pnl": row.unrealized_pnl,
                    "last_broker_sync_at": row.last_broker_sync_at,
                    "raw_payload": _json(dict(row.raw_payload)),
                    "cost_basis_total": row.cost_basis_total,
                    "listing_exchange": row.listing_exchange,
                    "cusip": row.cusip,
                    "isin": row.isin,
                    "figi": row.figi,
                    "security_id": row.security_id,
                    "security_id_type": row.security_id_type,
                },
            )
            inserted += 1
    logger.info(
        "stock_positions sync: account=%s as_of_dates=%s inserted=%d",
        parsed_account_id,
        list(by_date.keys()),
        inserted,
    )
    return inserted


def _sync_bond_positions(
    session: Session,
    household_id: str,
    config_id: int | None,
    parsed_account_id: str,
    parsed: FlexParseResult,
) -> int:
    """Delete-then-insert BOND positions for all snapshot dates in the parsed result.

    Uses the same idempotency pattern as ``_sync_stock_positions``.  The row
    ``id`` (text PK inherited from the original bond_holdings design) is set to
    ``flex_{account_id_str}_{con_id}_{as_of_date}`` to be deterministic and unique.

    Args:
        session: Active SQLAlchemy session (caller commits).
        household_id: UUID string for the owning household.
        config_id: trading_account_config.id (unused for id generation; kept for parity).
        parsed_account_id: IBKR account string (e.g. ``"U2515365"``).
        parsed: Full parse result; only ``parsed.bond_positions`` is consumed.

    Returns:
        Number of bond position rows inserted.
    """
    if not parsed.bond_positions:
        return 0
    if config_id is None:
        logger.warning(
            "Skipping bond position sync for account %s — no config_id resolved",
            parsed_account_id,
        )
        return 0

    by_date: dict[str, list[FlexBondPosition]] = {}
    for bp in parsed.bond_positions:
        key = bp.as_of_date.isoformat()
        by_date.setdefault(key, []).append(bp)

    inserted = 0
    for as_of_date_str, rows in by_date.items():
        session.execute(
            text(
                """
                delete from public.bond_holdings
                 where household_id = :household_id
                   and account_id   = :account_id_str
                   and as_of_date   = :as_of_date
                   and source       = 'flex'
                """
            ),
            {
                "household_id": household_id,
                "account_id_str": parsed_account_id,
                "as_of_date": as_of_date_str,
            },
        )
        for row in rows:
            row_id = f"flex_{parsed_account_id}_{row.con_id}_{as_of_date_str}"
            session.execute(
                text(
                    """
                    insert into public.bond_holdings (
                      household_id, id, account_id, as_of_date, source,
                      ticker, con_id, description, sub_category, currency,
                      face_value, maturity_date, coupon_rate,
                      mark_price, market_value, cost_basis_price, cost_basis_total,
                      unrealized_pnl, accrued_interest,
                      cusip, isin, figi, security_id, security_id_type,
                      listing_exchange, issuer, raw_payload
                    ) values (
                      :household_id, :id, :account_id, :as_of_date, 'flex',
                      :ticker, :con_id, :description, :sub_category, :currency,
                      :face_value, :maturity_date, :coupon_rate,
                      :mark_price, :market_value, :cost_basis_price, :cost_basis_total,
                      :unrealized_pnl, :accrued_interest,
                      :cusip, :isin, :figi, :security_id, :security_id_type,
                      :listing_exchange, :issuer, cast(:raw_payload as jsonb)
                    )
                    on conflict (household_id, id) do update set
                      as_of_date       = excluded.as_of_date,
                      mark_price       = excluded.mark_price,
                      market_value     = excluded.market_value,
                      cost_basis_price = excluded.cost_basis_price,
                      cost_basis_total = excluded.cost_basis_total,
                      unrealized_pnl   = excluded.unrealized_pnl,
                      accrued_interest = excluded.accrued_interest,
                      raw_payload      = excluded.raw_payload,
                      updated_at       = now()
                    """
                ),
                {
                    "household_id": household_id,
                    "id": row_id,
                    "account_id": parsed_account_id,
                    "as_of_date": row.as_of_date,
                    "ticker": row.symbol,
                    "con_id": row.con_id,
                    "description": row.description,
                    "sub_category": row.sub_category,
                    "currency": row.currency,
                    "face_value": row.quantity,  # bond position = face value
                    "maturity_date": row.maturity_date,
                    "coupon_rate": row.coupon_rate,
                    "mark_price": row.mark_price,
                    "market_value": row.market_value,
                    "cost_basis_price": row.cost_basis_price,
                    "cost_basis_total": row.cost_basis_total,
                    "unrealized_pnl": row.unrealized_pnl,
                    "accrued_interest": row.accrued_interest,
                    "cusip": row.cusip,
                    "isin": row.isin,
                    "figi": row.figi,
                    "security_id": row.security_id,
                    "security_id_type": row.security_id_type,
                    "listing_exchange": row.listing_exchange,
                    "issuer": row.issuer or "",
                    "raw_payload": _json(dict(row.raw_payload)),
                },
            )
            inserted += 1
    logger.info(
        "bond_holdings sync: account=%s as_of_dates=%s inserted=%d",
        parsed_account_id,
        list(by_date.keys()),
        inserted,
    )
    return inserted


def _upsert_dividend_payment(
    session: Session,
    account_id_str: str,
    dividend: FlexDividendPayment,
) -> None:
    """Idempotent insert of a dividend / withholding-tax row into dividend_payments.

    Uses the ``(account_id, source_transaction_id)`` unique constraint for
    conflict resolution.  Tax amounts are stored verbatim — no derived math.
    """
    session.execute(
        text(
            """
            insert into public.dividend_payments (
              account_id, symbol, con_id, description, currency,
              date_time, report_date, settle_date, ex_date,
              amount, type, dividend_type,
              trade_id, transaction_id, action_id,
              source_section, source_transaction_id, raw_payload
            ) values (
              :account_id, :symbol, :con_id, :description, :currency,
              :date_time, :report_date, :settle_date, :ex_date,
              :amount, :type, :dividend_type,
              :trade_id, :transaction_id, :action_id,
              :source_section, :source_transaction_id, cast(:raw_payload as jsonb)
            )
            on conflict on constraint dividend_payments_idempotent
            do update set
              date_time    = excluded.date_time,
              report_date  = excluded.report_date,
              settle_date  = excluded.settle_date,
              ex_date      = excluded.ex_date,
              amount       = excluded.amount,
              type         = excluded.type,
              dividend_type = excluded.dividend_type,
              raw_payload  = excluded.raw_payload
            """
        ),
        {
            "account_id": account_id_str,
            "symbol": dividend.symbol,
            "con_id": dividend.con_id,
            "description": dividend.description,
            "currency": dividend.currency,
            "date_time": dividend.date_time,
            "report_date": dividend.report_date,
            "settle_date": dividend.settle_date,
            "ex_date": dividend.ex_date,
            "amount": dividend.amount,
            "type": dividend.type,
            "dividend_type": dividend.dividend_type,
            "trade_id": dividend.trade_id,
            "transaction_id": dividend.transaction_id,
            "action_id": dividend.action_id,
            "source_section": dividend.source_section,
            "source_transaction_id": dividend.source_transaction_id,
            "raw_payload": _json(dict(dividend.raw_payload)),
        },
    )


def _sync_dividend_accruals(
    session: Session,
    account_id_str: str,
    accruals: list[FlexDividendAccrual],
    report_date: date | None,
) -> int:
    """Delete-then-insert dividend accruals for the given report_date window.

    Accrual rows are keyed by ``(account_id, report_date, source_section)``
    rather than by a transactionID (IBKR doesn't provide one for accruals).
    The entire window is replaced on each sync to avoid stale duplicates.

    Returns:
        Number of rows inserted.
    """
    if not accruals:
        return 0

    # Collect all (report_date, source_section) pairs present in the batch.
    windows: set[tuple[str | None, str]] = set()
    for accrual in accruals:
        rd = accrual.report_date.isoformat() if accrual.report_date else None
        windows.add((rd, accrual.source_section))

    for rd_str, source_section in windows:
        if rd_str is None:
            continue
        session.execute(
            text(
                """
                delete from public.dividend_accruals
                 where account_id      = :account_id
                   and report_date     = :report_date
                   and source_section  = :source_section
                """
            ),
            {
                "account_id": account_id_str,
                "report_date": rd_str,
                "source_section": source_section,
            },
        )

    for accrual in accruals:
        session.execute(
            text(
                """
                insert into public.dividend_accruals (
                  account_id, symbol, con_id, description, currency,
                  ex_date, pay_date, date, quantity,
                  gross_rate, gross_amount, tax, fee, net_amount,
                  code, report_date, source_section,
                  fx_rate_to_base, asset_category, raw_payload
                ) values (
                  :account_id, :symbol, :con_id, :description, :currency,
                  :ex_date, :pay_date, :date, :quantity,
                  :gross_rate, :gross_amount, :tax, :fee, :net_amount,
                  :code, :report_date, :source_section,
                  :fx_rate_to_base, :asset_category, cast(:raw_payload as jsonb)
                )
                """
            ),
            {
                "account_id": account_id_str,
                "symbol": accrual.symbol,
                "con_id": accrual.con_id,
                "description": accrual.description,
                "currency": accrual.currency,
                "ex_date": accrual.ex_date,
                "pay_date": accrual.pay_date,
                "date": accrual.accrual_date,
                "quantity": accrual.quantity,
                "gross_rate": accrual.gross_rate,
                "gross_amount": accrual.gross_amount,
                "tax": accrual.tax,
                "fee": accrual.fee,
                "net_amount": accrual.net_amount,
                "code": accrual.code,
                "report_date": accrual.report_date,
                "source_section": accrual.source_section,
                "fx_rate_to_base": accrual.fx_rate_to_base,
                "asset_category": accrual.asset_category,
                "raw_payload": _json(dict(accrual.raw_payload)),
            },
        )
    logger.info(
        "dividend_accruals sync: account=%s inserted=%d",
        account_id_str,
        len(accruals),
    )
    return len(accruals)


def _upsert_security_reference(
    session: Session,
    rows: list[FlexSecurityInfo],
    *,
    source: str,
) -> int:
    """Upsert security identifier rows into security_reference.

    FII rows (``source='fii'``) take precedence over OpenPositions seeds
    (``source='open_positions'``) because FII contains richer metadata.
    Existing rows are only overwritten when the incoming source is 'fii'
    or when the stored source is also 'open_positions'.

    Returns:
        Number of rows upserted.
    """
    if not rows:
        return 0
    upserted = 0
    for row in rows:
        session.execute(
            text(
                """
                insert into public.security_reference (
                  con_id, symbol, description, asset_category, sub_category,
                  currency, listing_exchange, cusip, isin, figi,
                  security_id, security_id_type, issuer,
                  maturity, issue_date, raw_payload, source, last_seen_at
                ) values (
                  :con_id, :symbol, :description, :asset_category, :sub_category,
                  :currency, :listing_exchange, :cusip, :isin, :figi,
                  :security_id, :security_id_type, :issuer,
                  :maturity, :issue_date, cast(:raw_payload as jsonb), :source, now()
                )
                on conflict (con_id) do update set
                  symbol            = excluded.symbol,
                  description       = coalesce(excluded.description, public.security_reference.description),
                  asset_category    = coalesce(excluded.asset_category, public.security_reference.asset_category),
                  sub_category      = coalesce(excluded.sub_category, public.security_reference.sub_category),
                  listing_exchange  = coalesce(excluded.listing_exchange, public.security_reference.listing_exchange),
                  cusip             = coalesce(excluded.cusip, public.security_reference.cusip),
                  isin              = coalesce(excluded.isin, public.security_reference.isin),
                  figi              = coalesce(excluded.figi, public.security_reference.figi),
                  security_id       = coalesce(excluded.security_id, public.security_reference.security_id),
                  security_id_type  = coalesce(excluded.security_id_type, public.security_reference.security_id_type),
                  issuer            = coalesce(excluded.issuer, public.security_reference.issuer),
                  maturity          = coalesce(excluded.maturity, public.security_reference.maturity),
                  issue_date        = coalesce(excluded.issue_date, public.security_reference.issue_date),
                  raw_payload       = case when :source = 'fii' then excluded.raw_payload
                                          else public.security_reference.raw_payload end,
                  source            = case when :source = 'fii' then 'fii'
                                          else public.security_reference.source end,
                  last_seen_at      = now()
                where :source = 'fii' or public.security_reference.source = 'open_positions'
                """
            ),
            {
                "con_id": row.con_id,
                "symbol": row.symbol,
                "description": row.description,
                "asset_category": row.asset_category,
                "sub_category": row.sub_category,
                "currency": row.currency,
                "listing_exchange": row.listing_exchange,
                "cusip": row.cusip,
                "isin": row.isin,
                "figi": row.figi,
                "security_id": row.security_id,
                "security_id_type": row.security_id_type,
                "issuer": row.issuer,
                "maturity": row.maturity,
                "issue_date": row.issue_date,
                "raw_payload": _json(dict(row.raw_payload)),
                "source": source,
            },
        )
        upserted += 1
    logger.info("security_reference upsert: source=%s upserted=%d", source, upserted)
    return upserted


def _seed_security_reference_from_positions(
    session: Session,
    parsed: FlexParseResult,
) -> None:
    """Seed security_reference from OpenPositions STK and BOND identifier fields."""
    from app.services.options.flex_parser import FlexSecurityInfo

    infos: list[FlexSecurityInfo] = []
    for sp in parsed.stock_positions:
        if sp.con_id is None:
            continue
        infos.append(
            FlexSecurityInfo(
                account_id=sp.account_id,
                con_id=sp.con_id,
                symbol=sp.symbol,
                description=sp.description,
                asset_category="STK",
                sub_category=sp.sub_category,
                currency=sp.currency,
                listing_exchange=sp.listing_exchange,
                cusip=sp.cusip,
                isin=sp.isin,
                figi=sp.figi,
                security_id=sp.security_id,
                security_id_type=sp.security_id_type,
                raw_payload=dict(sp.raw_payload),
            )
        )
    for bp in parsed.bond_positions:
        if bp.con_id is None:
            continue
        infos.append(
            FlexSecurityInfo(
                account_id=bp.account_id,
                con_id=bp.con_id,
                symbol=bp.symbol,
                description=bp.description,
                asset_category="BOND",
                sub_category=bp.sub_category,
                currency=bp.currency,
                listing_exchange=bp.listing_exchange,
                cusip=bp.cusip,
                isin=bp.isin,
                figi=bp.figi,
                security_id=bp.security_id,
                security_id_type=bp.security_id_type,
                issuer=bp.issuer,
                maturity=bp.maturity_date,
                raw_payload=dict(bp.raw_payload),
            )
        )
    # FII rows from the parsed result take precedence.
    if parsed.security_infos:
        _upsert_security_reference(session, parsed.security_infos, source="fii")
    if infos:
        _upsert_security_reference(session, infos, source="open_positions")


def _load_accounts(session: Session, *, account_id: str | None) -> list[OptionsAccount]:
    """Load trading account configs that are eligible for Flex options sync.

    Configs whose household_id is not present in the households table (or whose
    household has been soft-deleted) are excluded.  Each excluded row is logged
    at WARNING level so future orphans are visible without crashing the sync.
    """
    params: dict[str, Any] = {}
    filters = ["coalesce(c.compute_options_income, true) = true", "c.deleted_at is null"]
    if account_id:
        filters.append("c.account_id = :account_id")
        params["account_id"] = account_id
    rows = session.execute(
        text(
            f"""
            select c.id,
                   c.household_id::text as household_id,
                   c.account_id,
                   (h.id is not null) as household_exists
              from public.trading_account_config c
              left join public.households h
                     on h.id = c.household_id
                    and h.deleted_at is null
             where {" and ".join(filters)}
             order by c.id
            """
        ),
        params,
    ).mappings()
    accounts: list[OptionsAccount] = []
    for row in rows:
        if not row["household_id"]:
            continue
        if not row["household_exists"]:
            logger.warning(
                "_load_accounts: skipping orphaned config — account_id=%r household_id=%r "
                "(household missing or soft-deleted); soft-delete this config to silence",
                row["account_id"],
                row["household_id"],
            )
            continue
        accounts.append(
            OptionsAccount(
                household_id=str(row["household_id"]),
                account_id=str(row["account_id"]) if row["account_id"] else None,
                config_id=int(row["id"]),
            )
        )
    return accounts


def _select_flex_source(
    *,
    from_date: date | None,
    to_date: date | None,
    synthetic: bool | None,
    poll_seconds: int = 10,
    max_polls: int = 60,
    xml_dir: Path | None = None,
) -> list[Path]:
    """Select Flex XML source: manual XML dir, live API, or synthetic fixtures."""
    # Check xml_dir mode first (explicit kwarg or env)
    if xml_dir is not None or os.getenv("OPTIONS_FLEX_SOURCE") == "xml_dir":
        directory = xml_dir or Path(os.environ.get("OPTIONS_FLEX_XML_DIR", ""))
        if not directory:
            raise ValueError("xml_dir mode enabled but no directory provided")
        return _xml_dir_files(directory, from_date=from_date, to_date=to_date)

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
    args.poll_seconds = poll_seconds
    args.max_polls = max_polls
    configs = query_configs_from_env()
    token = os.environ["IBKR_FLEX_TOKEN"]
    return fetch_live_xml(configs, token, args)


def _xml_dir_files(directory: Path, *, from_date: date | None, to_date: date | None) -> list[Path]:
    """List Activity Flex XML files in directory, filtered by date range.

    Files must follow IBKR naming pattern:
        {accountId}_{accountId}_{YYYYMMDD}_{YYYYMMDD}_AF_{queryId}_{hash}.xml

    Files that don't match the pattern are skipped with a warning.
    Returns files whose date range overlaps with [from_date, to_date].

    Args:
        directory: Path to directory containing Activity Flex XML files
        from_date: Optional inclusive start date filter
        to_date: Optional inclusive end date filter

    Returns:
        Sorted list of matching XML file paths

    Raises:
        FileNotFoundError: If no matching files found in directory
    """
    xml_files = sorted(directory.glob("*.xml"))
    if not xml_files:
        raise FileNotFoundError(f"No XML files found in directory: {directory}")

    # Pattern: {acct}_{acct}_{YYYYMMDD}_{YYYYMMDD}_AF_{qid}_{hash}.xml
    pattern = re.compile(r"_(\d{8})_(\d{8})_AF_")
    matching_files: list[Path] = []

    for path in xml_files:
        match = pattern.search(path.name)
        if not match:
            logger.warning("Skipping XML file with non-matching filename pattern: %s", path.name)
            continue

        # Parse date range from filename
        try:
            file_start = datetime.strptime(match.group(1), "%Y%m%d").date()
            file_end = datetime.strptime(match.group(2), "%Y%m%d").date()
        except ValueError as exc:
            logger.warning("Skipping XML file with invalid date in filename %s: %s", path.name, exc)
            continue

        # Filter by date overlap (inclusive)
        if from_date and file_end < from_date:
            continue
        if to_date and file_start > to_date:
            continue

        matching_files.append(path)

    if not matching_files:
        window = f"[{from_date or 'any'} to {to_date or 'any'}]"
        raise FileNotFoundError(
            f"No Activity Flex XML files found in {directory} for window {window}. "
            f"Files must match pattern: {{acct}}_{{acct}}_{{YYYYMMDD}}_{{YYYYMMDD}}_AF_{{qid}}_{{hash}}.xml"
        )

    return sorted(matching_files)


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
    ids.update(row.account_id for row in parsed.stock_positions)
    ids.update(row.account_id for row in parsed.bond_positions)
    ids.update(row.account_id for row in parsed.dividend_payments)
    ids.update(row.account_id for row in parsed.dividend_accruals)
    ids.update(row.account_id for row in parsed.option_eae)
    ids.update(row.account_id for row in parsed.account_information)
    return ids


def _scope_result(parsed: FlexParseResult, account_id: str) -> FlexParseResult:
    return FlexParseResult(
        trades=[row for row in parsed.trades if row.account_id == account_id],
        cash_transactions=[row for row in parsed.cash_transactions if row.account_id == account_id],
        open_positions=[row for row in parsed.open_positions if row.account_id == account_id],
        stock_positions=[row for row in parsed.stock_positions if row.account_id == account_id],
        bond_positions=[row for row in parsed.bond_positions if row.account_id == account_id],
        dividend_payments=[row for row in parsed.dividend_payments if row.account_id == account_id],
        dividend_accruals=[row for row in parsed.dividend_accruals if row.account_id == account_id],
        security_infos=[row for row in parsed.security_infos if row.account_id == account_id or not row.account_id],
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
    for dividend in parsed.dividend_payments:
        _upsert_dividend_payment(session, account_id, dividend)
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
    # Accruals: pass all accruals together so windows are calculated once.
    _sync_dividend_accruals(
        session,
        account_id,
        parsed.dividend_accruals,
        report_date=None,
    )
    # Security reference: seed from open positions (STK + BOND identifiers).
    _seed_security_reference_from_positions(session, parsed)
    _upsert_sync_state(session, household_id, account_id, parsed, from_date, to_date)
    return {
        "trade_count": len(trades_to_insert),
        "cash_event_count": len(parsed.cash_transactions),
        "dividend_payment_count": len(parsed.dividend_payments),
        "dividend_accrual_count": len(parsed.dividend_accruals),
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
        stock_positions=[row for row in parsed.stock_positions if in_window(row.as_of_date)],
        bond_positions=[row for row in parsed.bond_positions if in_window(row.as_of_date)],
        dividend_payments=[row for row in parsed.dividend_payments if in_window(row.report_date)],
        dividend_accruals=[row for row in parsed.dividend_accruals if in_window(row.report_date)],
        security_infos=parsed.security_infos,  # static reference data — always keep
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


def _update_config_last_synced(session: Session, config_id: int | None) -> None:
    """Stamp trading_account_config.last_synced / last_synced_at to UTC now.

    Called only after a successful per-account Flex ingest so the Accounts page
    reflects the real last-sync time.  No-ops when config_id is None (account
    matched without a config row, e.g. wildcard mode).
    """
    if config_id is None:
        return
    session.execute(
        text(
            """
            update public.trading_account_config
               set last_synced    = now(),
                   last_synced_at = now()
             where id = :config_id
            """
        ),
        {"config_id": config_id},
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
