from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter
from sqlmodel import SQLModel

from app.services.bond_scanner import fetch_bond_universe, filter_bond_candidates

router = APIRouter()


class BondCandidate(SQLModel):
    """Deprecated DTO for legacy bond scanner/search results."""

    id: str
    issuer: str
    coupon_rate: float
    maturity_date: date
    yield_to_maturity: float
    rating: str
    currency: str
    price: float


@router.get("/bonds/scanner", response_model=List[BondCandidate], deprecated=True)
def scan_bonds(
    min_maturity: Optional[date] = None,
    max_maturity: Optional[date] = None,
    min_yield: Optional[float] = None,
    min_rating: Optional[str] = None,
    currency: Optional[str] = None,
):
    """Deprecated FastAPI scanner retained for local/admin compatibility.

    TJ-020 moved the production frontend path to the scheduled
    ``bonds_scanner_refresh`` worker and ``public.bond_scanner_results``.
    """

    candidates = filter_bond_candidates(
        fetch_bond_universe(),
        min_maturity=min_maturity,
        max_maturity=max_maturity,
        min_yield=Decimal(str(min_yield)) if min_yield is not None else None,
        min_rating=min_rating,
        currency=currency,
    )
    return [
        BondCandidate(
            id=candidate.symbol,
            issuer=candidate.issuer,
            coupon_rate=float(candidate.coupon_rate),
            maturity_date=candidate.maturity_date,
            yield_to_maturity=float(candidate.yield_to_maturity),
            rating=candidate.rating,
            currency=candidate.currency,
            price=float(candidate.price),
        )
        for candidate in candidates
    ]
