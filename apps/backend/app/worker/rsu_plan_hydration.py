"""RSU plan hydration worker.

Runs nightly at 22:05 UTC — five minutes after ``yahoo_price_refresh`` (22:00) —
so that fresh price + dividend_yield data is already in ``public.price_cache``
when this job executes.

What it does
------------
1. Scans all rows in ``public.plans`` and ``public.finance_snapshots`` for
   account items where ``account_settings.type == 'RSU'`` **and**
   ``account_settings.stock_symbol`` is non-empty.
2. Looks up the ticker in ``public.price_cache`` (USD denomination).
3. Writes back into the JSON blob:
   - ``account_settings.current_price``  — latest mark price (string Decimal)
   - ``account_settings.dividend_yield`` — trailing 12m yield as percentage form
     (0.87 for 0.87%); ``0`` when no dividend.
   - ``account_settings.dividend_tax_rate`` — **fixed at 25 %** per business rule
     (RSU dividends taxed at 25 % regardless of the plan's global incomeTaxRate).
   - ``account_settings.dividend_policy`` — forced to ``"Payout"`` so RSU dividend
     income flows into the income pool rather than being re-invested.
4. Finance snapshot items store dividend settings in ``details`` (the field read
   by ``plan_components.AccountManager.load_accounts``), so we write there too.

RSU-specific business rules (from copilot-rsu-rules.md)
---------------------------------------------------------
- Dividend tax rate: 25 % (fixed, not the plan-level incomeTaxRate).
- Dividends cannot be re-invested → ``dividend_policy = "Payout"``.
- WIX pays no dividend → ``dividend_yield = 0``, income = 0.
- MSFT yields ~0.87 % → stored as ``0.87`` in ``dividend_yield``, flows into the income pool each simulation year.

Ticker resolution note
----------------------
Both MSFT (NASDAQ) and WIX (NYSE) are USD-denominated US-market tickers.
``resolve_yahoo_ticker`` in ``yahoo_refresh`` returns them verbatim — no
TASE map or exchange suffix required.
"""

from __future__ import annotations

import copy
import logging
import os
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import direct_engine
from app.services.price_cache import CachedPriceData, lookup_cached_price_data, normalize_symbol
from app.worker.registry import JOB_SCHEDULES, JobSchedule

logger = logging.getLogger(__name__)

RSU_HYDRATION_JOB_ID = "rsu_plan_hydration"
RSU_HYDRATION_CRON_DEFAULT = "5 22 * * MON-FRI"

# RSU dividend tax rate is fixed by business rule — not the plan's incomeTaxRate.
_RSU_DIVIDEND_TAX_RATE = Decimal("25")
# RSU dividends cannot be re-invested; they go to the income pool.
_RSU_DIVIDEND_POLICY = "Payout"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_rsu_item(item: dict[str, Any]) -> bool:
    """Return True if this plan/snapshot JSON item represents an RSU account."""
    item_type = (item.get("type") or "").lower()
    sub_cat = (item.get("sub_category") or "").lower()
    acc_type = (item.get("account_settings") or {}).get("type", "")

    return item_type == "rsu" or sub_cat == "rsu" or (isinstance(acc_type, str) and acc_type.upper() == "RSU")


def _get_stock_symbol(item: dict[str, Any]) -> str | None:
    """Extract and normalise the configured stock ticker from a plan/snapshot item."""
    acc_settings = item.get("account_settings") or {}
    raw = acc_settings.get("stock_symbol") or ""
    normalised = normalize_symbol(raw) if raw.strip() else None
    return normalised


