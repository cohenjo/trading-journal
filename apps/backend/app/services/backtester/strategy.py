from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Optional
from .portfolio import Portfolio
from .adapters import BacktestMarketDataProvider
from app.services.tax_condor_tool.logic.ic_generator import ICCandidateGenerator
from app.services.tax_condor_tool.logic.leap_selector import LeapSelector
from app.services.tax_condor_tool.logic.validator import Validator
from app.services.tax_condor_tool.models import LeapRecommendation, OptionLeg, GreekVector

class Strategy(ABC):
    @abstractmethod
    async def on_bar(self, date: datetime, portfolio: Portfolio, data_provider) -> List[dict]:
        """
        Called on every time step. Returns a list of orders to execute.
        """
        pass

class TaxCondorStrategy(Strategy):
    def __init__(self, symbol: str, leap_symbol: str, budget: float):
        self.symbol = symbol # For IC
        self.leap_symbol = leap_symbol # For LEAP
        self.budget = budget
        self.leap_conid: Optional[int] = None
        self.current_ic_legs: List[int] = [] # List of conids

    async def on_bar(self, date: datetime, portfolio: Portfolio, data_provider) -> List[dict]:
        orders = []
        
        # Determine if we need the chain
        need_chain = False
        
        # 1. Check if we need to open LEAP (January)
        if not self.leap_conid and date.month == 1:
            need_chain = True
            
        # 2. Check if we need to roll IC (Monthly, e.g. 3rd Friday)
        # Check existing legs
        legs_to_close = []
        if self.current_ic_legs:
            # Check if any leg is expired or close to expiration (e.g. < 1 day)
            active_legs = 0
            for conid in self.current_ic_legs:
                if conid in portfolio.positions:
                    pos = portfolio.positions[conid]
                    active_legs += 1
                    if pos.expiration:
                        dte = (pos.expiration - date.date()).days
                        # Close if DTE is <= 21 (Management point) or expired
                        if dte <= 21:
                            legs_to_close = self.current_ic_legs
                            break
            
            if active_legs == 0:
                # All closed/expired
                self.current_ic_legs = []
                legs_to_close = []

        if legs_to_close:
            total_pnl = 0.0
            for conid in legs_to_close:
                if conid in portfolio.positions:
                    pos = portfolio.positions[conid]
                    # Calculate PnL for this leg
                    leg_pnl = (pos.current_price - pos.avg_price) * pos.quantity * 100
                    total_pnl += leg_pnl
                    
                    # Close position
                    action = "SELL" if pos.quantity > 0 else "BUY"
                    
                    orders.append({
                        "action": action,
                        "conid": conid,
                        "symbol": self.symbol,
                        "quantity": abs(pos.quantity),
                        "price": pos.current_price,
                        "expiration": pos.expiration,
                        "strike": pos.strike,
                        "right": pos.right
                    })
            print(f"[{date.date()}] Closing IC. PnL: ${total_pnl:.2f}")
            self.current_ic_legs = []

        # 3. Open New IC if none active
        if not self.current_ic_legs:
            need_chain = True

        if not need_chain:
            return orders

        # Initialize Adapter
        adapter = BacktestMarketDataProvider(data_provider, date.date())
        
        # 1. Open LEAP Logic
        current_leap_leg = None
        
        if not self.leap_conid and date.month == 1:
            selector = LeapSelector(adapter)
            # Use LEAP Symbol
            best_leap = await selector.select_best_leap(self.leap_symbol, min_days=300, reference_date=date.date())
            
            if best_leap:
                # Use conid from best_leap if available, otherwise find in chain (optimized)
                if best_leap.conid:
                    orders.append({
                        "action": "BUY", 
                        "conid": best_leap.conid, 
                        "symbol": self.leap_symbol,
                        "quantity": 1, 
                        "price": best_leap.price,
                        "expiration": best_leap.expiration,
                        "strike": best_leap.strike,
                        "right": "C" if best_leap.option_type == "call" else "P"
                    })
                    self.leap_conid = best_leap.conid
                    current_leap_leg = best_leap
                    print(f"[{date.date()}] Opening LEAP ({self.leap_symbol}): {best_leap.expiration} Strike {best_leap.strike} Delta {best_leap.greeks.delta:.2f} Price {best_leap.price:.2f}")
                else:
                    # Fallback (should not happen with updated adapter)
                    chain = data_provider.get_option_chain(self.leap_symbol, date.date(), expiration=best_leap.expiration)
                    found = self._find_contract_in_chain(chain, best_leap)
                    
                    if found:
                        orders.append({
                            "action": "BUY", 
                            "conid": found['conid'], 
                            "symbol": self.leap_symbol,
                            "quantity": 1, 
                            "price": found['price'],
                            "expiration": found['expiration'],
                            "strike": found['strike'],
                            "right": found['right']
                        })
                        self.leap_conid = found['conid']
                        current_leap_leg = best_leap
                        print(f"[{date.date()}] Opening LEAP ({self.leap_symbol}): {best_leap.expiration} Strike {best_leap.strike} Delta {best_leap.greeks.delta:.2f} Price {best_leap.price:.2f}")
        
        elif self.leap_conid:
            # Reconstruct current LEAP leg for validation
            # We need the current price/greeks for the existing LEAP
            # We can get it from the portfolio or fetch it
            if self.leap_conid in portfolio.positions:
                pos = portfolio.positions[self.leap_conid]
                # We need greeks. Portfolio doesn't store greeks.
                # So we must fetch the contract.
                # But we know the expiration!
                chain = data_provider.get_option_chain(self.leap_symbol, date.date(), expiration=pos.expiration)
                found = chain.get_contract(self.leap_conid)
                if found:
                    current_leap_leg = self._contract_to_leg(found, self.leap_symbol)

        # 3. Open New IC Logic
        if not self.current_ic_legs and current_leap_leg:
            generator = ICCandidateGenerator(adapter)
            # Use IC Symbol
            candidates = await generator.generate(self.symbol, reference_date=date.date())
            
            if candidates:
                validator = Validator()
                leap_rec = LeapRecommendation(leg=current_leap_leg, reason="Existing")
                
                # Get spot for validation
                spot = data_provider.get_spot_price(self.symbol, date.date())
                
                recs = validator.rank_and_validate(leap_rec, candidates, self.budget, spot_price=spot, reference_date=date.date())
                
                if recs:
                    best_ic = recs[0].iron_condor
                    
                    legs_to_open = [
                        (best_ic.short_call, "SELL"),
                        (best_ic.long_call, "BUY"),
                        (best_ic.short_put, "SELL"),
                        (best_ic.long_put, "BUY")
                    ]
                    
                    new_legs = []
                    
                    # Optimization: Use conid from legs if available
                    # If not, fetch chain for specific expiration
                    
                    # Check if we have conids
                    all_have_conids = all(leg.conid for leg, _ in legs_to_open)
                    
                    if all_have_conids:
                        for leg, action in legs_to_open:
                            orders.append({
                                "action": action,
                                "conid": leg.conid,
                                "symbol": self.symbol,
                                "quantity": 1,
                                "price": leg.price,
                                "expiration": leg.expiration,
                                "strike": leg.strike,
                                "right": "C" if leg.option_type == "call" else "P"
                            })
                            new_legs.append(leg.conid)
                    else:
                        # Fallback
                        chain = data_provider.get_option_chain(self.symbol, date.date(), expiration=best_ic.short_call.expiration)
                        for leg, action in legs_to_open:
                            found = self._find_contract_in_chain(chain, leg)
                            if found:
                                orders.append(self._create_order(action, found, 1))
                                new_legs.append(found['conid'])
                            else:
                                print(f"[{date.date()}] Failed to find contract for IC leg: {leg}")
                    
                    if len(new_legs) == 4:
                        self.current_ic_legs = new_legs
                        print(f"[{date.date()}] Opening IC (Score {recs[0].score:.1f}): SP {best_ic.short_put.strike} LP {best_ic.long_put.strike} SC {best_ic.short_call.strike} LC {best_ic.long_call.strike}")
                    else:
                        # Abort if can't find all legs (shouldn't happen with synthetic)
                        orders = [o for o in orders if o['conid'] not in new_legs] # Remove partials
                        print(f"[{date.date()}] Aborted IC opening due to missing legs")

        return orders

    def _find_contract_in_chain(self, chain, leg: OptionLeg):
        for c in chain.contracts.values():
            if (c['expiration'] == leg.expiration and 
                c['strike'] == leg.strike and 
                ('C' if c['right'] == 'C' else 'P') == ('C' if leg.option_type == 'call' else 'P')):
                return c
        return None

    def _contract_to_leg(self, c, symbol: str = None) -> OptionLeg:
        greeks = GreekVector(
            delta=c['greeks']['delta'],
            gamma=c['greeks']['gamma'],
            theta=c['greeks']['theta'],
            vega=c['greeks']['vega']
        )
        return OptionLeg(
            symbol=symbol or self.symbol,
            strike=c['strike'],
            expiration=c['expiration'],
            option_type="call" if c['right'] == 'C' else "put",
            action="buy", # Placeholder
            quantity=1,
            greeks=greeks,
            price=c['price'],
            mid=c['price'],
            implied_volatility=c['greeks']['implied_vol']
        )

    def _create_order(self, action, contract, qty):
        return {
            "action": action,
            "conid": contract['conid'],
            "symbol": self.symbol,
            "quantity": qty,
            "price": contract['price'],
            "expiration": contract['expiration'],
            "strike": contract['strike'],
            "right": contract['right']
        }
