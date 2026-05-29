"""Credit-card expense pipeline — REST API endpoints (CC-6).

Five endpoints:
    GET  /api/expenses/unresolved          — paginated unresolved transactions
    POST /api/expenses/resolve             — categorize a transaction (with mapping)
    GET  /api/expenses/monthly-summary     — aggregate by month × category
    GET  /api/expenses/by-category/{slug}  — drill-down into a category
    GET  /api/expenses/statements          — list ingested statements

Auth: every endpoint requires a valid JWT via ``Depends(get_current_user_id)``
(Rabin §4.1 — all CC-6 endpoints must require auth).

Household scoping: explicit ``WHERE household_id = :hh_id`` on every query;
belt-and-suspenders over RLS (Rabin §4.2 — do NOT rely on RLS alone).

Rate-limit note (Rabin §4.3):
    # TODO(CC-13): POST /api/expenses/resolve must be rate-limited to
    # 10 req/sec per authenticated user.  No rate-limit middleware (slowapi or
    # similar) is present in this codebase.  This is a known security gap —
    # add slowapi (or equivalent) in the CC-13 hardening pass.
    # Reference: .squad/decisions/inbox/rabin-cc-security-review.md §4.3.

Error responses: must NOT include merchant_raw or transaction line content
(Rabin §3.2).  Only generic error codes + statement_id are returned.

Decimal serialization: amount_ils exposed as float (number in JSON).  The
global ``ENCODERS_BY_TYPE[Decimal] = float`` (decimal_encoder.py) handles this
for Pydantic model fields; we also convert explicitly in model constructors.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import String, cast, func
from sqlmodel import Session, select

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.expenses import (
    CreditCardStatement,
    CreditCardTransaction,
    ExpenseCategory,
    MerchantCategoryMapping,
)
from app.services.household_service import get_user_household_id

logger = logging.getLogger(__name__)

# TODO(CC-13): rate-limit POST /resolve to 10 req/sec per user (Rabin §4.3).
# No rate-limit middleware present in this codebase (slowapi not installed).
# Known security gap — tracked for CC-13 hardening pass.

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

_MAX_PAGE_SIZE = 200


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _require_household(db: Session, user_id: UUID) -> UUID:
    """Resolve user_id → household_id; raise 403 if not associated."""
    hh_id = get_user_household_id(db, user_id)
    if hh_id is None:
        raise HTTPException(
            status_code=403,
            detail="User not associated with any household",
        )
    return hh_id


def _month_expr(date_col):  # type: ignore[no-untyped-def]
    """SQLAlchemy expression: SUBSTR(CAST(date_col AS VARCHAR), 1, 7) → 'YYYY-MM'.

    Works in both SQLite (stores datetimes as ISO strings) and PostgreSQL
    (casts DATE/TIMESTAMP to text).
    """
    return func.substr(cast(date_col, String), 1, 7)


# ---------------------------------------------------------------------------
# Response / request models
# ---------------------------------------------------------------------------


class UnresolvedTransactionItem(BaseModel):
    """Single row in GET /unresolved response."""

    id: UUID
    txn_date: datetime
    merchant_raw: str
    merchant_normalized: str
    amount_ils: float  # Decimal serialized as number (Rabin §3 / spec)
    original_currency: Optional[str]
    amount_original: Optional[float]
    sector_raw: Optional[str]
    statement_id: UUID
    # TODO(v1.5): add suggested_categories (top-3 low-confidence CategoryResolver matches)


class UnresolvedResponse(BaseModel):
    items: List[UnresolvedTransactionItem]
    total: int
    page: int
    page_size: int


class ResolveRequest(BaseModel):
    transaction_id: UUID
    category_id: UUID
    subcategory_id: Optional[UUID] = None
    apply_to_all_matching: bool = False


class ResolveResponse(BaseModel):
    updated_count: int
    mapping_id: UUID


class MonthlySummaryItem(BaseModel):
    month: str  # 'YYYY-MM'
    category_slug: str
    category_name: str
    category_name_he: str
    amount_ils: float
    txn_count: int


class TransactionDetail(BaseModel):
    """Full transaction detail for drill-down views."""

    id: UUID
    txn_date: datetime
    merchant_raw: str
    merchant_normalized: str
    amount_ils: float
    original_currency: Optional[str]
    amount_original: Optional[float]
    resolution_status: str
    resolution_source: Optional[str]
    statement_id: UUID


class ByCategoryResponse(BaseModel):
    items: List[TransactionDetail]
    total: int
    page: int
    page_size: int
    category_slug: str
    subtotal_ils: float


class StatementItem(BaseModel):
    id: UUID
    issuer: str
    cardholder_name: str
    card_last4: str
    period_from: datetime
    period_to: datetime
    total_amount_ils: Optional[float]
    txn_count: Optional[int]
    parse_warnings_count: int
    ingested_at: datetime


class StatementsResponse(BaseModel):
    items: List[StatementItem]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/unresolved", response_model=UnresolvedResponse)
def get_unresolved_transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=_MAX_PAGE_SIZE),
    search: Optional[str] = Query(None, description="Filter by merchant_normalized (ILIKE)"),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> UnresolvedResponse:
    """Paginated list of unresolved transactions scoped to caller's household.

    Auth required (Rabin §4.1).
    Household scoping via explicit WHERE (Rabin §4.2).
    """
    household_id = _require_household(db, user_id)

    base_filters = [
        CreditCardTransaction.household_id == household_id,
        CreditCardTransaction.resolution_status == "unresolved",
    ]
    if search:
        base_filters.append(CreditCardTransaction.merchant_normalized.ilike(f"%{search}%"))

    total: int = db.execute(select(func.count(CreditCardTransaction.id)).where(*base_filters)).scalar_one()

    rows = db.exec(
        select(CreditCardTransaction)
        .where(*base_filters)
        .order_by(CreditCardTransaction.txn_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [
        UnresolvedTransactionItem(
            id=txn.id,
            txn_date=txn.txn_date,
            merchant_raw=txn.merchant_raw,
            merchant_normalized=txn.merchant_normalized,
            amount_ils=float(txn.amount_ils),
            original_currency=txn.original_currency,
            amount_original=(float(txn.amount_original) if txn.amount_original is not None else None),
            sector_raw=txn.sector_raw,
            statement_id=txn.statement_id,
        )
        for txn in rows
    ]

    return UnresolvedResponse(items=items, total=total, page=page, page_size=page_size)


@router.post("/resolve", response_model=ResolveResponse)
def resolve_transaction(
    body: ResolveRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> ResolveResponse:
    """Categorize a single transaction and optionally back-apply to all matching.

    Behaviour:
    1. Verify transaction belongs to caller's household (Rabin §4.2).
    2. UPSERT ``merchant_category_mappings`` with audit fields:
       ``created_by = str(user_id)`` (Rabin §5.2 mapping-poisoning guard).
    3. Update the target transaction: status → 'user_confirmed', source → 'user'.
    4. If ``apply_to_all_matching``: update other unresolved transactions for the
       same merchant + household; status → 'user_confirmed', source → 'mapping'.
    5. All writes in a single transaction — atomic (Rabin §4.2).

    Auth required (Rabin §4.1).
    Rate-limit: TODO(CC-13) — 10 req/sec per user (Rabin §4.3, known gap).
    Error messages must not include merchant_raw (Rabin §3.2).
    """
    # TODO(CC-13): Apply rate-limit here — 10 req/sec per user_id.

    household_id = _require_household(db, user_id)

    # Validate transaction (household-scoped guard)
    txn = db.exec(
        select(CreditCardTransaction)
        .where(CreditCardTransaction.id == body.transaction_id)
        .where(CreditCardTransaction.household_id == household_id)
    ).first()
    if txn is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # Validate category exists
    category = db.exec(select(ExpenseCategory).where(ExpenseCategory.id == body.category_id)).first()
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    if body.subcategory_id is not None:
        subcat = db.exec(select(ExpenseCategory).where(ExpenseCategory.id == body.subcategory_id)).first()
        if subcat is None:
            raise HTTPException(status_code=404, detail="Subcategory not found")

    merchant_normalized = txn.merchant_normalized

    try:
        # UPSERT merchant_category_mappings (user-scoped, per-household)
        existing_mapping = db.exec(
            select(MerchantCategoryMapping)
            .where(MerchantCategoryMapping.merchant_normalized == merchant_normalized)
            .where(MerchantCategoryMapping.household_id == household_id)
            .where(MerchantCategoryMapping.source == "user")
        ).first()

        if existing_mapping is not None:
            existing_mapping.category_id = body.category_id
            existing_mapping.subcategory_id = body.subcategory_id
            # Rabin §5.2: audit field must reflect actual caller on every update
            existing_mapping.created_by = str(user_id)
            db.add(existing_mapping)
            mapping_id: UUID = existing_mapping.id
        else:
            new_mapping = MerchantCategoryMapping(
                id=uuid4(),
                merchant_normalized=merchant_normalized,
                household_id=household_id,
                category_id=body.category_id,
                subcategory_id=body.subcategory_id,
                source="user",
                # Rabin §5.2: created_by MUST equal the caller — prevents mapping poisoning
                created_by=str(user_id),
                created_at=datetime.utcnow(),
                confidence=Decimal("1.00"),
                match_count=0,
            )
            db.add(new_mapping)
            mapping_id = new_mapping.id

        # Update the target transaction
        txn.category_id = body.category_id
        txn.subcategory_id = body.subcategory_id
        txn.resolution_status = "user_confirmed"
        txn.resolution_source = "user"
        db.add(txn)

        updated_count = 1  # the target transaction itself

        # Back-apply to all OTHER unresolved transactions for the same merchant
        if body.apply_to_all_matching:
            matching = db.exec(
                select(CreditCardTransaction)
                .where(CreditCardTransaction.merchant_normalized == merchant_normalized)
                .where(CreditCardTransaction.household_id == household_id)
                .where(CreditCardTransaction.resolution_status == "unresolved")
                .where(CreditCardTransaction.id != body.transaction_id)
            ).all()

            for other_txn in matching:
                other_txn.category_id = body.category_id
                other_txn.subcategory_id = body.subcategory_id
                other_txn.resolution_status = "user_confirmed"
                # 'mapping' — learned from user mapping, not directly confirmed
                other_txn.resolution_source = "mapping"
                db.add(other_txn)
                updated_count += 1

        # Single commit — atomicity (all-or-nothing)
        db.commit()

    except Exception:
        db.rollback()
        raise

    return ResolveResponse(updated_count=updated_count, mapping_id=mapping_id)


@router.get("/monthly-summary", response_model=List[MonthlySummaryItem])
def get_monthly_summary(
    from_: Optional[str] = Query(None, alias="from", description="Start month YYYY-MM (inclusive)"),
    to: Optional[str] = Query(None, description="End month YYYY-MM (inclusive)"),
    exclude_transfers: bool = Query(True, description="Exclude transfer-category transactions (default true)"),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> List[MonthlySummaryItem]:
    """Aggregate credit-card spend by month × category.

    Default: excludes transfer categories (``is_transfer = true``).
    Override with ``?exclude_transfers=false``.

    Auth required (Rabin §4.1).
    Household scoping via explicit WHERE (Rabin §4.2).
    """
    household_id = _require_household(db, user_id)

    month_col = _month_expr(CreditCardTransaction.txn_date)

    stmt = (
        select(
            month_col.label("month"),
            ExpenseCategory.slug.label("category_slug"),
            ExpenseCategory.name.label("category_name"),
            ExpenseCategory.name_he.label("category_name_he"),
            func.sum(CreditCardTransaction.amount_ils).label("amount_ils"),
            func.count(CreditCardTransaction.id).label("txn_count"),
        )
        .join(
            ExpenseCategory,
            CreditCardTransaction.category_id == ExpenseCategory.id,
        )
        .where(CreditCardTransaction.household_id == household_id)
    )

    if exclude_transfers:
        stmt = stmt.where(ExpenseCategory.is_transfer == False)  # noqa: E712

    if from_:
        stmt = stmt.where(month_col >= from_)
    if to:
        stmt = stmt.where(month_col <= to)

    stmt = stmt.group_by(
        month_col,
        ExpenseCategory.id,
        ExpenseCategory.slug,
        ExpenseCategory.name,
        ExpenseCategory.name_he,
    ).order_by(month_col.desc(), func.sum(CreditCardTransaction.amount_ils).desc())

    rows = db.execute(stmt).mappings().all()

    return [
        MonthlySummaryItem(
            month=row["month"],
            category_slug=row["category_slug"],
            category_name=row["category_name"],
            category_name_he=row["category_name_he"],
            amount_ils=float(row["amount_ils"]),
            txn_count=int(row["txn_count"]),
        )
        for row in rows
    ]


@router.get("/by-category/{category_slug}", response_model=ByCategoryResponse)
def get_by_category(
    category_slug: str,
    from_: Optional[str] = Query(None, alias="from", description="Start date YYYY-MM-DD (inclusive)"),
    to: Optional[str] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
    subcategory_slug: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=_MAX_PAGE_SIZE),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> ByCategoryResponse:
    """Drill-down: return paginated transactions for a given category slug.

    Auth required (Rabin §4.1).
    Household scoping via explicit WHERE (Rabin §4.2).
    """
    household_id = _require_household(db, user_id)

    category = db.exec(select(ExpenseCategory).where(ExpenseCategory.slug == category_slug)).first()
    if category is None:
        raise HTTPException(
            status_code=404,
            detail=f"Category '{category_slug}' not found",
        )

    # Reusable date-string expression (first 10 chars = YYYY-MM-DD)
    date_str_col = func.substr(cast(CreditCardTransaction.txn_date, String), 1, 10)

    base_filters = [
        CreditCardTransaction.household_id == household_id,
        CreditCardTransaction.category_id == category.id,
    ]
    if from_:
        base_filters.append(date_str_col >= from_)
    if to:
        base_filters.append(date_str_col <= to)

    if subcategory_slug:
        subcat = db.exec(select(ExpenseCategory).where(ExpenseCategory.slug == subcategory_slug)).first()
        if subcat is not None:
            base_filters.append(CreditCardTransaction.subcategory_id == subcat.id)

    total: int = db.execute(select(func.count(CreditCardTransaction.id)).where(*base_filters)).scalar_one()

    subtotal_raw = db.execute(
        select(func.sum(CreditCardTransaction.amount_ils)).where(*base_filters)
    ).scalar_one_or_none()
    subtotal = float(subtotal_raw) if subtotal_raw is not None else 0.0

    rows = db.exec(
        select(CreditCardTransaction)
        .where(*base_filters)
        .order_by(CreditCardTransaction.txn_date.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [
        TransactionDetail(
            id=txn.id,
            txn_date=txn.txn_date,
            merchant_raw=txn.merchant_raw,
            merchant_normalized=txn.merchant_normalized,
            amount_ils=float(txn.amount_ils),
            original_currency=txn.original_currency,
            amount_original=(float(txn.amount_original) if txn.amount_original is not None else None),
            resolution_status=txn.resolution_status,
            resolution_source=txn.resolution_source,
            statement_id=txn.statement_id,
        )
        for txn in rows
    ]

    return ByCategoryResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        category_slug=category_slug,
        subtotal_ils=subtotal,
    )


@router.get("/statements", response_model=StatementsResponse)
def get_statements(
    cardholder: Optional[str] = Query(None, description="Filter by cardholder_name (ILIKE)"),
    issuer: Optional[str] = Query(None, description="Filter by issuer (exact match)"),
    from_: Optional[str] = Query(None, alias="from", description="Start month YYYY-MM (period_from)"),
    to: Optional[str] = Query(None, description="End month YYYY-MM (period_from)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=_MAX_PAGE_SIZE),
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session),
) -> StatementsResponse:
    """Paginated list of ingested credit-card statements for the household.

    Auth required (Rabin §4.1).
    Household scoping via explicit WHERE (Rabin §4.2).

    Drill-down per statement: GET /api/expenses/statements/{id}/transactions
    (bonus endpoint — not implemented in CC-6 scope).
    """
    household_id = _require_household(db, user_id)

    period_month_col = _month_expr(CreditCardStatement.period_from)

    base_filters = [CreditCardStatement.household_id == household_id]

    if cardholder:
        base_filters.append(CreditCardStatement.cardholder_name.ilike(f"%{cardholder}%"))
    if issuer:
        base_filters.append(CreditCardStatement.issuer == issuer)
    if from_:
        base_filters.append(period_month_col >= from_)
    if to:
        base_filters.append(period_month_col <= to)

    total: int = db.execute(select(func.count(CreditCardStatement.id)).where(*base_filters)).scalar_one()

    rows = db.exec(
        select(CreditCardStatement)
        .where(*base_filters)
        .order_by(CreditCardStatement.period_from.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [
        StatementItem(
            id=stmt.id,
            issuer=stmt.issuer,
            cardholder_name=stmt.cardholder_name,
            card_last4=stmt.card_last4,
            period_from=stmt.period_from,
            period_to=stmt.period_to,
            total_amount_ils=(float(stmt.total_amount_ils) if stmt.total_amount_ils is not None else None),
            txn_count=stmt.txn_count,
            parse_warnings_count=(len(stmt.parse_warnings) if stmt.parse_warnings else 0),
            ingested_at=stmt.ingested_at,
        )
        for stmt in rows
    ]

    return StatementsResponse(items=items, total=total, page=page, page_size=page_size)
