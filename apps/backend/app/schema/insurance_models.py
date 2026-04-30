import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel


class InsurancePolicy(SQLModel, table=True):
    __tablename__ = "insurance_policies"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
    )
    user_id: Optional[str] = Field(default=None, foreign_key="auth.users.id", index=True)  # FK to auth.users
    owner: str  # "You" or "Partner"
    type: str  # "life", "mortgage", "health", "disability", "other"
    provider: str
    policy_number: Optional[str] = None
    sum_insured: str  # Free-text for display flexibility
    monthly_premium: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(18, 6)))
    beneficiaries: Optional[str] = None
    expiry_date: Optional[str] = None  # ISO date string
    website: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
