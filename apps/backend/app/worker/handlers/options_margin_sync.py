"""Worker handler for account-wide options margin snapshots."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import logging
from typing import Literal

from ib_async import IB
from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import engine
from app.services.trading_batch import ib_gateway_endpoint, is_ib_gateway_available
from app.worker.handlers.options_sync import OptionsAccount, _load_accounts

logger = logging.getLogger(__name__)
JobPayload = dict[str, object]
JobResult = dict[str, object]
SessionFactory = Callable[[], AbstractContextManager[Session]]
MarginSource = Literal["ib_gateway", "flex", "synthetic"]
ZERO = Decimal("0")


@dataclass(frozen=True)
class MarginSnapshot:
    """Account-wide margin figures for one options-enabled account."""

    household_id: str
    account_id: str
    account_config_id: int | None
    captured_at: datetime
    margin_used: Decimal | None
    margin_available: Decimal | None
    buying_power: Decimal | None
    source: MarginSource


def _default_session_factory() -> AbstractContextManager[Session]:
    """Return a worker database session."""

    return Session(engine)


def handle_options_margin_sync(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Persist live IB Gateway margin snapshots or synthetic fallbacks."""

    with (session_factory or _default_session_factory)() as session:
        result = run_options_margin_sync(session, account_id=_optional_str(payload.get("account_id")))
        session.commit()
        return result


def run_scheduled_options_margin_sync() -> None:
    """Scheduled entry point for the daily post-Flex margin refresh."""

    with _default_session_factory() as session:
        result = run_options_margin_sync(session)
        session.commit()
    logger.info("Scheduled options_margin_sync completed: %s", result)


def run_intraday_options_margin_sync() -> None:
    """Scheduled entry point for 15-minute IB Gateway margin refreshes."""

    host, port = ib_gateway_endpoint()
    if not is_ib_gateway_available(host, port, timeout=1.5):
        logger.info("IB Gateway offline, skipping intraday options margin sync")
        return
    run_scheduled_options_margin_sync()


def run_options_margin_sync(session: Session, *, account_id: str | None = None) -> JobResult:
    """Capture margin snapshots for options-enabled accounts with graceful fallback."""

    accounts = [account for account in _load_accounts(session, account_id=account_id) if account.account_id]
    if not accounts:
        return {"status": "skipped", "reason": "no_options_accounts", "snapshots": 0, "source": None}

    captured_at = _captured_minute()
    live_snapshots = _try_ib_gateway_snapshots(accounts, captured_at)
    snapshots: list[MarginSnapshot]
    source: MarginSource
    if live_snapshots:
        snapshots = live_snapshots
        source = "ib_gateway"
    else:
        snapshots = [_synthetic_snapshot(session, account, captured_at) for account in accounts if account.account_id]
        source = "synthetic"

    for snapshot in snapshots:
        _upsert_snapshot(session, snapshot)
    return {"status": "succeeded", "snapshots": len(snapshots), "source": source}


def _try_ib_gateway_snapshots(accounts: list[OptionsAccount], captured_at: datetime) -> list[MarginSnapshot]:
    host, port = ib_gateway_endpoint()
    if not is_ib_gateway_available(host, port, timeout=1.5):
        return []
    try:
        return asyncio.run(_load_ib_gateway_snapshots(accounts, captured_at, host, port))
    except Exception as exc:  # noqa: BLE001 - margin sync must fall back in CI/dev
        logger.warning("IB Gateway margin snapshot failed; using synthetic fallback: %s", exc)
        return []


async def _load_ib_gateway_snapshots(
    accounts: list[OptionsAccount], captured_at: datetime, host: str, port: int
) -> list[MarginSnapshot]:
    ib = IB()
    client_id = _margin_client_id(accounts)
    await ib.connectAsync(host, port, clientId=client_id, timeout=5)
    try:
        summary = await ib.accountSummaryAsync()
        by_account: dict[str, dict[str, Decimal]] = {}
        for item in summary:
            account = str(getattr(item, "account", "") or "")
            tag = str(getattr(item, "tag", ""))
            value = _decimal(getattr(item, "value", None))
            if not account or value is None:
                continue
            by_account.setdefault(account, {})[tag] = value

        snapshots: list[MarginSnapshot] = []
        for account in accounts:
            if not account.account_id:
                continue
            values = by_account.get(account.account_id, {})
            if not values:
                continue
            margin_used = values.get("MaintMarginReq") or values.get("FullMaintMarginReq")
            net_liq = values.get("NetLiquidation")
            buying_power = values.get("BuyingPower")
            margin_available = (net_liq - margin_used) if net_liq is not None and margin_used is not None else None
            snapshots.append(
                MarginSnapshot(
                    household_id=account.household_id,
                    account_id=account.account_id,
                    account_config_id=account.config_id,
                    captured_at=captured_at,
                    margin_used=margin_used,
                    margin_available=margin_available,
                    buying_power=buying_power,
                    source="ib_gateway",
                )
            )
        return snapshots
    finally:
        if ib.isConnected():
            ib.disconnect()


def _synthetic_snapshot(session: Session, account: OptionsAccount, captured_at: datetime) -> MarginSnapshot:
    account_id = account.account_id or ""
    margin_used = session.execute(
        text(
            """
            select coalesce(sum(capital_at_risk_open), 0)::numeric as margin_used
              from public.options_strategy_groups
             where household_id = :household_id
               and account_id = :account_id
               and status = 'open'
               and capital_at_risk_open is not null
            """
        ),
        {"household_id": account.household_id, "account_id": account_id},
    ).scalar_one_or_none()
    used = Decimal(str(margin_used or ZERO))
    available = used * Decimal("3") if used > ZERO else ZERO
    return MarginSnapshot(
        household_id=account.household_id,
        account_id=account_id,
        account_config_id=account.config_id,
        captured_at=captured_at,
        margin_used=used,
        margin_available=available,
        buying_power=available,
        source="synthetic",
    )


def _upsert_snapshot(session: Session, snapshot: MarginSnapshot) -> None:
    session.execute(
        text(
            """
            insert into public.options_margin_snapshots (
              household_id, account_id, account_config_id, captured_at,
              margin_used, margin_available, buying_power, source
            ) values (
              :household_id, :account_id, :account_config_id, :captured_at,
              :margin_used, :margin_available, :buying_power, :source
            )
            on conflict on constraint options_margin_snapshots_account_captured_key do update set
              account_config_id = excluded.account_config_id,
              margin_used = excluded.margin_used,
              margin_available = excluded.margin_available,
              buying_power = excluded.buying_power,
              source = excluded.source,
              updated_at = now()
            """
        ),
        {
            "household_id": snapshot.household_id,
            "account_id": snapshot.account_id,
            "account_config_id": snapshot.account_config_id,
            "captured_at": snapshot.captured_at,
            "margin_used": snapshot.margin_used,
            "margin_available": snapshot.margin_available,
            "buying_power": snapshot.buying_power,
            "source": snapshot.source,
        },
    )


def _margin_client_id(accounts: list[OptionsAccount]) -> int:
    base = next((account.config_id for account in accounts if account.config_id is not None), 7)
    return int(base) + 1000


def _captured_minute() -> datetime:
    return datetime.now(timezone.utc).replace(second=0, microsecond=0)


def _decimal(value: object) -> Decimal | None:
    try:
        return Decimal(str(value).replace(",", ""))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
