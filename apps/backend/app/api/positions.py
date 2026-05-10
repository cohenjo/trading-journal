"""Manual stock-position CRUD API — issue #340 Phase 2 (H2).

Endpoints:
    POST   /api/accounts/positions          — create manual position
    PUT    /api/accounts/positions/{id}     — update manual position
    DELETE /api/accounts/positions/{id}     — delete manual position
    GET    /api/accounts/positions          — list positions (optionally by account)

Flex-sourced positions (source='flex') are written exclusively by the
options_sync worker; manual writes to IBKR accounts are rejected here.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlmodel import Session

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.services.household_service import get_user_household_id

logger = logging.getLogger(__name__)
router = APIRouter(tags=["positions"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class StockPositionCreate(BaseModel):
    """Payload for creating a manual stock position."""

    account_id: int = Field(..., description="trading_account_config.id")
    ticker: str = Field(..., min_length=1, max_length=20)
    quantity: Decimal = Field(..., gt=0, description="Must be positive")
    cost_basis: Optional[Decimal] = Field(None, description="Per-share average cost (NULL = unknown)")
    currency: str = Field("USD", min_length=3, max_length=10)
    as_of_date: date

    @field_validator("ticker")
    @classmethod
    def ticker_not_blank(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("ticker must not be blank")
        return v


class StockPositionUpdate(BaseModel):
    """Payload for updating a manual stock position (partial)."""

    quantity: Optional[Decimal] = Field(None, gt=0)
    cost_basis: Optional[Decimal] = None
    as_of_date: Optional[date] = None


class StockPositionRow(BaseModel):
    """Response model for a single stock position row."""

    id: UUID
    household_id: UUID
    account_id: int
    account_name: Optional[str] = None
    account_type: Optional[str] = None
    ticker: str
    quantity: Decimal
    cost_basis: Optional[Decimal] = None
    currency: str
    as_of_date: date
    source: str
    con_id: Optional[int] = None
    description: Optional[str] = None
    sub_category: Optional[str] = None
    mark_price: Optional[Decimal] = None
    market_value: Optional[Decimal] = None
    unrealized_pnl: Optional[Decimal] = None
    last_broker_sync_at: Optional[Any] = None
    created_at: Any
    updated_at: Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_household(db: Session, user_id: UUID) -> str:
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    return str(household_id)


def _get_account(db: Session, account_id: int, household_id: str) -> dict[str, Any]:
    """Fetch the trading_account_config row; raise 404 if not found or wrong household."""
    row = (
        db.execute(
            text(
                """
            select id, name, account_type
              from public.trading_account_config
             where id = :account_id
               and household_id = :household_id
               and deleted_at is null
            """
            ),
            {"account_id": account_id, "household_id": household_id},
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Account {account_id} not found for this household")
    return dict(row)


def _reject_ibkr_manual_write(account: dict[str, Any]) -> None:
    """Raise 422 if attempting to manually write positions for an IBKR account.

    IBKR positions are Flex-only (source='flex'). Manual CRUD is reserved for
    Schwab and IRA accounts where no automated sync exists.
    """
    if (account.get("account_type") or "").lower() == "ibkr":
        raise HTTPException(
            status_code=422,
            detail=(
                "Cannot create manual positions for an IBKR account. "
                "IBKR positions are populated automatically via the Flex sync."
            ),
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/accounts/positions", response_model=StockPositionRow, status_code=201)
def create_position(
    body: StockPositionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> StockPositionRow:
    """Create a manual stock position for a non-IBKR account."""
    household_id = _resolve_household(db, user_id)
    account = _get_account(db, body.account_id, household_id)
    _reject_ibkr_manual_write(account)

    row = (
        db.execute(
            text(
                """
            insert into public.stock_positions
              (household_id, account_id, ticker, quantity, cost_basis,
               currency, as_of_date, source, created_by)
            values
              (:household_id, :account_id, :ticker, :quantity, :cost_basis,
               :currency, :as_of_date, 'manual', :created_by)
            returning
              id, household_id, account_id, ticker, quantity, cost_basis,
              currency, as_of_date, source, con_id, description, sub_category,
              mark_price, market_value, unrealized_pnl, last_broker_sync_at,
              created_at, updated_at
            """
            ),
            {
                "household_id": household_id,
                "account_id": body.account_id,
                "ticker": body.ticker,
                "quantity": body.quantity,
                "cost_basis": body.cost_basis,
                "currency": body.currency,
                "as_of_date": body.as_of_date,
                "created_by": str(user_id),
            },
        )
        .mappings()
        .one()
    )
    db.commit()

    return StockPositionRow(
        **dict(row),
        account_name=account["name"],
        account_type=account["account_type"],
    )


@router.put("/accounts/positions/{position_id}", response_model=StockPositionRow)
def update_position(
    position_id: UUID,
    body: StockPositionUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> StockPositionRow:
    """Update quantity, cost_basis, or as_of_date on a manual position."""
    household_id = _resolve_household(db, user_id)

    # Verify ownership and that the position is manual (not flex)
    existing = (
        db.execute(
            text(
                """
            select sp.id, sp.account_id, sp.source, tac.account_type, tac.name as account_name
              from public.stock_positions sp
              join public.trading_account_config tac on tac.id = sp.account_id
             where sp.id = :id
               and sp.household_id = :household_id
            """
            ),
            {"id": str(position_id), "household_id": household_id},
        )
        .mappings()
        .first()
    )

    if not existing:
        raise HTTPException(status_code=404, detail="Position not found")
    if existing["source"] != "manual":
        raise HTTPException(status_code=422, detail="Only manual positions can be updated via this endpoint")

    # Build partial update
    updates: list[str] = []
    params: dict[str, Any] = {"id": str(position_id), "household_id": household_id}
    if body.quantity is not None:
        updates.append("quantity = :quantity")
        params["quantity"] = body.quantity
    if body.cost_basis is not None:
        updates.append("cost_basis = :cost_basis")
        params["cost_basis"] = body.cost_basis
    if body.as_of_date is not None:
        updates.append("as_of_date = :as_of_date")
        params["as_of_date"] = body.as_of_date

    if not updates:
        raise HTTPException(status_code=422, detail="No fields provided to update")

    row = (
        db.execute(
            text(
                f"""
            update public.stock_positions
               set {", ".join(updates)}
             where id = :id
               and household_id = :household_id
            returning
              id, household_id, account_id, ticker, quantity, cost_basis,
              currency, as_of_date, source, con_id, description, sub_category,
              mark_price, market_value, unrealized_pnl, last_broker_sync_at,
              created_at, updated_at
            """  # noqa: S608 — no user input in set clause
            ),
            params,
        )
        .mappings()
        .one()
    )
    db.commit()

    return StockPositionRow(
        **dict(row),
        account_name=existing["account_name"],
        account_type=existing["account_type"],
    )


@router.delete("/accounts/positions/{position_id}", status_code=200)
def delete_position(
    position_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> dict:
    """Hard-delete a manual stock position."""
    household_id = _resolve_household(db, user_id)

    result = db.execute(
        text(
            """
            delete from public.stock_positions
             where id = :id
               and household_id = :household_id
               and source = 'manual'
            """
        ),
        {"id": str(position_id), "household_id": household_id},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="Position not found, not manual, or not in your household",
        )
    return {"deleted": True}


@router.get("/accounts/positions", response_model=list[StockPositionRow])
def list_positions(
    account_id: Optional[int] = Query(None, description="Filter by account"),
    as_of_date: Optional[date] = Query(None, description="Filter by snapshot date"),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> list[StockPositionRow]:
    """List current stock positions for the authenticated user's household.

    Joins with trading_account_config to include account name and type.

    Flex positions: only rows whose as_of_date equals the latest Flex snapshot
    date for each account are returned.  Tickers absent from the latest
    snapshot (e.g. stocks that were sold) are excluded — not surfaced as
    "most recent per ticker" from an older snapshot.

    Manual positions: most-recent row per (account_id, ticker) is returned,
    matching the DISTINCT ON semantics since manual rows are edited in-place.

    If as_of_date is supplied it constrains the candidate rows AND the
    max-snapshot computation, making historical lookups work correctly.
    """
    household_id = _resolve_household(db, user_id)

    filters = ["sp.household_id = :household_id"]
    params: dict[str, Any] = {"household_id": household_id}

    if account_id is not None:
        filters.append("sp.account_id = :account_id")
        params["account_id"] = account_id
    if as_of_date is not None:
        filters.append("sp.as_of_date = :as_of_date")
        params["as_of_date"] = as_of_date

    where = " and ".join(filters)

    # max_flex_snap CTE: computes the latest Flex snapshot date per account.
    # Any as_of_date / account_id params already in `filters` are mirrored here
    # so that an explicit as_of_date=X yields max=X (historical-lookup compat).
    cte_filters_list = ["household_id = :household_id", "source = 'flex'"]
    if account_id is not None:
        cte_filters_list.append("account_id = :account_id")
    if as_of_date is not None:
        cte_filters_list.append("as_of_date = :as_of_date")
    cte_where = " and ".join(cte_filters_list)

    rows = (
        db.execute(
            text(
                f"""
            with max_flex_snap as (
              -- Latest Flex snapshot date per account. Positions absent from
              -- this snapshot (e.g. sold holdings) are excluded rather than
              -- surfaced as the "most recent" row for that ticker.
              select account_id, max(as_of_date) as latest_date
                from public.stock_positions
               where {cte_where}
               group by account_id
            ),
            latest_positions as (
              select distinct on (sp.account_id, sp.ticker)
                sp.id, sp.household_id, sp.account_id,
                tac.name as account_name, tac.account_type,
                sp.ticker, sp.quantity, sp.cost_basis, sp.currency,
                sp.as_of_date, sp.source, sp.con_id, sp.description,
                sp.sub_category, sp.mark_price, sp.market_value,
                sp.unrealized_pnl, sp.last_broker_sync_at,
                sp.created_at, sp.updated_at
              from public.stock_positions sp
              join public.trading_account_config tac on tac.id = sp.account_id
              -- Flex: restrict to latest snapshot date only (excludes sold positions).
              -- Manual: all dates pass through; DISTINCT ON handles per-ticker dedup.
              left join max_flex_snap mfs on mfs.account_id = sp.account_id
              where {where}
                and (
                  (sp.source = 'flex' and sp.as_of_date = mfs.latest_date)
                  or sp.source = 'manual'
                )
              order by
                sp.account_id,
                sp.ticker,
                sp.as_of_date desc,
                sp.updated_at desc,
                sp.created_at desc,
                sp.id desc
            )
            select *
              from latest_positions
             order by account_name, ticker
            """
            ),
            params,
        )
        .mappings()
        .all()
    )

    return [StockPositionRow(**dict(r)) for r in rows]
