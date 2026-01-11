from typing import List
from datetime import date
from ..models import IronCondorStructure, OptionLeg
from ..core.structures import StructureFactory
from ..interfaces import MarketDataProvider

import logging

logger = logging.getLogger(__name__)

class ICCandidateGenerator:
    def __init__(self, provider: MarketDataProvider):
        self.provider = provider

    async def generate(self, symbol: str, target_days: int = 40, reference_date: date = None) -> List[IronCondorStructure]:
        """
        Generates Iron Condor candidates based on structural rules.
        """
        if reference_date is None:
            reference_date = date.today()

        spot = await self.provider.get_spot_price(symbol)
        logger.info(f"Spot price for {symbol}: {spot}")
        
        expirations = await self.provider.get_expirations(symbol)
        if not expirations:
            logger.warning(f"No expirations found for {symbol}")
            return []
            
        # Find expiration closest to target_days
        target_exp = min(expirations, key=lambda d: abs((d - reference_date).days - target_days))
        logger.info(f"Selected expiration: {target_exp}")
        
        chain = await self.provider.get_option_chain(symbol, target_exp, limit=200)
        logger.info(f"Received {len(chain)} legs from provider")
        
        calls = {opt.strike: opt for opt in chain if opt.option_type == "call"}
        puts = {opt.strike: opt for opt in chain if opt.option_type == "put"}
        
        candidates = []
        
        # Simple Grid Search (can be optimized)
        # Rules:
        # 1. Short strikes OTM
        # 2. Broken wing: Put width > Call width
        
        # Determine approximate strike step from chain
        sorted_strikes = sorted(list(calls.keys()))
        if len(sorted_strikes) > 1:
            # Find the most common difference between consecutive strikes
            diffs = [b - a for a, b in zip(sorted_strikes, sorted_strikes[1:])]
            # Use the minimum diff that is >= 1.0 to avoid noise
            valid_diffs = [d for d in diffs if d >= 1.0]
            step = min(valid_diffs) if valid_diffs else 5.0
        else:
            step = 5.0
            
        logger.info(f"Detected strike step: {step}")
        
        # Round ATM to nearest step
        atm_strike = round(spot / step) * step
        logger.info(f"ATM strike: {atm_strike}")
        
        # Define offsets as multiples of step
        # For NDX (step 25): 4 steps = 100 pts, 10 steps = 250 pts (~1%)
        # Added smaller steps (1, 2) to find positive theta in steep skew
        short_offsets_steps = [1, 2, 4, 8, 12, 16] 
        width_steps = [1, 2, 4] # 1x, 2x, 4x step width
        
        for sco_step in short_offsets_steps:
            for spo_step in short_offsets_steps:
                sc_strike = atm_strike + (sco_step * step)
                sp_strike = atm_strike - (spo_step * step)
                
                if sc_strike not in calls:
                    # logger.debug(f"Short call strike {sc_strike} not found")
                    continue
                if sp_strike not in puts:
                    # logger.debug(f"Short put strike {sp_strike} not found")
                    continue
                    
                for cw_step in width_steps:
                    lc_strike = sc_strike + (cw_step * step)
                    if lc_strike not in calls:
                        continue
                        
                    for pw_step in width_steps:
                        # Allow asymmetric wings (broken wing butterfly/condor)
                        # Specifically, we often want Put Width > Call Width for downside protection
                        lp_strike = sp_strike - (pw_step * step)
                        if lp_strike not in puts:
                            continue
                            
                        # Create Structure
                        # Short Call (-1)
                        sc = calls[sc_strike].model_copy()
                        sc.action = "sell"
                        sc.quantity = -1
                        
                        # Long Call (+1)
                        lc = calls[lc_strike].model_copy()
                        lc.action = "buy"
                        lc.quantity = 1
                        
                        # Short Put (-1)
                        sp = puts[sp_strike].model_copy()
                        sp.action = "sell"
                        sp.quantity = -1
                        
                        # Long Put (+1)
                        lp = puts[lp_strike].model_copy()
                        lp.action = "buy"
                        lp.quantity = 1
                        
                        ic = StructureFactory.create_iron_condor(sc, lc, sp, lp, spot_price=spot, reference_date=reference_date)
                        candidates.append(ic)
        
        logger.info(f"Generated {len(candidates)} candidates")
        return candidates
