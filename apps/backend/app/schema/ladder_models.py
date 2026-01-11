from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import List, Literal, Optional


@dataclass
class LadderRung:
    id: str
    year: int
    start_date: date
    end_date: date
    target_amount: float
    current_amount: float


@dataclass
class LadderBond:
    id: str
    ticker: Optional[str] | None
    issuer: str
    currency: str
    face_value: float
    coupon_rate: float
    coupon_frequency: str
    maturity_date: date
    rung_id: str


@dataclass
class BondCashflow:
    id: str
    bond_id: str
    date: date
    amount: float
    currency: str
    type: Literal["COUPON", "PRINCIPAL"]
    rung_id: str


@dataclass
class IncomePoint:
    date: date
    value: float


@dataclass
class DistributionRow:
    id: str
    date: date
    amount: float
    currency: str
    type: Literal["COUPON", "PRINCIPAL"]
    bond_id: str
    ticker: Optional[str] | None
    issuer: str
    maturity_date: date
    rung_id: str


def rung_base_for_year(year: int) -> int:
    """Map a calendar year to its 1-year rung base.

    We now treat each calendar year as its own rung, anchored from 2034
    upwards so that frontend zoom levels (1, 3, 5 years) can aggregate
    precisely over these atomic 1-year rungs.
    """

    # For 1-year rungs the base is just the year itself; the 2034 anchor
    # is applied when generating the ladder range in the API layer.
    return year


def rung_id_for_year(year: int) -> str:
    return str(rung_base_for_year(year))


def rung_date_range(base_year: int) -> tuple[date, date]:
    start = date(base_year, 1, 1)
    end = date(base_year, 12, 31)
    return start, end
