import asyncio
import logging
import sys
import os

# Add backend to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../")))

from app.services.ib_connection import ib_manager
from app.services.tax_condor_tool.data.ibkr_provider import IBKRDataProvider
from app.services.tax_condor_tool.service import TaxCondorService

# Configure logging
    logging.basicConfig(level=logging.INFO)

async def main():
    try:
        # 1. Connect to IBKR
        logger.info("Connecting to IBKR...")
        ib = await ib_manager.get_ib()
        
        # 2. Initialize Provider
        provider = IBKRDataProvider(ib)
        
        # 3. Initialize Service
        service = TaxCondorService(provider)
        
        # 4. Get Recommendations
        symbol = "NDX"
        logger.info(f"Getting recommendations for {symbol}...")
        recommendations = await service.get_recommendation(symbol, budget=5000.0)
        
        # 5. Print Results
        if not recommendations:
            logger.warning("No recommendations found.")
        else:
            logger.info(f"Found {len(recommendations)} recommendations.")
            for i, rec in enumerate(recommendations[:3]):
                logger.info(f"\nRecommendation #{i+1}:")
                logger.info(f"  Score: {rec.score}")
                logger.info(f"  LEAP: {rec.leap.leg.symbol} {rec.leap.leg.expiration} {rec.leap.leg.strike} {rec.leap.leg.option_type}")
                logger.info(f"  IC Credit: {rec.iron_condor.net_credit:.2f}")
                logger.info(f"  IC Short Call: {rec.iron_condor.short_call.strike}")
                logger.info(f"  IC Short Put: {rec.iron_condor.short_put.strike}")
                
    except Exception as e:
        logger.error(f"An error occurred: {e}", exc_info=True)
    finally:
        ib_manager.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
