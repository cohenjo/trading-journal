from enum import Enum
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field

class TradingAccountType(str, Enum):
    IBKR = "IBKR"
    SCHWAB = "SCHWAB"

class TradingAccountConfig(SQLModel, table=True):
    __tablename__ = "trading_account_config"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(default="My Trading Account")
    account_type: TradingAccountType = Field(default=TradingAccountType.IBKR)
    
    # IBKR specific fields
    host: Optional[str] = Field(default="127.0.0.1")
    port: Optional[int] = Field(default=4001) 
    client_id: Optional[int] = Field(default=1)
    
    # Schwab specific fields
    app_key: Optional[str] = Field(default=None)
    app_secret: Optional[str] = Field(default=None)
    account_hash: Optional[str] = Field(default=None)
    tokens_path: Optional[str] = Field(default="schwab_tokens.json")
    
    # Link to the internal FinanceItem ID (from finance_models.py)
    linked_account_id: Optional[str] = Field(default=None) 
    
    # Account ID from Broker (e.g. IBKR U1234567), populated after connection
    account_id: Optional[str] = Field(default=None)
    last_synced: Optional[datetime] = Field(default=None)

class TradingAccountSummary(SQLModel, table=True):
    __tablename__ = "trading_account_summary"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    account_config_id: Optional[int] = Field(default=None, foreign_key="trading_account_config.id")
    net_liquidation: float
    total_cash: float
    currency: str = Field(default="USD")
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class TradingPosition(SQLModel, table=True):
    __tablename__ = "trading_positions"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    account_config_id: Optional[int] = Field(default=None, foreign_key="trading_account_config.id")
    symbol: str
    amount: float
    sec_type: str
    avg_cost: float
    con_id: Optional[int] = Field(default=None) # Optional for non-IBKR
    timestamp: datetime = Field(default_factory=datetime.utcnow)
