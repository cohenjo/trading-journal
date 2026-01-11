import asyncio
import logging
from datetime import date
import sys
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent))

from app.services.data_ingestion import MarketDataSync
from app.services.ib_connection import ib_manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def main():
    sync = MarketDataSync()
    
    # Connect to IBKR
    # Ensure IB Gateway/TWS is running!
    try:
        await sync.connect()
    except Exception as e:
        logger.error(f"Could not connect to IBKR: {e}")
        return

    # Define Sync Parameters
    symbol = "NDX"
    start_date = date(2018, 1, 1)
    end_date = date.today()
    
    try:
        await sync.sync_historical_data(symbol, start_date, end_date)
    except Exception as e:
        logger.error(f"Sync failed: {e}")
    finally:
        ib_manager.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
