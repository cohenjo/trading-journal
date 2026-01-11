from typing import List
import logging
from datetime import date
from ..models import TaxCondorRecommendation, LeapRecommendation, IronCondorStructure, PnLSimulation
from ..core.pricer import BlackScholesPricer

logger = logging.getLogger(__name__)

class Validator:
    def __init__(self, alpha: float = 0.25, beta: float = 0.6):
        self.alpha = alpha
        self.beta = beta

    def rank_and_validate(
        self, 
        leap: LeapRecommendation, 
        ics: List[IronCondorStructure], 
        budget: float,
        spot_price: float = None,
        reference_date: date = None
    ) -> List[TaxCondorRecommendation]:
        
        if reference_date is None:
            reference_date = date.today()

        valid_recs = []
        
        leap_theta = leap.leg.greeks.theta
        logger.info(f"Validating {len(ics)} ICs against LEAP theta: {leap_theta}")
        
        for ic in ics:
            # 1. Theta Coverage
            # IC Theta (positive) should cover LEAP Theta (negative)
            # We assume 1 IC per 1 LEAP for simplicity in this MVP, 
            # but usually it's N_IC per LEAP. Let's assume N=1 for now.
            
            # Note: LEAP theta is negative (decay). IC theta is positive (decay works for us).
            # We want IC_Theta >= abs(LEAP_Theta)
            # Relaxed to 0.0 due to steep NDX skew causing low/negative theta on OTM spreads
            
            theta_coverage = ic.greeks.theta / abs(leap_theta) if leap_theta != 0 else 0
            
            if theta_coverage < 0.0:
                logger.debug(f"Rejected IC (Theta): IC Theta {ic.greeks.theta:.2f} < 0 (Negative Theta)")
                continue # Skip if negative theta
                
            # 2. Loss Budget (Simplified)
            # Max loss of IC shouldn't exceed monthly budget
            # Max loss for IC = Width - Credit
            # (This is a rough check, real check is scenario based)
            max_loss = (ic.margin_requirement / 100) - ic.net_credit
            if max_loss > budget:
                logger.debug(f"Rejected IC (Budget): Max Loss {max_loss:.2f} > Budget {budget:.2f}")
                continue
                
            # Scoring
            # Higher theta coverage is good, but too high means too much risk.
            # Higher credit is good.
            # Portfolio Delta Neutrality: We want LEAP + IC Delta ~ 0
            portfolio_delta = leap.leg.greeks.delta + ic.greeks.delta
            delta_penalty = abs(portfolio_delta) * 50 # Penalize delta deviation
            
            score = (theta_coverage * 10) + ic.net_credit - delta_penalty
            
            # Calculate Portfolio PnL (LEAP + IC)
            portfolio_sims = []
            portfolio_chart_data = []
            
            if spot_price:
                days_elapsed = ic.days_to_expiration
                leap_dte_at_sim = (leap.leg.expiration - reference_date).days - days_elapsed
                T_leap_sim = max(0, leap_dte_at_sim / 365.0)
                r = 0.045
                
                # 1. Standard Scenarios
                if ic.pnl_simulations:
                    for sim in ic.pnl_simulations:
                        pct_change = sim.price_change_pct / 100.0
                        new_spot = spot_price * (1 + pct_change)
                        
                        # Price LEAP at new spot and new time
                        is_call = leap.leg.option_type == "call"
                        vol = leap.leg.implied_volatility or 0.20
                        
                        new_leap_price = BlackScholesPricer.price(
                            new_spot, 
                            leap.leg.strike, 
                            T_leap_sim, 
                            r, 
                            vol, 
                            is_call
                        )
                        
                        leap_pnl = (new_leap_price - leap.leg.price) * leap.leg.quantity * 100
                        
                        combined_pnl = sim.estimated_pnl + leap_pnl
                        portfolio_sims.append(PnLSimulation(
                            price_change_pct=sim.price_change_pct,
                            underlying_price=new_spot,
                            estimated_pnl=combined_pnl
                        ))
                
                # 2. Chart Data
                if ic.chart_data:
                    for sim in ic.chart_data:
                        pct_change = sim.price_change_pct / 100.0
                        new_spot = spot_price * (1 + pct_change)
                        
                        is_call = leap.leg.option_type == "call"
                        vol = leap.leg.implied_volatility or 0.20
                        
                        new_leap_price = BlackScholesPricer.price(
                            new_spot, 
                            leap.leg.strike, 
                            T_leap_sim, 
                            r, 
                            vol, 
                            is_call
                        )
                        
                        leap_pnl = (new_leap_price - leap.leg.price) * leap.leg.quantity * 100
                        combined_pnl = sim.estimated_pnl + leap_pnl
                        
                        portfolio_chart_data.append(PnLSimulation(
                            price_change_pct=sim.price_change_pct,
                            underlying_price=new_spot,
                            estimated_pnl=combined_pnl
                        ))

            rec = TaxCondorRecommendation(
                leap=leap,
                iron_condor=ic,
                score=score,
                analysis={
                    "theta_coverage": theta_coverage,
                    "max_loss": max_loss,
                    "net_credit": ic.net_credit,
                    "portfolio_delta": portfolio_delta
                },
                portfolio_pnl_simulations=portfolio_sims,
                portfolio_chart_data=portfolio_chart_data
            )
            valid_recs.append(rec)
            
        # Sort by score descending
        valid_recs.sort(key=lambda x: x.score, reverse=True)
        
        return valid_recs