def _apply_rsu_hydration(
    item: dict[str, Any],
    cached: CachedPriceData,
) -> dict[str, Any]:
    """Return a copy of *item* with RSU price and dividend settings patched in.

    For plan items ``account_settings`` is the authoritative config dict used
    by the simulation engine.  For snapshot items we also write into ``details``
    because ``plan_components.AccountManager.load_accounts`` reads dividend
    settings from ``f_item['details']`` when building the merged account dict.
    """
    item = copy.deepcopy(item)

    dividend_yield_decimal = cached.dividend_yield if cached.dividend_yield is not None else Decimal("0")

    # ----- account_settings (plan items, also present on snapshot items) -----
    acc_settings: dict[str, Any] = item.setdefault("account_settings", {})
    acc_settings["current_price"] = str(cached.price)
    acc_settings["dividend_yield"] = str(dividend_yield_decimal)
    acc_settings["dividend_tax_rate"] = str(_RSU_DIVIDEND_TAX_RATE)
    acc_settings["dividend_policy"] = _RSU_DIVIDEND_POLICY

    # ----- details (snapshot items read dividend config from here) -----------
    details: dict[str, Any] = item.setdefault("details", {})
    details["current_price"] = str(cached.price)
    details["dividend_yield"] = str(dividend_yield_decimal)
    details["dividend_tax_rate"] = str(_RSU_DIVIDEND_TAX_RATE)
    details["dividend_policy"] = _RSU_DIVIDEND_POLICY

    return item


# ---------------------------------------------------------------------------
# Plan hydration
# ---------------------------------------------------------------------------


def _hydrate_plans(session: Session, price_lookup: dict[str, CachedPriceData]) -> int:
    """Patch RSU account_settings in all rows of public.plans.

    Returns the number of plan items updated.
    """
    rows = session.execute(text("SELECT id, data FROM public.plans WHERE data IS NOT NULL")).mappings().all()

    updated_count = 0

    for row in rows:
        plan_id = row["id"]
        data: dict[str, Any] = dict(row["data"]) if row["data"] else {}
        items: list[dict[str, Any]] = data.get("items", [])

        changed = False
        new_items: list[dict[str, Any]] = []

        for item in items:
            if not _is_rsu_item(item):
                new_items.append(item)
                continue

            symbol = _get_stock_symbol(item)
            if not symbol:
                logger.warning(
                    "[rsu_hydration] Plan %s has RSU item '%s' with no stock_symbol — skipping",
                    plan_id,
                    item.get("name"),
                )
                new_items.append(item)
                continue

            cached = price_lookup.get(symbol)
            if cached is None:
                logger.warning(
                    "[rsu_hydration] Plan %s RSU item '%s' ticker=%s — not in price_cache yet",
                    plan_id,
                    item.get("name"),
                    symbol,
                )
                new_items.append(item)
                continue

            patched = _apply_rsu_hydration(item, cached)
            new_items.append(patched)
            changed = True
            updated_count += 1
            logger.info(
                "[rsu_hydration] Plan %s RSU '%s' ticker=%s price=%s yield=%s",
                plan_id,
                item.get("name"),
                symbol,
                cached.price,
                cached.dividend_yield,
            )

        if changed:
            data["items"] = new_items
            session.execute(
                text("UPDATE public.plans SET data = :data::jsonb, updated_at = NOW() WHERE id = :id"),
                {"data": _to_json_str(data), "id": plan_id},
            )

    return updated_count


def _hydrate_snapshots(session: Session, price_lookup: dict[str, CachedPriceData]) -> int:
    """Patch RSU price/yield into all rows of public.finance_snapshots.

    Returns the number of snapshot items updated.
    """
    rows = (
        session.execute(
            text(
                """
            SELECT household_id, date, data
              FROM public.finance_snapshots
             WHERE data IS NOT NULL
            """
            )
        )
        .mappings()
        .all()
    )

    updated_count = 0

    for row in rows:
        hh_id = row["household_id"]
        snap_date = row["date"]
        data: dict[str, Any] = dict(row["data"]) if row["data"] else {}
        items: list[dict[str, Any]] = data.get("items", [])

        changed = False
        new_items: list[dict[str, Any]] = []

        for item in items:
            if not _is_rsu_item(item):
                new_items.append(item)
                continue

            symbol = _get_stock_symbol(item)
            if not symbol:
                new_items.append(item)
                continue

            cached = price_lookup.get(symbol)
            if cached is None:
                logger.warning(
                    "[rsu_hydration] Snapshot %s/%s RSU '%s' ticker=%s — not in price_cache",
                    hh_id,
                    snap_date,
                    item.get("name"),
                    symbol,
                )
                new_items.append(item)
                continue

            patched = _apply_rsu_hydration(item, cached)
            new_items.append(patched)
            changed = True
            updated_count += 1

        if changed:
            data["items"] = new_items
            session.execute(
                text(
                    """
                    UPDATE public.finance_snapshots
                       SET data = :data::jsonb
                     WHERE household_id = :hh_id
                       AND date = :date
                    """
                ),
                {"data": _to_json_str(data), "hh_id": str(hh_id), "date": str(snap_date)},
            )

    return updated_count


