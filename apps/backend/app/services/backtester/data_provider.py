from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta
from typing import List, Optional, Dict, Set
from sqlmodel import Session, select
from app.dal.database import engine
from app.schema.models import DailyBar
from app.services.tax_condor_tool.core.pricer import BlackScholesPricer
from dateutil.relativedelta import relativedelta
import math

class OptionChain:
    def __init__(self, date: date, underlying_price: float, volatility: float):
        self.date = date
        self.underlying_price = underlying_price
        self.volatility = volatility
        self.contracts: Dict[int, Dict] = {} # conid -> details

    def add_contract(self, conid: int, expiration: date, strike: float, right: str, price: float, greeks: dict):
        self.contracts[conid] = {
            "conid": conid,
            "expiration": expiration,
            "strike": strike,
            "right": right,
            "price": price,
            "greeks": greeks
        }

    def get_contract(self, conid: int):
        return self.contracts.get(conid)

class DataProvider(ABC):
    @abstractmethod
    def get_spot_price(self, symbol: str, date: date) -> float:
        pass

    @abstractmethod
    def get_option_chain(self, symbol: str, date: date) -> OptionChain:
        pass

class SyntheticDataProvider(DataProvider):
    def __init__(self):
        self.cache_spot = {}
        self.cache_vol = {}

    def _get_daily_bar(self, symbol: str, date: date) -> Optional[DailyBar]:
        with Session(engine) as session:
            return session.get(DailyBar, (symbol, date))

    def get_spot_price(self, symbol: str, date: date) -> float:
        if (symbol, date) in self.cache_spot:
            return self.cache_spot[(symbol, date)]
        
        bar = self._get_daily_bar(symbol, date)
        if bar:
            self.cache_spot[(symbol, date)] = bar.close
            return bar.close
        return 0.0

    def get_volatility(self, symbol: str, date: date) -> float:
        # Map symbol to vol symbol
        if symbol in ['NDX', 'QQQ']:
            vol_symbol = 'VXN'
        elif symbol in ['SPX', 'SPY']:
            vol_symbol = 'VIX'
        else:
            vol_symbol = 'VIX'
        
        if (vol_symbol, date) in self.cache_vol:
            return self.cache_vol[(vol_symbol, date)]
            
        bar = self._get_daily_bar(vol_symbol, date)
        if bar:
            # VXN is in percentage points, e.g. 20.0 means 20%
            vol = bar.close / 100.0
            self.cache_vol[(vol_symbol, date)] = vol
            return vol
        return 0.20 # Default fallback

    def get_expirations(self, symbol: str, date: date) -> List[date]:
        expirations = set()
        current = date
        
        # Next 6 Fridays
        for _ in range(6):
            days_ahead = (4 - current.weekday() + 7) % 7
            if days_ahead == 0: days_ahead = 7
            current += timedelta(days=days_ahead)
            expirations.add(current)
            
        # Next 24 Months (3rd Friday)
        current_month = date.replace(day=1)
        for _ in range(24):
            c = current_month
            days_to_fri = (4 - c.weekday() + 7) % 7
            first_fri = c + timedelta(days=days_to_fri)
            third_fri = first_fri + timedelta(weeks=2)
            
            if third_fri > date:
                expirations.add(third_fri)
            
            current_month += relativedelta(months=1)
            
        return sorted(list(expirations))

    def get_option_chain(self, symbol: str, date: date, expiration: Optional[date] = None) -> OptionChain:
        spot = self.get_spot_price(symbol, date)
        vol = self.get_volatility(symbol, date)
        
        chain = OptionChain(date, spot, vol)
        
        if spot == 0:
            return chain

        if expiration:
            sorted_exps = [expiration]
        else:
            sorted_exps = self.get_expirations(symbol, date)
        
        # Generate Strikes
        # +/- 20% of spot, step 100
        min_strike = spot * 0.8
        max_strike = spot * 1.2
        
        # Determine step size based on spot price
        if spot < 1000:
            step = 5 # e.g. SPY, QQQ
        elif spot < 10000:
            step = 25 # e.g. SPX
        else:
            step = 100 # e.g. NDX
        
        # Round to nearest step
        start_strike = math.floor(min_strike / step) * step
        end_strike = math.ceil(max_strike / step) * step
        
        strikes = range(start_strike, end_strike + step, step)
        
        # Generate Contracts
        for exp in sorted_exps:
            dte = (exp - date).days
            if dte < 1: continue
            
            t = dte / 365.0
            r = 0.05 # Risk free rate assumption
            
            for strike in strikes:
                # Call
                call_price = BlackScholesPricer.price(spot, strike, t, r, vol, True)
                d, g, th, v = BlackScholesPricer.greeks(spot, strike, t, r, vol, True)
                call_greeks = {"delta": d, "gamma": g, "theta": th, "vega": v, "implied_vol": vol}
                
                # Put
                put_price = BlackScholesPricer.price(spot, strike, t, r, vol, False)
                d, g, th, v = BlackScholesPricer.greeks(spot, strike, t, r, vol, False)
                put_greeks = {"delta": d, "gamma": g, "theta": th, "vega": v, "implied_vol": vol}
                
                # Generate synthetic conid
                # Simple hash
                call_id = abs(hash(f"{symbol}{exp}{strike}C")) & 0xFFFFFFFF
                put_id = abs(hash(f"{symbol}{exp}{strike}P")) & 0xFFFFFFFF
                
                chain.add_contract(call_id, exp, strike, 'C', call_price, call_greeks)
                chain.add_contract(put_id, exp, strike, 'P', put_price, put_greeks)
                
        return chain
