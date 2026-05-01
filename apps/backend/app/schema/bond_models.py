from datetime import date
from uuid import UUID
from typing import Optional

from sqlmodel import Field, SQLModel


class BondHolding(SQLModel, table=True):
    """Bond holding in user's portfolio.
    
    Tracks individual bond positions including government, corporate, and municipal bonds.
    Used for income planning and bond ladder construction.
    """
    
    __tablename__ = "bond_holdings"
    
    id: str = Field(primary_key=True)  # CUSIP or other bond identifier
    household_id: UUID = Field(foreign_key="households.id", nullable=False)
    ticker: Optional[str] = Field(default=None)
    issuer: str = Field(nullable=False)
    currency: str = Field(nullable=False)
    face_value: float = Field(nullable=False)
    coupon_rate: float = Field(nullable=False)
    coupon_frequency: str = Field(nullable=False)  # "ANNUAL", "SEMI_ANNUAL", "QUARTERLY"
    issue_date: date = Field(nullable=False)
    maturity_date: date = Field(nullable=False)
    created_at: Optional[date] = Field(default=None)
    updated_at: Optional[date] = Field(default=None)
    deleted_at: Optional[date] = Field(default=None)


class BondHoldingCreate(SQLModel):
    """Request model for creating a new bond holding."""
    
    id: str
    ticker: Optional[str] = None
    issuer: str
    currency: str
    face_value: float
    coupon_rate: float
    coupon_frequency: str
    issue_date: date
    maturity_date: date


class BondHoldingUpdate(SQLModel):
    """Request model for updating a bond holding."""
    
    face_value: Optional[float] = None
    ticker: Optional[str] = None
    issuer: Optional[str] = None
    currency: Optional[str] = None
    coupon_rate: Optional[float] = None
    coupon_frequency: Optional[str] = None
    issue_date: Optional[date] = None
    maturity_date: Optional[date] = None
