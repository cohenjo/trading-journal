from typing import List, Literal, Optional
from datetime import datetime
from pydantic import BaseModel
from sqlmodel import SQLModel, Field

# --- Database Models ---

class DividendPosition(SQLModel, table=True):
    __tablename__ = "dividend_positions"

    id: Optional[int] = Field(default=None, primary_key=True)
    account: str = Field(index=True) # e.g. ABKR, IRS, RSU
    ticker: str
    shares: float

class DividendAccount(SQLModel, table=True):
    __tablename__ = "dividend_accounts"
    name: str = Field(primary_key=True)
    linked_id: Optional[str] = Field(default=None) # Link to FinanceItem.id

class DividendTickerData(SQLModel, table=True):
    __tablename__ = "dividend_ticker_data"
    ticker: str = Field(primary_key=True)
    last_updated: datetime
    price: float
    currency: str
    dividend_yield: float
    dividend_rate: float
    dgr_3y: float
    dgr_5y: float
    previous_close: float = 0.0

# --- Pydantic Schemas for API ---

class DividendPositionCreate(BaseModel):
    account: str
    ticker: str
    shares: float

class DividendPositionRead(BaseModel):
    id: int
    account: str
    ticker: str
    shares: float

# Data enriched with yfinance stats
class DividendPositionStats(DividendPositionRead):
    price: float
    dividend_yield: float
    annual_income: float
    currency: str
    dgr_3y: float
    dgr_5y: float

class DividendDashboardStats(BaseModel):
    portfolio_yield: float
    annual_income: float
    dgr_5y: float
    currency: str = "USD"

# --- Legacy / Projection Models (kept for backward compatibility if needed, or migration) ---

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
