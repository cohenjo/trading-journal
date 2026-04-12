from datetime import datetime, date as date_type
from decimal import Decimal
from typing import Optional

from sqlalchemy import BigInteger, Column, Numeric
from sqlmodel import Field, SQLModel


class ManualTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime
    symbol: str
    side: str
    size: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    entry_price: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    exit_price: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    pnl: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    notes: Optional[str] = None


class Trade(SQLModel, table=True):
    tradeID: int = Field(sa_column=Column("tradeID", BigInteger, primary_key=True))
    accountId: str
    acctAlias: Optional[str] = None
    model: Optional[str] = None
    currency: str
    fxRateToBase: Decimal = Field(sa_column=Column("fxRateToBase", Numeric(18, 6)))
    assetCategory: str
    subCategory: Optional[str] = None
    symbol: str
    description: Optional[str] = None
    conid: int = Field(sa_column=Column(BigInteger))
    securityID: Optional[str] = None
    securityIDType: Optional[str] = None
    cusip: Optional[str] = None
    isin: Optional[str] = None
    figi: Optional[str] = None
    listingExchange: Optional[str] = None
    underlyingConid: Optional[str] = None
    underlyingSymbol: Optional[str] = None
    underlyingSecurityID: Optional[str] = None
    underlyingListingExchange: Optional[str] = None
    issuer: Optional[str] = None
    issuerCountryCode: Optional[str] = None
    multiplier: int
    relatedTradeID: Optional[str] = None
    strike: Optional[str] = None
    reportDate: Optional[date_type] = None
    expiry: Optional[str] = None
    dateTime: datetime
    putCall: Optional[str] = None
    tradeDate: Optional[date_type] = None
    principalAdjustFactor: Optional[str] = None
    settleDateTarget: Optional[date_type] = None
    transactionType: Optional[str] = None
    exchange: Optional[str] = None
    quantity: Decimal = Field(sa_column=Column("quantity", Numeric(18, 6)))
    tradePrice: Decimal = Field(sa_column=Column("tradePrice", Numeric(18, 6)))
    tradeMoney: Decimal = Field(sa_column=Column("tradeMoney", Numeric(18, 6)))
    proceeds: Decimal = Field(sa_column=Column("proceeds", Numeric(18, 6)))
    taxes: Decimal = Field(sa_column=Column("taxes", Numeric(18, 6)))
    ibCommission: Decimal = Field(sa_column=Column("ibCommission", Numeric(18, 6)))
    ibCommissionCurrency: Optional[str] = None
    netCash: Decimal = Field(sa_column=Column("netCash", Numeric(18, 6)))
    closePrice: Decimal = Field(sa_column=Column("closePrice", Numeric(18, 6)))
    openCloseIndicator: Optional[str] = None
    notes: Optional[str] = None
    cost: Decimal = Field(sa_column=Column("cost", Numeric(18, 6)))
    fifoPnlRealized: Decimal = Field(sa_column=Column("fifoPnlRealized", Numeric(18, 6)))
    mtmPnl: Decimal = Field(sa_column=Column("mtmPnl", Numeric(18, 6)))
    origTradePrice: Optional[Decimal] = Field(default=None, sa_column=Column("origTradePrice", Numeric(18, 6)))
    origTradeDate: Optional[str] = None
    origTradeID: Optional[str] = None
    origOrderID: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    origTransactionID: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    buySell: Optional[str] = None
    clearingFirmID: Optional[str] = None
    ibOrderID: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    transactionID: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    ibExecID: Optional[str] = None
    relatedTransactionID: Optional[str] = None
    rtn: Optional[str] = None
    brokerageOrderID: Optional[str] = None
    orderReference: Optional[str] = None
    volatilityOrderLink: Optional[str] = None
    exchOrderId: Optional[str] = None
    extExecID: Optional[str] = None
    orderTime: Optional[datetime] = None
    openDateTime: Optional[str] = None
    holdingPeriodDateTime: Optional[str] = None
    whenRealized: Optional[str] = None
    whenReopened: Optional[str] = None
    levelOfDetail: Optional[str] = None
    changeInPrice: Optional[Decimal] = Field(default=None, sa_column=Column("changeInPrice", Numeric(18, 6)))
    changeInQuantity: Optional[Decimal] = Field(default=None, sa_column=Column("changeInQuantity", Numeric(18, 6)))
    orderType: Optional[str] = None
    traderID: Optional[str] = None
    isAPIOrder: Optional[str] = None
    accruedInt: Optional[Decimal] = Field(default=None, sa_column=Column("accruedInt", Numeric(18, 6)))
    initialInvestment: Optional[str] = None
    serialNumber: Optional[str] = None
    deliveryType: Optional[str] = None
    commodityType: Optional[str] = None
    fineness: Optional[Decimal] = Field(default=None, sa_column=Column("fineness", Numeric(18, 6)))
    weight: Optional[Decimal] = Field(default=None, sa_column=Column("weight", Numeric(18, 6)))


