"""Manual stock-position CRUD API — issue #340 Phase 2 (H2) + H3 extension.

Flat endpoints (legacy):
    POST   /api/accounts/positions          — create manual position
    PUT    /api/accounts/positions/{id}     — update manual position
    DELETE /api/accounts/positions/{id}     — delete manual position
    GET    /api/accounts/positions          — list positions (optionally by account)

Account-scoped endpoints (H3 — Jony's accounts-page UX):
    POST   /api/accounts/{account_id}/positions            — create manual position
    PATCH  /api/accounts/{account_id}/positions/{id}       — partial update manual position
    DELETE /api/accounts/{account_id}/positions/{id}       — delete manual position
    POST   /api/accounts/{account_id}/positions/import     — CSV bulk replace source='manual'

Flex-sourced positions (source='flex') are written exclusively by the
options_sync worker; manual writes to IBKR accounts are rejected here.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
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
    cost_basis_total: Optional[Decimal] = None
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
# H3 — Account-scoped manual CRUD models
# ---------------------------------------------------------------------------


class ManualPositionCreate(BaseModel):
    """Request payload for creating one manual stock position (account-scoped).

    ``average_cost`` is the per-share cost basis (maps to the ``cost_basis``
    column). ``cost_basis_total`` and ``market_value`` are optional enrichment
    fields accepted from the UI or CSV import.
    """

    ticker: str = Field(..., min_length=1, max_length=20)
    quantity: Decimal = Field(..., gt=0)
    average_cost: Optional[Decimal] = Field(None, description="Per-share cost basis (cost_basis column)")
    currency: str = Field("USD", min_length=3, max_length=10)
    cost_basis_total: Optional[Decimal] = None
    market_value: Optional[Decimal] = None
    as_of_date: date = Field(default_factory=date.today)

    @field_validator("ticker")
    @classmethod
    def ticker_upper(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("ticker must not be blank")
        return v

    @field_validator("currency")
    @classmethod
    def currency_upper(cls, v: str) -> str:
        return v.strip().upper() or "USD"


class ManualPositionUpdate(BaseModel):
    """Partial-update payload for a manual stock position (all fields optional)."""

    quantity: Optional[Decimal] = Field(None, gt=0)
    average_cost: Optional[Decimal] = None
    cost_basis_total: Optional[Decimal] = None
    market_value: Optional[Decimal] = None
    as_of_date: Optional[date] = None
    currency: Optional[str] = Field(None, min_length=3, max_length=10)


class ManualPositionResponse(StockPositionRow):
    """Full row response for manual-position endpoints.

    Inherits all ``StockPositionRow`` fields and confirms ``source='manual'``.
    ``cost_basis_total`` is always present (possibly ``None``).
    """


class CSVImportResult(BaseModel):
    """Result of a bulk CSV import for one account's manual positions."""

    rows_inserted: int
    rows_skipped: int
    errors: list[str]


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


# ---------------------------------------------------------------------------
# H3 — Account-scoped manual CRUD endpoints
# ---------------------------------------------------------------------------
# Path: /api/accounts/{account_id}/positions[/...]
# All endpoints enforce:
#   1. Household ownership (RLS + service-layer guard)
#   2. Non-IBKR account type (flex is immutable from the UI)
#   3. source='manual' for PATCH/DELETE (never mutate flex rows)
# ---------------------------------------------------------------------------

_MANUAL_RETURNING = """
    id, household_id, account_id, ticker, quantity, cost_basis, cost_basis_total,
    currency, as_of_date, source, con_id, description, sub_category,
    mark_price, market_value, unrealized_pnl, last_broker_sync_at,
    created_at, updated_at
"""


def _manual_position_response(row: Any, account: dict[str, Any]) -> ManualPositionResponse:
    return ManualPositionResponse(
        **dict(row),
        account_name=account["name"],
        account_type=account["account_type"],
    )


# NOTE: /positions/import must be registered before /positions/{position_id}
# so that FastAPI does not interpret the literal "import" as a UUID path param.
# Both are POST, so HTTP method alone does not disambiguate path specificity.


