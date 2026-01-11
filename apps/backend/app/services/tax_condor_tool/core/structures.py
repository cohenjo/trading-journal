from typing import List
from datetime import date
from ..models import OptionLeg, IronCondorStructure, GreekVector, PnLSimulation
from ..core.pricer import BlackScholesPricer

class StructureFactory:
    @staticmethod
    def create_iron_condor(
        short_call: OptionLeg,
        long_call: OptionLeg,
        short_put: OptionLeg,
        long_put: OptionLeg,
        spot_price: float = None,
        reference_date: date = None
    ) -> IronCondorStructure:
        
        if reference_date is None:
            reference_date = date.today()

        # Sum Greeks
        net_delta = (short_call.greeks.delta * short_call.quantity +
                     long_call.greeks.delta * long_call.quantity +
                     short_put.greeks.delta * short_put.quantity +
                     long_put.greeks.delta * long_put.quantity)
                     
        net_gamma = (short_call.greeks.gamma * short_call.quantity +
                     long_call.greeks.gamma * long_call.quantity +
                     short_put.greeks.gamma * short_put.quantity +
                     long_put.greeks.gamma * long_put.quantity)
                     
        net_theta = (short_call.greeks.theta * short_call.quantity +
                     long_call.greeks.theta * long_call.quantity +
                     short_put.greeks.theta * short_put.quantity +
                     long_put.greeks.theta * long_put.quantity)
                     
        net_vega = (short_call.greeks.vega * short_call.quantity +
                    long_call.greeks.vega * long_call.quantity +
                    short_put.greeks.vega * short_put.quantity +
                    long_put.greeks.vega * long_put.quantity)

        # Calculate Credit (assuming sell price is positive cash flow)
        # Short legs: sell (positive cash), Long legs: buy (negative cash)
        # Prices in OptionLeg are positive numbers.
        # Short Call: Sell @ 10 -> +10
        # Long Call: Buy @ 8 -> -8
        # Net: +2
        
        credit = (short_call.price * abs(short_call.quantity) + 
                  short_put.price * abs(short_put.quantity)) - \
                 (long_call.price * abs(long_call.quantity) + 
                  long_put.price * abs(long_put.quantity))

        # Margin (Simplified: Max width of wings * 100)
        call_width = abs(long_call.strike - short_call.strike)
        put_width = abs(short_put.strike - long_put.strike)
        margin = max(call_width, put_width) * 100

        # Calculate DTE
        dte = (short_call.expiration - reference_date).days

        # Calculate P&L Simulations
        # Simulate P&L at Expiration (T=0) as requested by user
        # This provides a clear view of the max profit/loss zones
        
        pnl_sims = []
        chart_data = []
        
        if spot_price:
            r = 0.045 # Risk free rate
            T_sim = 0.0 # At expiration
            
            # 1. Standard Scenarios (-5%, -2%, 0%, +2%, +5%)
            for pct_change in [-0.05, -0.02, 0.0, 0.02, 0.05]:
                new_spot = spot_price * (1 + pct_change)
                total_pnl = 0.0
                
                for leg in [short_call, long_call, short_put, long_put]:
                    if leg.implied_volatility is None:
                        continue
                        
                    is_call = leg.option_type == "call"
                    # Calculate theoretical price at T_sim (Expiration)
                    new_price = BlackScholesPricer.price(new_spot, leg.strike, T_sim, r, leg.implied_volatility, is_call)
                    
                    # PnL = (New Price - Old Price) * Quantity * 100
                    # Note: leg.price is the CURRENT price (cost basis)
                    leg_pnl = (new_price - leg.price) * leg.quantity * 100
                    total_pnl += leg_pnl
                
                pnl_sims.append(PnLSimulation(
                    price_change_pct=pct_change*100, 
                    underlying_price=new_spot,
                    estimated_pnl=total_pnl
                ))
                
            # 2. Chart Data (Granular range from -10% to +10%)
            # Generate 50 points
            start_pct = -0.10
            end_pct = 0.10
            steps = 50
            step_size = (end_pct - start_pct) / steps
            
            for i in range(steps + 1):
                pct_change = start_pct + (i * step_size)
                new_spot = spot_price * (1 + pct_change)
                total_pnl = 0.0
                
                for leg in [short_call, long_call, short_put, long_put]:
                    if leg.implied_volatility is None:
                        continue
                        
                    is_call = leg.option_type == "call"
                    new_price = BlackScholesPricer.price(new_spot, leg.strike, T_sim, r, leg.implied_volatility, is_call)
                    leg_pnl = (new_price - leg.price) * leg.quantity * 100
                    total_pnl += leg_pnl
                    
                chart_data.append(PnLSimulation(
                    price_change_pct=pct_change*100,
                    underlying_price=new_spot,
                    estimated_pnl=total_pnl
                ))

        return IronCondorStructure(
            short_call=short_call,
            long_call=long_call,
            short_put=short_put,
            long_put=long_put,
            net_credit=credit,
            margin_requirement=margin,
            greeks=GreekVector(delta=net_delta, gamma=net_gamma, theta=net_theta, vega=net_vega),
            days_to_expiration=dte,
            pnl_simulations=pnl_sims,
            chart_data=chart_data
        )
