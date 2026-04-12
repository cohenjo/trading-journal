from datetime import datetime, date
from decimal import Decimal
from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey, Numeric
from sqlmodel import Field, SQLModel

class OptionContract(SQLModel, table=True):
    """Registry of unique option contracts to save space."""
    conid: int = Field(sa_column=Column(BigInteger, primary_key=True))  # IBKR Contract ID
    symbol: str = Field(index=True)       # e.g., "NDX"
    expiration: date = Field(index=True)
    strike: Decimal = Field(sa_column=Column("strike", Numeric(18, 6)))
    right: str = Field(max_length=1)      # "C" or "P"
    multiplier: str = Field(default="100")

class HistoricalOptionBar(SQLModel, table=True):
    """Daily/Hourly OHLCV + Greeks for an option."""
    id: Optional[int] = Field(default=None, primary_key=True)
    conid: int = Field(sa_column=Column(BigInteger, ForeignKey("optioncontract.conid"), index=True))
    date: datetime = Field(index=True)
    
    # Price Data
    open: Decimal = Field(sa_column=Column("open", Numeric(18, 6)))
    high: Decimal = Field(sa_column=Column("high", Numeric(18, 6)))
    low: Decimal = Field(sa_column=Column("low", Numeric(18, 6)))
    close: Decimal = Field(sa_column=Column("close", Numeric(18, 6)))
    volume: int
    
    # Greeks (Snapshot at close)
    implied_vol: Optional[Decimal] = Field(default=None, sa_column=Column("implied_vol", Numeric(18, 6)))
    delta: Optional[Decimal] = Field(default=None, sa_column=Column("delta", Numeric(18, 6)))
    gamma: Optional[Decimal] = Field(default=None, sa_column=Column("gamma", Numeric(18, 6)))
    theta: Optional[Decimal] = Field(default=None, sa_column=Column("theta", Numeric(18, 6)))
    vega: Optional[Decimal] = Field(default=None, sa_column=Column("vega", Numeric(18, 6)))
    
    # Underlying Price (for convenience/speed)
    underlying_price: Decimal = Field(sa_column=Column("underlying_price", Numeric(18, 6)))

class BacktestRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    start_date: date
    end_date: date
    initial_capital: Decimal = Field(sa_column=Column("initial_capital", Numeric(18, 6)))
    parameters: str  # JSON string of strategy params (budget, delta, etc.)
    
    # Results
    final_equity: Decimal = Field(sa_column=Column("final_equity", Numeric(18, 6)))
    total_realized_pnl: Decimal = Field(sa_column=Column("total_realized_pnl", Numeric(18, 6)))
    total_unrealized_pnl: Decimal = Field(sa_column=Column("total_unrealized_pnl", Numeric(18, 6)))

class BacktestTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="backtestrun.id")
    date: datetime
    action: str  # "BUY", "SELL", "EXPIRE"
    conid: int = Field(sa_column=Column(BigInteger))
    quantity: Decimal = Field(sa_column=Column("quantity", Numeric(18, 6)))
    price: Decimal = Field(sa_column=Column("price", Numeric(18, 6)))
    commission: Decimal = Field(sa_column=Column("commission", Numeric(18, 6)))
    notes: Optional[str] = None
