from __future__ import annotations

from datetime import date
from typing import Iterable, List

from app.data.bonds_mock import BondHolding, get_current_bonds
from app.schema.ladder_models import BondCashflow, rung_id_for_year


def _frequency_per_year(freq: str) -> int:
    f = freq.upper()
    if f == "ANNUAL":
        return 1
    if f == "SEMI_ANNUAL":
        return 2
    if f == "QUARTERLY":
        return 4
    raise ValueError(f"Unsupported coupon_frequency: {freq}")


def _add_months(d: date, months: int) -> date:
    # Simple month adder sufficient for mock data; not day-count-accurate.
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    day = min(d.day, 28)  # avoid month-end issues
    return date(year, month, day)


def generate_cashflows_for_bond(bond: BondHolding) -> List[BondCashflow]:
    """Generate coupon and principal cashflows for a single plain-vanilla bond."""

    cashflows: List[BondCashflow] = []
    per_year = _frequency_per_year(bond.coupon_frequency)
    months_step = 12 // per_year

    coupon_amount = bond.face_value * bond.coupon_rate / per_year

    payment_date = _add_months(bond.issue_date, months_step)
    while payment_date < bond.maturity_date:
        cashflows.append(
            BondCashflow(
                id=f"{bond.id}-coupon-{payment_date.isoformat()}",
                bond_id=bond.id,
                date=payment_date,
                amount=coupon_amount,
                currency=bond.currency,
                type="COUPON",
                rung_id=rung_id_for_year(bond.maturity_date.year),
            )
        )
        payment_date = _add_months(payment_date, months_step)

    # Principal at maturity
    cashflows.append(
        BondCashflow(
            id=f"{bond.id}-principal-{bond.maturity_date.isoformat()}",
            bond_id=bond.id,
            date=bond.maturity_date,
            amount=bond.face_value,
            currency=bond.currency,
            type="PRINCIPAL",
            rung_id=rung_id_for_year(bond.maturity_date.year),
        )
    )

    return cashflows


def generate_all_cashflows(bonds: Iterable[BondHolding] | None = None) -> List[BondCashflow]:
    if bonds is None:
        bonds = get_current_bonds()
    result: List[BondCashflow] = []
    for bond in bonds:
        if bond.currency != "USD":
            continue
        result.extend(generate_cashflows_for_bond(bond))
    return result
