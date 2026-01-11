from datetime import date
from typing import List

from .bonds_types import BondHolding
from .bonds_xlsx import load_bonds_from_xlsx, save_bonds_to_xlsx


def _initial_bonds() -> List[BondHolding]:
    """Seed list of mock USD bond holdings.

    This is a temporary data source until we integrate with IB portfolio.
    """

    return [
        BondHolding(
            id="91282CEZ7",  # mock CUSIP
            issuer="US Treasury 4.00% 06/30/2037",
            currency="USD",
            face_value=100_000,
            coupon_rate=0.04,
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2024, 6, 30),
            maturity_date=date(2037, 6, 30),
        ),
        BondHolding(
            id="12345CORA",  # mock CUSIP for Corp A 2038
            issuer="Corp A 5.00% 01/01/2038",
            currency="USD",
            face_value=50_000,
            coupon_rate=0.05,
            coupon_frequency="ANNUAL",
            issue_date=date(2023, 1, 1),
            maturity_date=date(2038, 1, 1),
        ),
        BondHolding(
            id="12345CORB",  # mock CUSIP for Corp B 2040
            issuer="Corp B 3.50% 03/15/2040",
            currency="USD",
            face_value=80_000,
            coupon_rate=0.035,
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2025, 3, 15),
            maturity_date=date(2040, 3, 15),
        ),
        BondHolding(
            id="12345MUNI",  # mock CUSIP for muni 2042
            issuer="Muni 3.00% 09/01/2042",
            currency="USD",
            face_value=60_000,
            coupon_rate=0.03,
            coupon_frequency="ANNUAL",
            issue_date=date(2022, 9, 1),
            maturity_date=date(2042, 9, 1),
        ),
        BondHolding(
            id="12345GLOB",  # mock CUSIP for global 2047
            issuer="Global 4.50% 11/30/2047",
            currency="USD",
            face_value=120_000,
            coupon_rate=0.045,
            coupon_frequency="SEMI_ANNUAL",
            issue_date=date(2020, 11, 30),
            maturity_date=date(2047, 11, 30),
        ),
        BondHolding(
            id="12345LONG",  # mock CUSIP for long 2055
            issuer="Long 4.00% 05/01/2055",
            currency="USD",
            face_value=150_000,
            coupon_rate=0.04,
            coupon_frequency="ANNUAL",
            issue_date=date(2021, 5, 1),
            maturity_date=date(2055, 5, 1),
        ),
    ]


_BONDS: List[BondHolding] | None = None


def get_current_bonds() -> List[BondHolding]:
    """Return the current in-memory list of bond holdings."""

    global _BONDS
    if _BONDS is None:
        # Lazy-load from Excel, seeding file from initial mocks if
        # it does not exist yet.
        seeded = _initial_bonds()
        _BONDS = load_bonds_from_xlsx(seeded)
        # If the sheet was empty, keep the seeded bonds in memory too.
        if not _BONDS:
            _BONDS = seeded
            save_bonds_to_xlsx(_BONDS)

    return list(_BONDS)


def add_bond(bond: BondHolding) -> BondHolding:
    """Append a new bond to the in-memory store and return it."""

    bonds = get_current_bonds()
    bonds.append(bond)

    # Update global reference and persist to Excel
    global _BONDS
    _BONDS = bonds
    save_bonds_to_xlsx(_BONDS)

    return bond


def update_bond_face_value(bond_id: str, face_value: float) -> BondHolding | None:
    """Update the face_value of an existing bond in the in-memory store.

    Returns the updated bond or None if not found.
    """
    bonds = get_current_bonds()
    updated: BondHolding | None = None
    for b in bonds:
        if b.id == bond_id:
            b.face_value = face_value
            updated = b
            break

    if updated is None:
        return None

    global _BONDS
    _BONDS = bonds
    save_bonds_to_xlsx(_BONDS)
    return updated


def get_mock_bonds() -> List[BondHolding]:
    """Backward-compatible alias for existing callers.

    Prefer get_current_bonds for new code.
    """

    return get_current_bonds()
