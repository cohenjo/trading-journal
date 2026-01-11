from typing import List, Optional
from datetime import date
from ..models import OptionLeg, GreekVector
from ..interfaces import MarketDataProvider

class LeapSelector:
    def __init__(self, provider: MarketDataProvider):
        self.provider = provider

    async def select_best_leap(self, symbol: str, target_delta: float = 0.70, min_days: int = 365, reference_date: date = None) -> Optional[OptionLeg]:
        """
        Finds the best LEAP call option.
        Criteria:
        1. Expiration > min_days
        2. Delta closest to target_delta
        """
        if reference_date is None:
            reference_date = date.today()

        expirations = await self.provider.get_expirations(symbol)
        valid_expirations = [d for d in expirations if (d - reference_date).days >= min_days]
        
        if not valid_expirations:
            return None
            
        # Pick the first valid expiration (usually the nearest one that meets criteria)
        target_exp = valid_expirations[0]
        
        chain = await self.provider.get_option_chain(symbol, target_exp)
        calls = [opt for opt in chain if opt.option_type == "call"]
        
        if not calls:
            return None
            
        # Find closest delta
        best_leap = min(calls, key=lambda x: abs(x.greeks.delta - target_delta))
        
        # Ensure it's a "Buy" leg
        best_leap.action = "buy"
        best_leap.quantity = 1
        
        return best_leap