class DailySummary(SQLModel, table=True):
    date: date_type = Field(primary_key=True)
    total_pnl: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    winning_trades: int
    losing_trades: int
    win_rate: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    avg_win: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    avg_loss: Decimal = Field(sa_column=Column(Numeric(18, 6)))


class Note(SQLModel, table=True):
    date: date_type = Field(primary_key=True)
    content: str


class Ndx1m(SQLModel, table=True):
    timestamp: datetime = Field(primary_key=True)
    open: Decimal = Field(sa_column=Column("open", Numeric(18, 6)))
    high: Decimal = Field(sa_column=Column("high", Numeric(18, 6)))
    low: Decimal = Field(sa_column=Column("low", Numeric(18, 6)))
    close: Decimal = Field(sa_column=Column("close", Numeric(18, 6)))
    volume: int


class Ndx1mChartData(SQLModel):
    time: float
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal


class DailyBar(SQLModel, table=True):
    symbol: str = Field(primary_key=True)
    date: date_type = Field(primary_key=True)
    open: Decimal = Field(sa_column=Column("open", Numeric(18, 6)))
    high: Decimal = Field(sa_column=Column("high", Numeric(18, 6)))
    low: Decimal = Field(sa_column=Column("low", Numeric(18, 6)))
    close: Decimal = Field(sa_column=Column("close", Numeric(18, 6)))
    volume: int


class Execution(SQLModel, table=True):
    execId: str = Field(primary_key=True, index=True)
    permId: int
    orderId: int
    clientId: int
    time: datetime
    acctNumber: str
    exchange: str
    side: str
    shares: Decimal = Field(sa_column=Column("shares", Numeric(18, 6)))
    price: Decimal = Field(sa_column=Column("price", Numeric(18, 6)))
    avgPrice: Decimal = Field(sa_column=Column("avgPrice", Numeric(18, 6)))
    cumQty: Decimal = Field(sa_column=Column("cumQty", Numeric(18, 6)))
    symbol: str
    commission: Decimal = Field(sa_column=Column("commission", Numeric(18, 6)))
    currency: str
    realizedPNL: Optional[Decimal] = Field(default=None, sa_column=Column("realizedPNL", Numeric(18, 6)))


class MatchedTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    symbol: str
    open_transaction_id: int = Field(sa_column=Column(BigInteger))
    open_date: datetime
    close_transaction_id: int = Field(sa_column=Column(BigInteger))
    close_date: datetime
    open_price: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    close_price: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    pnl: Decimal = Field(sa_column=Column(Numeric(18, 6)))
    notes: Optional[str] = None

# Import backtest models to register them with SQLModel.metadata
from .backtest_models import OptionContract, HistoricalOptionBar, BacktestRun, BacktestTrade
# Import finance models for alebmic registration
from .finance_models import FinanceSnapshot
# Import plan models for alembic registration
from .plan_models import Plan
# Import dividend models for alembic registration
from .dividend_models import DividendPosition, DividendAccount, DividendTickerData
# Import trading models for alembic registration
from .trading_models import TradingAccountConfig
# Import insurance models for alembic registration
from .insurance_models import InsurancePolicy
