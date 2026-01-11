import asyncio
from ib_async import IB
from app.services.tax_condor_tool.core.pricer import BlackScholesPricer
from app.services.tax_condor_tool.data.ibkr_provider import IBKRDataProvider
import logging
from datetime import date

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_pricing():
    ib = IB()
    try:
        await ib.connectAsync('127.0.0.1', 4002, 999) # Use a different client ID
        ib.reqMarketDataType(3) # Enable delayed data
        provider = IBKRDataProvider(ib)
        
        symbol = "SPY"
        spot = await provider.get_spot_price(symbol)
        print(f"Spot: {spot}")
        
        # Get expirations
        expirations = await provider.get_expirations(symbol)
        if not expirations:
            print("No expirations found")
            return

        target_exp = expirations[2] # Pick one a few weeks out
        print(f"Expiration: {target_exp}")
        
        # Get chain
        # Limit to 10 to reduce runtime as requested
        chain = await provider.get_option_chain(symbol, target_exp, limit=10)
        
        # Pick a few strikes around ATM
        atm_options = [opt for opt in chain if abs(opt.strike - spot) < 5]
        
        print(f"{'Type':<5} {'Strike':<8} {'Mkt Price':<10} {'IV':<8} {'Theo Price':<10} {'Diff':<10}")
        print("-" * 60)
        
        r = 0.045 # Risk free rate
        dte = (target_exp - date.today()).days
        T = dte / 365.0
        
        for opt in atm_options[:10]:
            is_call = opt.option_type == "call"
            if opt.implied_volatility is None:
                continue
                
            theo_price = BlackScholesPricer.price(
                S=spot,
                K=opt.strike,
                T=T,
                r=r,
                sigma=opt.implied_volatility,
                is_call=is_call
            )
            
            diff = theo_price - opt.price
            print(f"{opt.option_type:<5} {opt.strike:<8} {opt.price:<10.2f} {opt.implied_volatility:<8.2f} {theo_price:<10.2f} {diff:<10.2f}")

    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        ib.disconnect()

if __name__ == "__main__":
    asyncio.run(test_pricing())
