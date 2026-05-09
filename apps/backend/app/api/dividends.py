from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Dict, Any
import logging
from uuid import UUID
from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.dividend_models import (
    DividendPosition,
    DividendPositionCreate,  # Legacy
)
from app.services import dividend_service
from app.services.household_service import get_user_household_id

logger = logging.getLogger(__name__)
router = APIRouter(
    tags=["dividends"]
)  # Prefix handled in main.py usually, checking main.py it is prefix="/api", tags=["dividends"]

# --- New Dashboard Endpoints ---


@router.get("/dividends/dashboard", response_model=Dict[str, Any])
def get_dividend_dashboard(
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
    account: str = Query(None),
    currency: str = Query("USD"),
    db: Session = Depends(get_session),
):
    """
    Get dashboard stats and enriched positions for the authenticated user's household.
    Optionally filter by account.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    positions = dividend_service.get_all_positions(db, household_id=household_id, account=account)

    # Trigger background cache update
    if positions:
        tickers = list(set(p.ticker for p in positions))
        background_tasks.add_task(dividend_service.update_dividend_cache_background, tickers)

    result = dividend_service.enrich_positions(positions, db, target_currency=currency)
    return result


@router.post("/dividends/position", response_model=DividendPosition)
def create_dividend_position(
    position: DividendPositionCreate, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_session)
):
    """Create a new dividend position in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    return dividend_service.create_position(db, position, household_id)


@router.put("/dividends/position/{position_id}", response_model=DividendPosition)
def update_dividend_position(
    position_id: int,
    position: DividendPositionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
):
    """Update an existing dividend position in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    updated = dividend_service.update_position(db, position_id, position, household_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Position not found")
    return updated


@router.delete("/dividends/position/{position_id}", response_model=bool)
def delete_dividend_position(
    position_id: int, user_id: UUID = Depends(get_current_user_id), db: Session = Depends(get_session)
):
    """Delete a dividend position by ID from the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    success = dividend_service.delete_position(db, position_id, household_id)
    if not success:
        raise HTTPException(status_code=404, detail="Position not found")
    return True


# --- Legacy / Existing Endpoints (REMOVED - XLSX file storage deprecated) ---
# The following endpoints have been removed as part of migration to DB storage:
# - GET /dividends (load_dividends from XLSX)
# - POST /dividends (save_dividends to XLSX)
# - POST /dividends/projection (uses XLSX historical data)
#
# Frontend should migrate to use:
# - GET /dividends/dashboard for dashboard data
# - POST/PUT/DELETE /dividends/position for CRUD operations


# ---------------------------------------------------------------------------
# Dividend Projection — Issue #340 Phase 2 (H4)
# ---------------------------------------------------------------------------


