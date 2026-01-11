from datetime import date
from typing import List
from app.services.tax_condor_tool.interfaces import MarketDataProvider
from app.services.tax_condor_tool.models import OptionLeg, GreekVector
from app.services.backtester.data_provider import SyntheticDataProvider

class BacktestMarketDataProvider(MarketDataProvider):
    def __init__(self, synthetic_provider: SyntheticDataProvider, current_date: date):
        self.synthetic = synthetic_provider
        self.current_date = current_date

    async def get_spot_price(self, symbol: str) -> float:
        return self.synthetic.get_spot_price(symbol, self.current_date)

    async def get_volatility(self, symbol: str, days: int = 30) -> float:
        return self.synthetic.get_volatility(symbol, self.current_date)

    async def get_expirations(self, symbol: str) -> List[date]:
        return self.synthetic.get_expirations(symbol, self.current_date)

    async def get_option_chain(self, symbol: str, expiration: date, limit: int = 200) -> List[OptionLeg]:
        chain = self.synthetic.get_option_chain(symbol, self.current_date, expiration=expiration)
        legs = []
        
        for c in chain.contracts.values():
            # Convert to OptionLeg
            greeks = GreekVector(
                delta=c['greeks']['delta'],
                gamma=c['greeks']['gamma'],
                theta=c['greeks']['theta'],
                vega=c['greeks']['vega']
            )
            
            leg = OptionLeg(
                symbol=symbol,
                strike=c['strike'],
                expiration=c['expiration'],
                option_type="call" if c['right'] == 'C' else "put",
                action="buy", # Default, will be set by generator
                quantity=1,
                greeks=greeks,
                price=c['price'],
                mid=c['price'],
                implied_volatility=c['greeks']['implied_vol'],
                conid=c['conid']
            )
            legs.append(leg)
            
        return legs
