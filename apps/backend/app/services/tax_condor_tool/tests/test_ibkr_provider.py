import asyncio
import sys
import os
from datetime import date, timedelta
from dotenv import load_dotenv

# Add the backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../..")))

from ib_async import IB
from app.services.tax_condor_tool.data.ibkr_provider import IBKRDataProvider

load_dotenv()

IB_HOST = os.getenv("IB_HOST", "127.0.0.1")
IB_PORT = int(os.getenv("IB_PORT", 4002)) # Using 4002 as per user request
IB_CLIENT_ID = int(os.getenv("IB_CLIENT_ID", 2))

async def test_ibkr_provider():
    ib = IB()
    try:
        print(f"Connecting to IBKR at {IB_HOST}:{IB_PORT}...")
        await ib.connectAsync(IB_HOST, IB_PORT, clientId=IB_CLIENT_ID + 1) # Use different client ID to avoid conflict
        
        # Request Delayed Data (Type 3 or 4)
        # 1=Live, 2=Frozen, 3=Delayed, 4=Delayed Frozen
        ib.reqMarketDataType(3) 
        print("Connected and set to Delayed Market Data.")

        provider = IBKRDataProvider(ib)
        symbol = "NDX"

        # 1. Test Spot Price
        print(f"\nFetching spot price for {symbol}...")
        spot = await provider.get_spot_price(symbol)
        print(f"Spot Price: {spot}")

        # 2. Test Expirations
        print(f"\nFetching expirations for {symbol}...")
        expirations = await provider.get_expirations(symbol)
        print(f"Found {len(expirations)} expirations.")
        if expirations:
            print(f"First 5: {expirations[:5]}")

        # 3. Test Option Chain
        if expirations:
            # Find an expiration ~45 days out
            target_date = date.today() + timedelta(days=45)
            # Find closest
            closest_exp = min(expirations, key=lambda d: abs((d - target_date).days))
            print(f"\nFetching option chain for {closest_exp}...")
            
            chain = await provider.get_option_chain(symbol, closest_exp)
            print(f"Received {len(chain)} option legs.")
            
            if chain:
                print("Sample Leg:")
                leg = chain[0]
                print(f"  {leg.symbol} {leg.expiration} {leg.strike} {leg.option_type}")
                print(f"  Price: {leg.price}")
                print(f"  Greeks: {leg.greeks}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        if ib.isConnected():
            ib.disconnect()
            print("\nDisconnected.")

if __name__ == "__main__":
    asyncio.run(test_ibkr_provider())
