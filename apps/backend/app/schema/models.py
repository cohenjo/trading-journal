from datetime import datetime, date as date_type
from typing import Optional

from sqlalchemy import BigInteger, Column
from sqlmodel import Field, SQLModel


class ManualTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime
    symbol: str
    side: str
    size: float
    entry_price: float
    exit_price: float
    pnl: float
    notes: Optional[str] = None


class Trade(SQLModel, table=True):
    tradeID: int = Field(sa_column=Column("tradeID", BigInteger, primary_key=True))
    accountId: str
    acctAlias: Optional[str] = None
    model: Optional[str] = None
    currency: str
    fxRateToBase: float
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
    quantity: float
    tradePrice: float
    tradeMoney: float
    proceeds: float
    taxes: float
    ibCommission: float
    ibCommissionCurrency: Optional[str] = None
    netCash: float
    closePrice: float
    openCloseIndicator: Optional[str] = None
    notes: Optional[str] = None
    cost: float
    fifoPnlRealized: float
    mtmPnl: float
    origTradePrice: Optional[float] = None
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
    changeInPrice: Optional[float] = None
    changeInQuantity: Optional[float] = None
    orderType: Optional[str] = None
    traderID: Optional[str] = None
    isAPIOrder: Optional[str] = None
    accruedInt: Optional[float] = None
    initialInvestment: Optional[str] = None
    serialNumber: Optional[str] = None
    deliveryType: Optional[str] = None
    commodityType: Optional[str] = None
    fineness: Optional[float] = None
    weight: Optional[float] = None


class DailySummary(SQLModel, table=True):
    date: date_type = Field(primary_key=True)
    total_pnl: float
    winning_trades: int
    losing_trades: int
    win_rate: float
    avg_win: float
    avg_loss: float


class Note(SQLModel, table=True):
    date: date_type = Field(primary_key=True)
    content: str


class Ndx1m(SQLModel, table=True):
    timestamp: datetime = Field(primary_key=True)
    open: float
    high: float
    low: float
    close: float
    volume: int


class Ndx1mChartData(SQLModel):
    time: float
    open: float
    high: float
    low: float
    close: float


class DailyBar(SQLModel, table=True):
    symbol: str = Field(primary_key=True)
    date: date_type = Field(primary_key=True)
    open: float
    high: float
    low: float
    close: float
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
    shares: float
    price: float
    avgPrice: float
    cumQty: float
    symbol: str
    commission: float
    currency: str
    realizedPNL: float | None = Field(default=None)


class MatchedTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    symbol: str
    open_transaction_id: int = Field(sa_column=Column(BigInteger))
    open_date: datetime
    close_transaction_id: int = Field(sa_column=Column(BigInteger))
    close_date: datetime
    open_price: float
    close_price: float
    pnl: float
    notes: Optional[str] = None
# Import backtest models to register them with SQLModel.metadata
from .backtest_models import OptionContract, HistoricalOptionBar, BacktestRun, BacktestTrade
