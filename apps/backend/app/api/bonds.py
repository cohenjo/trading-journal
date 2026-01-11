from fastapi import APIRouter
from typing import List, Optional
from datetime import date
from sqlmodel import SQLModel

router = APIRouter()

class BondCandidate(SQLModel):
    """Simple DTO for bond scanner/search results (mocked for now)."""

    id: str  # CUSIP for USD bonds in this mock
    issuer: str
    coupon_rate: float
    maturity_date: date
    yield_to_maturity: float
    rating: str
    currency: str
    price: float

@router.get("/bonds/scanner", response_model=List[BondCandidate])
def scan_bonds(
    min_maturity: Optional[date] = None,
    max_maturity: Optional[date] = None,
    min_yield: Optional[float] = None,
    min_rating: Optional[str] = None,
    currency: Optional[str] = None,
):
    """Mock bond scanner endpoint backed by a curated in-memory list.

    This is intentionally simple and does not hit any real market data
    source yet; it exists so the frontend can build a realistic search
    and selection flow.
    """

    # Very small curated mock universe for now.
    universe: list[BondCandidate] = [
        BondCandidate(
            id="91282CEZ7",  # matches US Treasury holding CUSIP
            issuer="US Treasury 4.00% 06/30/2037",
            coupon_rate=0.04,
            maturity_date=date(2037, 6, 30),
            yield_to_maturity=0.041,
            rating="AAA",
            currency="USD",
            price=99.2,
        ),
        BondCandidate(
            id="12345CORB",  # matches Corp B holding CUSIP
            issuer="Corp B 3.50% 03/15/2040",
            coupon_rate=0.035,
            maturity_date=date(2040, 3, 15),
            yield_to_maturity=0.036,
            rating="AAA",
            currency="USD",
            price=101.3,
        ),
        BondCandidate(
            id="12345CORA",  # matches Corp A holding CUSIP
            issuer="Corp A 5.00% 01/01/2038",
            coupon_rate=0.05,
            maturity_date=date(2038, 1, 1),
            yield_to_maturity=0.052,
            rating="A",
            currency="USD",
            price=100.5,
        ),
        BondCandidate(
            id="EUROISIN1",  # placeholder ISIN-style id for EUR bond
            issuer="EU Gov 3.00% 09/30/2037",
            coupon_rate=0.03,
            maturity_date=date(2037, 9, 30),
            yield_to_maturity=0.031,
            rating="AA",
            currency="EUR",
            price=100.0,
        ),
    ]

    def rating_at_least(candidate_rating: str, threshold: str) -> bool:
        # Extremely crude ordering for demo purposes.
        order = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]
        try:
            return order.index(candidate_rating) <= order.index(threshold)
        except ValueError:
            # Unknown ratings are treated as worst.
            return False

    results: list[BondCandidate] = []
    for c in universe:
        if min_maturity and c.maturity_date < min_maturity:
            continue
        if max_maturity and c.maturity_date > max_maturity:
            continue
        if min_yield is not None and c.yield_to_maturity < min_yield:
            continue
        if currency and c.currency != currency:
            continue
        if min_rating and not rating_at_least(c.rating, min_rating):
            continue
        results.append(c)

    return results
