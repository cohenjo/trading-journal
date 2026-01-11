from datetime import datetime, date
from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel

class OptionContract(SQLModel, table=True):
    """Registry of unique option contracts to save space."""
    conid: int = Field(sa_column=Column(BigInteger, primary_key=True))  # IBKR Contract ID
    symbol: str = Field(index=True)       # e.g., "NDX"
    expiration: date = Field(index=True)
    strike: float
    right: str = Field(max_length=1)      # "C" or "P"
    multiplier: str = Field(default="100")

class HistoricalOptionBar(SQLModel, table=True):
    """Daily/Hourly OHLCV + Greeks for an option."""
    id: Optional[int] = Field(default=None, primary_key=True)
    conid: int = Field(sa_column=Column(BigInteger, ForeignKey("optioncontract.conid"), index=True))
    date: datetime = Field(index=True)
    
    # Price Data
    open: float
    high: float
    low: float
    close: float
    volume: int
    
    # Greeks (Snapshot at close)
    implied_vol: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    
    # Underlying Price (for convenience/speed)
    underlying_price: float

class BacktestRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    start_date: date
    end_date: date
    initial_capital: float
    parameters: str  # JSON string of strategy params (budget, delta, etc.)
    
    # Results
    final_equity: float
    total_realized_pnl: float
    total_unrealized_pnl: float

class BacktestTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="backtestrun.id")
    date: datetime
    action: str  # "BUY", "SELL", "EXPIRE"
    conid: int = Field(sa_column=Column(BigInteger))
    quantity: float
    price: float
    commission: float
    notes: Optional[str] = None
