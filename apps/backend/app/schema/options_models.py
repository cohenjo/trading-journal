from __future__ import annotations

from pydantic import BaseModel


class OptionsRecord(BaseModel):
    year: int
    amount: float


class OptionsProjectionParams(BaseModel):
    growth_rate: float
    cutoff_year: int
    final_year: int


class OptionsProjectionPoint(BaseModel):
    year: int
    amount: float
    type: str  # "historical" or "projected"


class OptionsProjectionResponse(BaseModel):
    data: list[OptionsProjectionPoint]

