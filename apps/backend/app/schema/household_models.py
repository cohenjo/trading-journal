from uuid import UUID
from typing import Optional
from datetime import date

from sqlmodel import Field, SQLModel


class Household(SQLModel, table=True):
    """Household entity for multi-user data sharing."""
    
    __tablename__ = "households"
    
    id: UUID = Field(primary_key=True)
    name: str = Field(nullable=False)
    created_by: UUID = Field(foreign_key="auth.users.id", nullable=False)
    created_at: Optional[date] = Field(default=None)
    updated_at: Optional[date] = Field(default=None)
    deleted_at: Optional[date] = Field(default=None)


class HouseholdMember(SQLModel, table=True):
    """Membership relationship between users and households."""
    
    __tablename__ = "household_members"
    
    household_id: UUID = Field(foreign_key="households.id", primary_key=True)
    user_id: UUID = Field(foreign_key="auth.users.id", primary_key=True)
    role: str = Field(nullable=False)  # "owner", "member", "viewer"
    invited_by: UUID = Field(foreign_key="auth.users.id", nullable=False)
    invited_at: Optional[date] = Field(default=None)
    joined_at: Optional[date] = Field(default=None)
    left_at: Optional[date] = Field(default=None)
