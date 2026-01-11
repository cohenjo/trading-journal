from pydantic import BaseModel
from typing import List, Literal

class DividendRecord(BaseModel):
    year: int
    amount: float

class DividendProjectionParams(BaseModel):
    yield_rate: float
    growth_rate: float
    reinvest_rate: float
    cutoff_year: int
    final_year: int

class DividendProjectionPoint(BaseModel):
    year: int
    amount: float
    type: Literal['historical', 'projected']

class DividendProjectionResponse(BaseModel):
    data: List[DividendProjectionPoint]