@router.post(
    "/accounts/{account_id}/positions/import",
    response_model=CSVImportResult,
    status_code=200,
    summary="Bulk CSV import — replaces all source='manual' rows for the account",
)
def import_manual_positions(
    account_id: int,
    file: UploadFile = File(..., description="CSV file with manual positions"),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> CSVImportResult:
    """Bulk-replace all source='manual' positions for this account from a CSV upload.

    Idempotent: DELETE all existing source='manual' rows for the account, then
    INSERT every valid row from the CSV in a single transaction.  A re-upload with
    fewer rows therefore removes previously imported rows — "full account refresh".

    CSV columns (header required):
        ticker, quantity, average_cost, currency, cost_basis_total, market_value, as_of_date
        (account_id column is accepted but ignored — use the URL path parameter)

    Returns a CSVImportResult with counts and per-row errors.
    """
    household_id = _resolve_household(db, user_id)
    account = _get_account(db, account_id, household_id)
    _reject_ibkr_manual_write(account)

    # Read + decode uploaded file
    raw_bytes = file.file.read()
    try:
        text_content = raw_bytes.decode("utf-8-sig")  # handle BOM from Excel exports
    except UnicodeDecodeError:
        text_content = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_content))

    errors: list[str] = []
    valid_rows: list[dict[str, Any]] = []

    for lineno, raw_row in enumerate(reader, start=2):
        row = {k.strip(): (v.strip() if v else "") for k, v in raw_row.items()}
        ticker = row.get("ticker", "").upper()
        if not ticker:
            errors.append(f"row {lineno}: blank ticker — skipped")
            continue

        qty_raw = row.get("quantity", "")
        try:
            quantity = Decimal(qty_raw)
            if quantity <= 0:
                raise ValueError("must be > 0")
        except (InvalidOperation, ValueError):
            errors.append(f"row {lineno} ({ticker}): invalid quantity {qty_raw!r} — skipped")
            continue

        def _dec_or_none(val: str, field: str, ln: int, tk: str) -> Decimal | None:
            if not val:
                return None
            try:
                return Decimal(val)
            except InvalidOperation:
                errors.append(f"row {ln} ({tk}): invalid {field} {val!r} — using NULL")
                return None

        average_cost = _dec_or_none(row.get("average_cost", ""), "average_cost", lineno, ticker)
        cost_basis_total = _dec_or_none(row.get("cost_basis_total", ""), "cost_basis_total", lineno, ticker)
        market_value = _dec_or_none(row.get("market_value", ""), "market_value", lineno, ticker)
        currency = (row.get("currency") or "USD").upper() or "USD"

        aod_raw = row.get("as_of_date", "")
        try:
            as_of = date.fromisoformat(aod_raw) if aod_raw else date.today()
        except ValueError:
            errors.append(f"row {lineno} ({ticker}): invalid as_of_date {aod_raw!r} — using today")
            as_of = date.today()

        valid_rows.append(
            {
                "household_id": household_id,
                "account_id": account_id,
                "ticker": ticker,
                "quantity": str(quantity),
                "cost_basis": str(average_cost) if average_cost is not None else None,
                "cost_basis_total": str(cost_basis_total) if cost_basis_total is not None else None,
                "market_value": str(market_value) if market_value is not None else None,
                "currency": currency,
                "as_of_date": str(as_of),
                "created_by": str(user_id),
            }
        )

    # DELETE-then-INSERT in one transaction (idempotent full-account refresh)
    db.execute(
        text(
            """
            delete from public.stock_positions
             where account_id = :account_id
               and household_id = :household_id
               and source = 'manual'
            """
        ),
        {"account_id": account_id, "household_id": household_id},
    )

    for params in valid_rows:
        db.execute(
            text(
                """
                insert into public.stock_positions
                  (household_id, account_id, ticker, quantity, cost_basis,
                   cost_basis_total, market_value, currency, as_of_date,
                   source, created_by)
                values
                  (:household_id, :account_id, :ticker, :quantity, :cost_basis,
                   :cost_basis_total, :market_value, :currency, :as_of_date,
                   'manual', :created_by)
                """
            ),
            params,
        )

    db.commit()

    return CSVImportResult(
        rows_inserted=len(valid_rows),
        rows_skipped=len(errors),
        errors=errors,
    )


