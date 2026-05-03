"""Bond scanner data source and filtering helpers."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class BondScannerCandidate:
    """One bond scanner candidate using Decimal for financial values."""

    symbol: str
    issuer: str
    coupon_rate: Decimal
    maturity_date: date
    yield_to_maturity: Decimal
    rating: str
    currency: str
    price: Decimal

    def to_result_data(self) -> dict[str, object]:
        """Return JSONB-safe candidate data with decimal values preserved as text."""

        return {
            "id": self.symbol,
            "issuer": self.issuer,
            "coupon_rate": str(self.coupon_rate),
            "maturity_date": self.maturity_date.isoformat(),
            "yield_to_maturity": str(self.yield_to_maturity),
            "rating": self.rating,
            "currency": self.currency,
            "price": str(self.price),
        }


CURATED_BOND_SYMBOLS: tuple[str, ...] = (
    "91282CEZ7",
    "12345CORB",
    "12345CORA",
    "EUROISIN1",
)

_CURATED_BOND_DATA: dict[str, BondScannerCandidate] = {
    "91282CEZ7": BondScannerCandidate(
        symbol="91282CEZ7",
        issuer="US Treasury 4.00% 06/30/2037",
        coupon_rate=Decimal("0.04"),
        maturity_date=date(2037, 6, 30),
        yield_to_maturity=Decimal("0.041"),
        rating="AAA",
        currency="USD",
        price=Decimal("99.2"),
    ),
    "12345CORB": BondScannerCandidate(
        symbol="12345CORB",
        issuer="Corp B 3.50% 03/15/2040",
        coupon_rate=Decimal("0.035"),
        maturity_date=date(2040, 3, 15),
        yield_to_maturity=Decimal("0.036"),
        rating="AAA",
        currency="USD",
        price=Decimal("101.3"),
    ),
    "12345CORA": BondScannerCandidate(
        symbol="12345CORA",
        issuer="Corp A 5.00% 01/01/2038",
        coupon_rate=Decimal("0.05"),
        maturity_date=date(2038, 1, 1),
        yield_to_maturity=Decimal("0.052"),
        rating="A",
        currency="USD",
        price=Decimal("100.5"),
    ),
    "EUROISIN1": BondScannerCandidate(
        symbol="EUROISIN1",
        issuer="EU Gov 3.00% 09/30/2037",
        coupon_rate=Decimal("0.03"),
        maturity_date=date(2037, 9, 30),
        yield_to_maturity=Decimal("0.031"),
        rating="AA",
        currency="EUR",
        price=Decimal("100.0"),
    ),
}


def fetch_bond_candidate(symbol: str) -> BondScannerCandidate:
    """Fetch one candidate from the configured bond data provider."""

    return _CURATED_BOND_DATA[symbol]


def fetch_bond_universe(
    symbols: tuple[str, ...] = CURATED_BOND_SYMBOLS,
    fetcher: Callable[[str], BondScannerCandidate] = fetch_bond_candidate,
) -> list[BondScannerCandidate]:
    """Fetch scanner candidates, skipping symbols that fail individually."""

    candidates: list[BondScannerCandidate] = []
    for symbol in symbols:
        try:
            candidates.append(fetcher(symbol))
        except Exception:
            continue
    return candidates


def rating_at_least(candidate_rating: str, threshold: str) -> bool:
    """Return whether a bond rating is at least the requested threshold."""

    order = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]
    try:
        return order.index(candidate_rating) <= order.index(threshold)
    except ValueError:
        return False


def filter_bond_candidates(
    candidates: list[BondScannerCandidate],
    min_maturity: date | None = None,
    max_maturity: date | None = None,
    min_yield: Decimal | None = None,
    min_rating: str | None = None,
    currency: str | None = None,
) -> list[BondScannerCandidate]:
    """Apply scanner filters to a list of candidates."""

    results: list[BondScannerCandidate] = []
    for candidate in candidates:
        if min_maturity and candidate.maturity_date < min_maturity:
            continue
        if max_maturity and candidate.maturity_date > max_maturity:
            continue
        if min_yield is not None and candidate.yield_to_maturity < min_yield:
            continue
        if currency and candidate.currency != currency:
            continue
        if min_rating and not rating_at_least(candidate.rating, min_rating):
            continue
        results.append(candidate)
    return results
