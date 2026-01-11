from pydantic import BaseModel
from typing import List, Optional, Tuple
from datetime import date

class GreekVector(BaseModel):
    delta: float
    gamma: float
    theta: float
    vega: float

class OptionLeg(BaseModel):
    symbol: str
    strike: float
    expiration: date
    option_type: str  # "call" or "put"
    action: str       # "buy" or "sell"
    quantity: int
    greeks: GreekVector
    price: float
    bid: Optional[float] = None
    ask: Optional[float] = None
    mid: Optional[float] = None
    implied_volatility: Optional[float] = None
    conid: Optional[int] = None

class PnLSimulation(BaseModel):
    price_change_pct: float
    underlying_price: Optional[float] = None
    estimated_pnl: float

class IronCondorStructure(BaseModel):
    short_call: OptionLeg
    long_call: OptionLeg
    short_put: OptionLeg
    long_put: OptionLeg
    net_credit: float
    margin_requirement: float
    greeks: GreekVector
    pnl_simulations: Optional[List[PnLSimulation]] = None
    chart_data: Optional[List[PnLSimulation]] = None
    days_to_expiration: Optional[int] = None

class LeapRecommendation(BaseModel):
    leg: OptionLeg
    reason: str

class TaxCondorRecommendation(BaseModel):
    leap: LeapRecommendation
    iron_condor: IronCondorStructure
    score: float
    analysis: dict  # Contains validation details like "theta_coverage_ratio", etc.
    portfolio_pnl_simulations: Optional[List[PnLSimulation]] = None
    portfolio_chart_data: Optional[List[PnLSimulation]] = None
    underlying_price: Optional[float] = None
    underlying_iv: Optional[float] = None