@router.get("/dividends/projection", response_model=Dict[str, Any])
def get_dividend_projection(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
):
    """Return annual dividend projection by ticker and by account.

    **Primary path:** reads from ``stock_positions`` joined with
    ``dividend_ticker_data`` on ticker symbol.  Formula:
        annual_dividend = quantity × dividend_rate   (rate is already annualised)

    **Fallback path (#342 regression guard):** if ``stock_positions`` is empty
    for the authenticated household the endpoint falls back to summing
    ``dividend_positions`` (the legacy manual table) so the dashboard summary
    chart never returns zero for projection years before the Flex sync has run.

    Response shape::

        {
          "total_annual": 1234.56,
          "source": "stock_positions" | "dividend_positions_fallback",
          "by_ticker": [
            {"ticker": "VYM", "quantity": 50.0, "annual": 234.5}, ...
          ],
          "by_account": [
            {"account_id": 1, "name": "IBKR", "annual": 567.8}, ...
          ]
        }
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    household_id_str = str(household_id)

    # ------------------------------------------------------------------
    # Primary: stock_positions JOIN dividend_ticker_data
    # ------------------------------------------------------------------
    ticker_rows = (
        db.execute(
            text(
                """
            select
              sp.ticker,
              sum(sp.quantity)                              as total_quantity,
              dtd.dividend_rate,
              sum(sp.quantity) * dtd.dividend_rate          as annual_dividend,
              sp.account_id,
              tac.name                                      as account_name
            from public.stock_positions sp
            join public.dividend_ticker_data dtd on dtd.ticker = sp.ticker
            join public.trading_account_config tac on tac.id = sp.account_id
            where sp.household_id = :household_id
              and sp.as_of_date = (
                  -- latest snapshot per (household, account)
                  select max(sp2.as_of_date)
                    from public.stock_positions sp2
                   where sp2.household_id = sp.household_id
                     and sp2.account_id = sp.account_id
              )
            group by sp.ticker, dtd.dividend_rate, sp.account_id, tac.name
            order by sp.ticker
            """
            ),
            {"household_id": household_id_str},
        )
        .mappings()
        .all()
    )

    if ticker_rows:
        # Aggregate by ticker
        by_ticker: dict[str, dict] = {}
        for r in ticker_rows:
            t = r["ticker"]
            if t not in by_ticker:
                by_ticker[t] = {
                    "ticker": t,
                    "quantity": float(r["total_quantity"]),
                    "annual": float(r["annual_dividend"] or 0),
                }
            else:
                by_ticker[t]["quantity"] += float(r["total_quantity"])
                by_ticker[t]["annual"] += float(r["annual_dividend"] or 0)

        # Aggregate by account
        by_account: dict[int, dict] = {}
        for r in ticker_rows:
            aid = r["account_id"]
            if aid not in by_account:
                by_account[aid] = {
                    "account_id": aid,
                    "name": r["account_name"],
                    "annual": float(r["annual_dividend"] or 0),
                }
            else:
                by_account[aid]["annual"] += float(r["annual_dividend"] or 0)

        total = sum(v["annual"] for v in by_ticker.values())
        return {
            "total_annual": round(total, 2),
            "source": "stock_positions",
            "by_ticker": sorted(by_ticker.values(), key=lambda x: x["ticker"]),
            "by_account": sorted(by_account.values(), key=lambda x: x["account_id"]),
        }

    # ------------------------------------------------------------------
    # Fallback: legacy dividend_positions (#342 regression guard)
    # ------------------------------------------------------------------
    logger.info(
        "dividend projection: stock_positions empty for household %s — falling back to dividend_positions table",
        household_id_str,
    )
    fallback_rows = (
        db.execute(
            text(
                """
            select
              dp.ticker,
              sum(dp.shares)                          as total_quantity,
              dtd.dividend_rate,
              sum(dp.shares) * dtd.dividend_rate      as annual_dividend,
              dp.account
            from public.dividend_positions dp
            join public.dividend_ticker_data dtd on dtd.ticker = dp.ticker
            where dp.household_id = :household_id
            group by dp.ticker, dtd.dividend_rate, dp.account
            order by dp.ticker
            """
            ),
            {"household_id": household_id_str},
        )
        .mappings()
        .all()
    )

    by_ticker_fb: dict[str, dict] = {}
    by_account_fb: dict[str, dict] = {}
    for r in fallback_rows:
        t = r["ticker"]
        if t not in by_ticker_fb:
            by_ticker_fb[t] = {
                "ticker": t,
                "quantity": float(r["total_quantity"]),
                "annual": float(r["annual_dividend"] or 0),
            }
        else:
            by_ticker_fb[t]["quantity"] += float(r["total_quantity"])
            by_ticker_fb[t]["annual"] += float(r["annual_dividend"] or 0)

        acct = str(r["account"])
        if acct not in by_account_fb:
            by_account_fb[acct] = {"account_id": acct, "name": acct, "annual": float(r["annual_dividend"] or 0)}
        else:
            by_account_fb[acct]["annual"] += float(r["annual_dividend"] or 0)

    total_fb = sum(v["annual"] for v in by_ticker_fb.values())
    return {
        "total_annual": round(total_fb, 2),
        "source": "dividend_positions_fallback",
        "by_ticker": sorted(by_ticker_fb.values(), key=lambda x: x["ticker"]),
        "by_account": sorted(by_account_fb.values(), key=lambda x: x["account_id"]),
    }
