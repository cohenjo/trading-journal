from decimal import Decimal
from typing import List, Literal, Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

# --- Database Models ---

class DividendPosition(SQLModel, table=True):
    __tablename__ = "dividend_positions"

    id: Optional[int] = Field(default=None, primary_key=True)
    account: str = Field(index=True) # e.g. ABKR, IRS, RSU
    ticker: str
    shares: Decimal = Field(sa_column=Column(Numeric(18, 6)))

class DividendAccount(SQLModel, table=True):
    __tablename__ = "dividend_accounts"
    name: str = Field(primary_key=True)
    linked_id: Optional[str] = Field(default=None) # Link to FinanceItem.id
    household_id: Optional[UUID] = Field(default=None, foreign_key="households.id", index=True)

class DividendTickerData(SQLModel, table=True):
    __tablename__ = "dividend_ticker_data"
    ticker: str = Field(primary_key=True)
    last_updated: datetime
    price: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    currency: str
    dividend_yield: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    dividend_rate: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    dgr_3y: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    dgr_5y: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    previous_close: Decimal = Field(default=Decimal("0"), sa_column=Column(Numeric(18, 6)))

# --- Pydantic Schemas for API ---

class DividendPositionCreate(BaseModel):
    account: str
    ticker: str
    shares: Decimal

class DividendPositionRead(BaseModel):
    id: int
    account: str
    ticker: str
    shares: Decimal

# Data enriched with yfinance stats
class DividendPositionStats(DividendPositionRead):
    price: Decimal
    dividend_yield: Decimal
    annual_income: Decimal
    currency: str
    dgr_3y: Decimal
    dgr_5y: Decimal

class DividendDashboardStats(BaseModel):
    portfolio_yield: Decimal
    annual_income: Decimal
    dgr_5y: Decimal
    currency: str = "USD"

# --- Legacy / Projection Models (kept for backward compatibility if needed, or migration) ---

class DividendRecord(BaseModel):
    year: int
    amount: Decimal

class DividendProjectionParams(BaseModel):
    yield_rate: Decimal
    growth_rate: Decimal
    reinvest_rate: Decimal
    cutoff_year: int
    final_year: int

class DividendProjectionPoint(BaseModel):
    year: int
    amount: Decimal
    type: Literal['historical', 'projected']

class DividendProjectionResponse(BaseModel):
    data: List[DividendProjectionPoint]