@router.post(
    "/accounts/{account_id}/positions",
    response_model=ManualPositionResponse,
    status_code=201,
    summary="Create one manual stock position",
)
def create_manual_position(
    account_id: int,
    body: ManualPositionCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> ManualPositionResponse:
    """Create a single manual position for a non-IBKR account.

    ``average_cost`` maps to the ``cost_basis`` column (per-share average).
    ``as_of_date`` defaults to today if omitted.
    """
    household_id = _resolve_household(db, user_id)
    account = _get_account(db, account_id, household_id)
    _reject_ibkr_manual_write(account)

    row = (
        db.execute(
            text(
                f"""
            insert into public.stock_positions
              (household_id, account_id, ticker, quantity, cost_basis,
               cost_basis_total, market_value, currency, as_of_date,
               source, created_by)
            values
              (:household_id, :account_id, :ticker, :quantity, :cost_basis,
               :cost_basis_total, :market_value, :currency, :as_of_date,
               'manual', :created_by)
            returning {_MANUAL_RETURNING}
            """
            ),
            {
                "household_id": household_id,
                "account_id": account_id,
                "ticker": body.ticker,
                "quantity": body.quantity,
                "cost_basis": body.average_cost,
                "cost_basis_total": body.cost_basis_total,
                "market_value": body.market_value,
                "currency": body.currency,
                "as_of_date": body.as_of_date,
                "created_by": str(user_id),
            },
        )
        .mappings()
        .one()
    )
    db.commit()
    return _manual_position_response(row, account)


@router.patch(
    "/accounts/{account_id}/positions/{position_id}",
    response_model=ManualPositionResponse,
    summary="Partial-update a manual stock position",
)
def patch_manual_position(
    account_id: int,
    position_id: UUID,
    body: ManualPositionUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> ManualPositionResponse:
    """Partially update a manual position.

    Only ``source='manual'`` rows may be updated; flex rows are immutable.
    ``average_cost`` maps to the ``cost_basis`` (per-share) column.
    """
    household_id = _resolve_household(db, user_id)
    account = _get_account(db, account_id, household_id)
    _reject_ibkr_manual_write(account)

    existing = (
        db.execute(
            text(
                """
            select id, source
              from public.stock_positions
             where id = :id
               and account_id = :account_id
               and household_id = :household_id
            """
            ),
            {"id": str(position_id), "account_id": account_id, "household_id": household_id},
        )
        .mappings()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Position not found")
    if existing["source"] != "manual":
        raise HTTPException(status_code=422, detail="Only manual positions can be updated via this endpoint")

    updates: list[str] = []
    params: dict[str, Any] = {"id": str(position_id), "household_id": household_id}
    if body.quantity is not None:
        updates.append("quantity = :quantity")
        params["quantity"] = body.quantity
    if body.average_cost is not None:
        updates.append("cost_basis = :cost_basis")
        params["cost_basis"] = body.average_cost
    if body.cost_basis_total is not None:
        updates.append("cost_basis_total = :cost_basis_total")
        params["cost_basis_total"] = body.cost_basis_total
    if body.market_value is not None:
        updates.append("market_value = :market_value")
        params["market_value"] = body.market_value
    if body.as_of_date is not None:
        updates.append("as_of_date = :as_of_date")
        params["as_of_date"] = body.as_of_date
    if body.currency is not None:
        updates.append("currency = :currency")
        params["currency"] = body.currency.strip().upper()

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
            returning {_MANUAL_RETURNING}
            """  # noqa: S608 — set clause built from allowlist, no user input
            ),
            params,
        )
        .mappings()
        .one()
    )
    db.commit()
    return _manual_position_response(row, account)


@router.delete(
    "/accounts/{account_id}/positions/{position_id}",
    status_code=200,
    summary="Delete one manual stock position",
)
def delete_manual_position(
    account_id: int,
    position_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> dict:
    """Hard-delete a single manual position.

    Flex rows and rows from other households are silently rejected with 404.
    """
    household_id = _resolve_household(db, user_id)
    _get_account(db, account_id, household_id)  # ensures account is in household

    result = db.execute(
        text(
            """
            delete from public.stock_positions
             where id = :id
               and account_id = :account_id
               and household_id = :household_id
               and source = 'manual'
            """
        ),
        {"id": str(position_id), "account_id": account_id, "household_id": household_id},
    )
    db.commit()

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="Position not found, not manual, or not in your household",
        )
    return {"deleted": True}
