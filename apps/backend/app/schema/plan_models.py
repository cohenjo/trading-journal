from datetime import datetime, date as date_type
from typing import List, Dict, Optional, Union
from pydantic import BaseModel
from sqlmodel import SQLModel, Field, Column, JSON

# --- Pydantic Schemas for JSON Validation ---

class PlanItem(BaseModel):
    id: str
    name: str # e.g. "Salary", "Rent"
    category: str # "Income", "Expense", "Asset" 
    sub_category: Optional[str] = None # "Salary", "Housing"
    owner: str # "You", "Spouse"
    currency: str = "ILS" # "USD", "ILS", "EUR"
    
    # Financials
    value: float = 0.0 # Annual Amount or Current Value
    growth_rate: float = 0.0 # Percentage
    
    # Timing
    start_date: Optional[Union[date_type, str]] = None # specific date or "Today"
    end_date: Optional[Union[date_type, str]] = None # specific date or "Retirement"
    frequency: str = "Yearly" # "Monthly", "Yearly", "OneTime"
    
    # New Fields matching Frontend types.ts
    tax_rate: Optional[float] = 0.0
    start_condition: Optional[str] = None
    start_reference: Optional[str] = None
    end_condition: Optional[str] = None
    end_reference: Optional[str] = None
    recurrence: Optional[Dict] = None
    
    # Priorities
    inflow_priority: Optional[int] = 100
    withdrawal_priority: Optional[int] = 100
    
    # Account Settings (Top Level)
    # Commons keys: type, bond_allocation, dividend_yield, fees, withdrawal_priority
    # Dividend Policy keys: dividend_policy ('Accumulate'|'Payout'), dividend_mode ('Percent'|'Fixed'), 
    # dividend_fixed_amount, dividend_growth_rate, dividend_tax_rate
    # Dividend Timing: dividend_payout_start_condition ('Immediate'|'Age'|'Milestone'|'Date'), dividend_payout_start_reference
    account_settings: Optional[Dict] = {}
    
    # Details
    details: Dict = {} # Flexible for other props like "tax_treatment", "financing"

class PlanMilestone(BaseModel):
    id: str
    name: str
    date: Optional[Union[date_type, str]] = None
    year_offset: Optional[int] = None # e.g. 20 (years from now)
    type: str = "Custom" # "Retirement", "Financial Independence", "Debt Free", "Life Expectancy"
    details: Dict = {}
    icon: Optional[str] = None
    color: Optional[str] = None
    owner: Optional[str] = "You"

class PlanData(BaseModel):
    items: List[PlanItem] = []
    milestones: List[PlanMilestone] = []
    settings: Dict = {}

# --- SQLModel Database Table ---

class Plan(SQLModel, table=True):
    __tablename__ = "plans"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None
    
    # Store complex structure as JSON
    data: Dict = Field(sa_column=Column(JSON, nullable=False))
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
