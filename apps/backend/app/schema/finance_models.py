from datetime import date
from typing import List, Dict, Union, Optional, Any
from pydantic import BaseModel
from sqlmodel import SQLModel, Field, Column, JSON
from datetime import date as date_type

# --- Pydantic Schemas for JSON Validation ---

class FinanceItem(BaseModel):
    id: str
    category: str # 'Savings', 'Investments', 'Assets', 'Liabilities'
    name: str
    value: float
    type: str
    owner: str
class FinanceItem(BaseModel):
    id: str
    category: str # 'Savings', 'Investments', 'Assets', 'Liabilities'
    name: str
    value: float
    type: str
    owner: str
    # Priorities for Cash Flow
    inflow_priority: Optional[int] = 100 # Lower number = Higher priority
    withdrawal_priority: Optional[int] = 100
    # Withdrawal Limits
    max_withdrawal_rate: Optional[float] = None # Percentage (0-100)
    max_withdrawal_cap: Optional[float] = None # Fixed amount (e.g. 200000 for RSU)
    currency: Optional[str] = 'ILS' # Default to ILS
    details: Optional[Dict[str, Any]] = None

class SnapshotData(BaseModel):
    items: List[FinanceItem] = []
    # We can add computed totals here or compute them on retrieval.
    # Storing them makes history queries faster/easier (e.g. "Select net_worth from snapshots")
    total_savings: float
    total_investments: float
    total_assets: float
    total_liabilities: float
    net_worth: float
    date: Optional[date_type] = None

# --- SQLModel Database Table ---

class FinanceSnapshot(SQLModel, table=True):
    __tablename__ = "finance_snapshots"

    date: date_type = Field(primary_key=True)
    
    # Store the entire snapshot as a JSON document
    data: Dict = Field(sa_column=Column(JSON, nullable=False))
    
    # We can also store top-level metrics as columns for easy SQL aggregation/graphing
    # without needing JSON extraction syntax in every query.
    net_worth: float
    total_assets: float
    total_liabilities: float
