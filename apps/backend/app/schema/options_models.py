from __future__ import annotations

from decimal import Decimal
from pydantic import BaseModel


class OptionsRecord(BaseModel):
    year: int
    amount: Decimal


class OptionsProjectionParams(BaseModel):
    growth_rate: Decimal
    cutoff_year: int
    final_year: int


class OptionsProjectionPoint(BaseModel):
    year: int
    amount: Decimal
    type: str  # "historical" or "projected"


class OptionsProjectionResponse(BaseModel):
    data: list[OptionsProjectionPoint]

