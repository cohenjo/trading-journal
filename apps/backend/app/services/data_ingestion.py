import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import List, Optional
from dateutil.relativedelta import relativedelta

from ib_async import IB, Contract, BarDataList
from sqlmodel import Session, select

from app.dal.database import engine
from app.schema.backtest_models import OptionContract, HistoricalOptionBar
from app.schema.models import DailyBar
from app.services.ib_connection import ib_manager

logger = logging.getLogger(__name__)

class MarketDataSync:
    def __init__(self):
        self.ib: Optional[IB] = None

    async def connect(self):
        self.ib = await ib_manager.get_ib()

    async def sync_historical_data(self, symbol: str, start_date: date, end_date: date):
        """
        Main entry point to sync data for a symbol and its option chain.
        """
        logger.info(f"Attempting to connect to IB for sync of {symbol}...")
        if not self.ib:
            await self.connect()
        logger.info(f"Connected. Starting sync for {symbol} from {start_date} to {end_date}")
        
        # 1. Sync Underlying History (NDX)
        try:
            await self.sync_underlying_history(symbol, start_date, end_date)
        except Exception as e:
            logger.error(f"Failed to sync underlying history for {symbol}: {e}")
            raise

        # 2. Sync Volatility Index History (VXN for NDX, VIX for SPX)
        vol_symbol = 'VXN' if symbol == 'NDX' else 'VIX'
        try:
            await self.sync_underlying_history(vol_symbol, start_date, end_date)
        except Exception as e:
            logger.error(f"Failed to sync volatility history for {vol_symbol}: {e}")
            # Don't fail hard on volatility sync failure?
            # raise 
        
        # 3. Skip Option Chain Sync (Using Synthetic Data)
        # await self.sync_contract_definitions(symbol, start_date, end_date, spot_prices)
        # await self.sync_option_bars(symbol, start_date, end_date, spot_prices)
            
        logger.info("Sync complete")

    async def sync_underlying_history(self, symbol: str, start_date: date, end_date: date) -> dict[date, float]:
        """
        Fetches daily history for the underlying.
        Returns a dict of {date: close_price} for filtering strikes.
        """
        logger.info(f"Fetching underlying history for {symbol}")
        
        # Determine exchange and secType
        if symbol in ['NDX', 'SPX', 'VIX', 'VXN']:
            sec_type = 'IND'
            # VIX/VXN are on CBOE usually
            exchange = 'CBOE' if symbol in ['VIX', 'VXN'] else 'NASDAQ' # NDX on NASDAQ
            if symbol == 'SPX': exchange = 'CBOE'
        else:
            sec_type = 'STK'
            exchange = 'SMART'

        contract = Contract(symbol=symbol, secType=sec_type, exchange=exchange, currency='USD')
        
        # Resolve contract first to get conId
        try:
            details = await self.ib.reqContractDetailsAsync(contract)
            if details:
                contract = details[0].contract
                logger.info(f"Resolved underlying contract: {contract}")
        except Exception as e:
            logger.warning(f"Could not resolve underlying contract details: {e}")
            # Continue with original contract object if resolution fails
        
        # IBKR reqHistoricalData logic
        # Loop in chunks of 365 days to avoid duration limits
        
        spot_map = {}
        
        curr_end = end_date
        while curr_end > start_date:
            # Calculate duration to cover up to 1 year or until start_date
            days_needed = (curr_end - start_date).days + 1
            days_to_fetch = min(days_needed, 365)
            
            # Use UTC format to avoid timezone issues: yyyymmdd-hh:mm:ss
            end_str = curr_end.strftime("%Y%m%d-23:59:59")
            duration_str = f"{days_to_fetch} D"
            
            logger.info(f"Requesting historical data for {symbol} ending {end_str} duration {duration_str}")

            try:
                bars = await self.ib.reqHistoricalDataAsync(
                    contract,
                    endDateTime=end_str,
                    durationStr=duration_str,
                    barSizeSetting='1 day',
                    whatToShow='TRADES',
                    useRTH=True
                )
                
                new_bars = []
                if bars:
                    with Session(engine) as session:
                        for bar in bars:
                            d = bar.date  # datetime.date
                            spot_map[d] = bar.close
                            
                            # Save to DailyBar
                            # Check if exists
                            existing = session.get(DailyBar, (symbol, d))
                            if not existing:
                                new_bars.append(DailyBar(
                                    symbol=symbol,
                                    date=d,
                                    open=bar.open,
                                    high=bar.high,
                                    low=bar.low,
                                    close=bar.close,
                                    volume=bar.volume
                                ))
                        
                        if new_bars:
                            session.add_all(new_bars)
                            session.commit()
                            logger.info(f"Saved {len(new_bars)} daily bars for {symbol}")
            except Exception as e:
                logger.error(f"Error fetching chunk ending {end_str}: {e}")
            
            # Move back
            curr_end = curr_end - timedelta(days=days_to_fetch)
            
            # Pacing
            await asyncio.sleep(1)
        
        logger.info(f"Fetched {len(spot_map)} daily bars for {symbol}")
        return spot_map

    async def sync_contract_definitions(self, symbol: str, start_date: date, end_date: date, spot_prices: dict[date, float]):
        """
        Discover option contracts that existed during the period.
        Strategy: Iterate months, fetch all contracts, filter by strike vs spot range.
        """
        logger.info("Syncing contract definitions...")
        
        # Generate list of months to check
        current = start_date.replace(day=1)
        months = []
        while current <= end_date:
            months.append(current)
            current += relativedelta(months=1)
            
        # Also include LEAP expirations (e.g. next Jan) relative to the window
        # For simplicity, let's just scan all months in range + 1 year out?
        # Or just rely on the fact that we trade specific expirations.
        # Let's scan the range [start_date, end_date + 1 year] to cover LEAPs opened during the period.
        scan_end = end_date + relativedelta(years=1)
        current = end_date.replace(day=1) + relativedelta(months=1)
        while current <= scan_end:
            months.append(current)
            current += relativedelta(months=1)

        unique_months = sorted(list(set([m.strftime("%Y%m") for m in months])))
        
        for month_str in unique_months:
            logger.info(f"Scanning contracts for expiration {month_str}")
            
            # Define search contract
            # For NDX, we want the main index options.
            # Try SMART first, then specific exchanges
            contract = Contract(symbol=symbol, secType='OPT', lastTradeDateOrContractMonth=month_str, currency='USD', includeExpired=True, exchange='SMART')
            if symbol == 'NDX':
                contract.tradingClass = 'NDX'
            
            try:
                details_list = await self.ib.reqContractDetailsAsync(contract)
            except Exception as e:
                logger.warning(f"Failed to fetch details for {month_str} on SMART: {e}")
                # Try CBOE
                contract.exchange = 'CBOE'
                try:
                    details_list = await self.ib.reqContractDetailsAsync(contract)
                except Exception as e2:
                    logger.warning(f"Failed to fetch details for {month_str} on CBOE: {e2}")
                    # Try NASDAQ
                    contract.exchange = 'NASDAQ'
                    try:
                        details_list = await self.ib.reqContractDetailsAsync(contract)
                    except Exception as e3:
                        logger.error(f"Failed to fetch details for {month_str} on NASDAQ: {e3}")
                        continue
                
            logger.info(f"Found {len(details_list)} contracts for {month_str}")
            
            # Filter and Save
            new_contracts = []
            with Session(engine) as session:
                for d in details_list:
                    c = d.contract
                    
                    # Filter by Strike
                    # We need a reference spot price. 
                    # Use the spot price from the *start* of the month (or closest available)
                    # to determine if this strike was ever "relevant".
                    # This is imperfect. A better way:
                    # Save ALL contracts? NDX chain is huge.
                    # Filter: Strike within 50% of 15000 (7500 - 22500).
                    # NDX is ~18000 now. 
                    # Let's use a wide static range for now, or dynamic based on spot_prices.
                    
                    # Dynamic Filter:
                    # Find max and min spot price in our history
                    if not spot_prices:
                        # Fallback
                        min_spot, max_spot = 10000, 25000
                    else:
                        min_spot = min(spot_prices.values())
                        max_spot = max(spot_prices.values())
                    
                    # Buffer
                    lower_bound = min_spot * 0.5
                    upper_bound = max_spot * 1.5
                    
                    if not (lower_bound <= c.strike <= upper_bound):
                        continue
                        
                    # Check if exists
                    existing = session.get(OptionContract, c.conId)
                    if not existing:
                        # Parse expiration
                        # lastTradeDateOrContractMonth is 'YYYYMMDD'
                        try:
                            exp_date = datetime.strptime(c.lastTradeDateOrContractMonth, "%Y%m%d").date()
                        except ValueError:
                            continue

                        new_contracts.append(OptionContract(
                            conid=c.conId,
                            symbol=symbol,
                            expiration=exp_date,
                            strike=c.strike,
                            right=c.right,
                            multiplier=c.multiplier
                        ))
                
                if new_contracts:
                    session.add_all(new_contracts)
                    session.commit()
                    logger.info(f"Saved {len(new_contracts)} new contracts for {month_str}")

    async def sync_option_bars(self, symbol: str, start_date: date, end_date: date, spot_prices: dict[date, float]):
        """
        Fetch historical bars for all known contracts in the DB.
        """
        logger.info("Syncing option bars...")
        
        with Session(engine) as session:
            # Get all contracts
            statement = select(OptionContract).where(OptionContract.symbol == symbol)
            contracts = session.exec(statement).all()
            
        logger.info(f"Processing {len(contracts)} contracts")
        
        for i, db_contract in enumerate(contracts):
            # Check if we already have data? 
            # Or just overwrite/append.
            # For efficiency, check if we have data for this contract in the range.
            
            # Construct IB Contract
            contract = Contract(
                conId=db_contract.conid,
                symbol=db_contract.symbol,
                secType='OPT',
                lastTradeDateOrContractMonth=db_contract.expiration.strftime("%Y%m%d"),
                strike=db_contract.strike,
                right=db_contract.right,
                multiplier=db_contract.multiplier,
                exchange='SMART', # or CBOE
                currency='USD',
                includeExpired=True
            )
            
            await self.fetch_and_save_bars(contract, start_date, end_date, spot_prices)
            
            if i % 10 == 0:
                logger.info(f"Processed {i}/{len(contracts)} contracts")
                await asyncio.sleep(0.1) # Pacing

    async def fetch_and_save_bars(self, contract: Contract, start_date: date, end_date: date, spot_prices: dict[date, float]):
        end_str = end_date.strftime("%Y%m%d 23:59:59 US/Eastern")
        duration_days = (end_date - start_date).days + 1
        # Cap duration? IBKR limits. 
        # For daily bars, 1 year is fine.
        
        try:
            bars = await self.ib.reqHistoricalDataAsync(
                contract,
                endDateTime=end_str,
                durationStr=f"{duration_days} D",
                barSizeSetting='1 day',
                whatToShow='TRADES', # or MIDPOINT
                useRTH=True
            )
            
            if not bars:
                return

            # Also fetch Greeks? 
            # 'TRADES' gives prices. 'OPTION_IMPLIED_VOLATILITY' gives IV.
            # Getting Greeks historically is harder. 
            # Usually you get Price + IV, then calculate Greeks yourself using Black-Scholes.
            # Or use 'whatToShow'='OPTION_IMPLIED_VOLATILITY' to get IV and 'HISTORICAL_VOLATILITY'.
            # IBKR doesn't return Delta/Gamma in historical bars directly.
            # We will calculate them later in the Backtester using the stored Price + IV + Underlying Price.
            
            # We need Underlying Price for each bar date to store in the DB row (for convenience).
            # We can query it from our previously fetched spot_map (passed in or queried).
            # For now, let's just save the bar.
            
            with Session(engine) as session:
                new_bars = []
                for bar in bars:
                    # Check existence
                    # (Optimization: Load existing dates for this conid first)
                    
                    # For now, simple insert (might fail on unique constraint if we don't check)
                    # Let's assume we are filling gaps or use merge.
                    
                    # We need underlying price. 
                    # Let's fetch it from DB or pass it. 
                    # For now, 0.0. We can backfill it.
                    
                    # Convert bar.date (date) to datetime
                    dt = datetime.combine(bar.date, datetime.min.time())
                    
                    existing = session.exec(
                        select(HistoricalOptionBar)
                        .where(HistoricalOptionBar.conid == contract.conId)
                        .where(HistoricalOptionBar.date == dt)
                    ).first()
                    
                    if existing:
                        continue
                        
                    # Get underlying price from map
                    u_price = spot_prices.get(bar.date, 0.0)
                        
                    new_bars.append(HistoricalOptionBar(
                        conid=contract.conId,
                        date=dt,
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                        volume=bar.volume,
                        underlying_price=u_price
                    ))
                
                if new_bars:
                    session.add_all(new_bars)
                    session.commit()
                    
        except Exception as e:
            logger.error(f"Error fetching bars for {contract.conId}: {e}")
