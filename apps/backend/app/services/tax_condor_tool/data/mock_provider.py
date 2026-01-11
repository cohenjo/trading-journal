from typing import List
from datetime import date, timedelta
import random
from ..interfaces import MarketDataProvider
from ..models import OptionLeg, GreekVector
from ..core.pricer import BlackScholesPricer

class MockDataProvider(MarketDataProvider):
    def __init__(self, spot=450.0, vol=0.20):
        self.spot = spot
        self.vol = vol
        self.r = 0.05 # Risk free rate

    async def get_spot_price(self, symbol: str) -> float:
        s = symbol.upper()
        if s == "SPY": return 500.0
        if s == "QQQ": return 440.0
        if s == "IWM": return 200.0
        if s == "NDX": return 17500.0
        if s == "SPX": return 5100.0
        return self.spot

    async def get_volatility(self, symbol: str, days: int = 30) -> float:
        return self.vol

    async def get_expirations(self, symbol: str) -> List[date]:
        today = date.today()
        return [
            today + timedelta(days=30),  # Near term for IC
            today + timedelta(days=45),
            today + timedelta(days=365), # Long term for LEAP
            today + timedelta(days=400)
        ]

    async def get_option_chain(self, symbol: str, expiration: date, limit: int = 100) -> List[OptionLeg]:
        # Generate synthetic chain
        spot = await self.get_spot_price(symbol)
        T = (expiration - date.today()).days / 365.0
        strikes = range(int(spot * 0.8), int(spot * 1.2), int(spot * 0.01) or 5)
        
        chain = []
        for k in strikes:
            # Call
            c_price = BlackScholesPricer.price(spot, k, T, self.r, self.vol, True)
            c_greeks = BlackScholesPricer.greeks(spot, k, T, self.r, self.vol, True)
            
            chain.append(OptionLeg(
                symbol=symbol,
                strike=float(k),
                expiration=expiration,
                option_type="call",
                action="buy", # Default
                quantity=0,
                greeks=GreekVector(delta=c_greeks[0], gamma=c_greeks[1], theta=c_greeks[2], vega=c_greeks[3]),
                price=c_price,
                implied_volatility=self.vol
            ))
            
            # Put
            p_price = BlackScholesPricer.price(spot, k, T, self.r, self.vol, False)
            p_greeks = BlackScholesPricer.greeks(spot, k, T, self.r, self.vol, False)
            
            chain.append(OptionLeg(
                symbol=symbol,
                strike=float(k),
                expiration=expiration,
                option_type="put",
                action="buy", # Default
                quantity=0,
                greeks=GreekVector(delta=p_greeks[0], gamma=p_greeks[1], theta=p_greeks[2], vega=p_greeks[3]),
                price=p_price,
                implied_volatility=self.vol
            ))
            
        return chain