def _to_json_str(obj: Any) -> str:
    """Serialise a Python dict to a JSON string for Postgres JSONB binding."""
    import json

    return json.dumps(obj, default=str)


# ---------------------------------------------------------------------------
# Price-cache lookup
# ---------------------------------------------------------------------------


def _build_price_lookup(session: Session, symbols: list[str]) -> dict[str, CachedPriceData]:
    """Return a dict of normalised_symbol → CachedPriceData for the given tickers.

    All RSU tickers are USD-denominated (MSFT, WIX are both NYSE/NASDAQ).
    """
    result: dict[str, CachedPriceData] = {}
    for sym in symbols:
        cached = lookup_cached_price_data(sym, "USD", session)
        if cached is not None:
            result[sym] = cached
    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def hydrate_rsu_plan_accounts() -> dict[str, Any]:
    """Scan all plans and snapshots, hydrating RSU accounts from price_cache.

    Returns:
        A summary dict: {rsu_tickers, plans_updated, snapshots_updated}.
    """
    logger.info("[rsu_hydration] Starting RSU plan hydration")

    # Phase 1: Discover all RSU tickers referenced across plans + snapshots.
    rsu_tickers: set[str] = set()

    with Session(direct_engine) as session:
        for table, data_col in [("public.plans", "data"), ("public.finance_snapshots", "data")]:
            rows = session.execute(text(f"SELECT {data_col} FROM {table} WHERE {data_col} IS NOT NULL")).scalars().all()
            for data in rows:
                if not isinstance(data, dict):
                    continue
                for item in data.get("items", []):
                    if _is_rsu_item(item):
                        sym = _get_stock_symbol(item)
                        if sym:
                            rsu_tickers.add(sym)

    logger.info("[rsu_hydration] RSU tickers found: %s", sorted(rsu_tickers))

    if not rsu_tickers:
        logger.info("[rsu_hydration] No RSU accounts configured — nothing to do")
        return {"rsu_tickers": [], "plans_updated": 0, "snapshots_updated": 0}

    # Phase 2: Look up price_cache for each ticker and hydrate.
    with Session(direct_engine) as session:
        price_lookup = _build_price_lookup(session, sorted(rsu_tickers))

        missing = rsu_tickers - set(price_lookup.keys())
        if missing:
            logger.warning(
                "[rsu_hydration] Tickers not yet in price_cache (nightly refresh may not have run): %s",
                sorted(missing),
            )

        plans_updated = _hydrate_plans(session, price_lookup)
        snapshots_updated = _hydrate_snapshots(session, price_lookup)
        session.commit()

    summary = {
        "rsu_tickers": sorted(rsu_tickers),
        "plans_updated": plans_updated,
        "snapshots_updated": snapshots_updated,
    }
    logger.info("[rsu_hydration] Complete: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# Schedule registration
# ---------------------------------------------------------------------------


def _rsu_hydration_cron() -> str:
    return os.getenv("RSU_HYDRATION_CRON", RSU_HYDRATION_CRON_DEFAULT)


def _run_rsu_hydration_job() -> None:
    """Scheduler entry point — swallows exceptions so the worker keeps running."""
    try:
        hydrate_rsu_plan_accounts()
    except Exception:  # noqa: BLE001
        logger.exception("[rsu_hydration] Unexpected exception in RSU plan hydration job")


if not any(schedule.job_id == RSU_HYDRATION_JOB_ID for schedule in JOB_SCHEDULES):
    JOB_SCHEDULES.append(
        JobSchedule(
            job_id=RSU_HYDRATION_JOB_ID,
            kind="cron",
            cron_expr=_rsu_hydration_cron(),
            handler=_run_rsu_hydration_job,
        )
    )
