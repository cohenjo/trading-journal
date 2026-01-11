import logging
from datetime import date, datetime
from typing import List, Dict, Any
from sqlmodel import Session, select, func

from app.dal.database import engine as db_engine
from app.schema.models import DailyBar
from app.schema.backtest_models import BacktestRun, BacktestTrade
from app.services.data_ingestion import MarketDataSync
from app.services.backtester.engine import BacktestEngine
from app.services.backtester.strategy import TaxCondorStrategy
from app.services.backtester.analyzer import PerformanceAnalyzer

logger = logging.getLogger(__name__)

class BacktestService:
    def __init__(self):
        self.sync_service = MarketDataSync()

    def _get_volatility_symbol(self, symbol: str) -> str:
        if symbol in ["NDX", "QQQ"]:
            return "VXN"
        elif symbol in ["SPX", "SPY"]:
            return "VIX"
        return "VIX" # Default

    async def ensure_data_for_year(self, year: int, symbol: str = "NDX"):
        """
        Checks if we have data for the given year. If not, triggers sync.
        """
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        
        # Check DB coverage
        with Session(db_engine) as session:
            # Count bars for symbol
            statement = select(func.count()).select_from(DailyBar).where(
                DailyBar.symbol == symbol,
                DailyBar.date >= start_date,
                DailyBar.date <= end_date
            )
            count = session.exec(statement).one()
            
            # Also check Volatility symbol
            vol_symbol = self._get_volatility_symbol(symbol)
            statement_vol = select(func.count()).select_from(DailyBar).where(
                DailyBar.symbol == vol_symbol,
                DailyBar.date >= start_date,
                DailyBar.date <= end_date
            )
            count_vol = session.exec(statement_vol).one()

        # Rough check: A year has ~252 trading days. 
        # If we have less than 200, we probably need to sync.
        # Or if it's the current year, we might need to sync up to today.
        
        current_year = date.today().year
        expected_min = 200
        if year == current_year:
            # If current year, we expect roughly (today - start) * 5/7 days
            days_passed = (date.today() - start_date).days
            expected_min = int(days_passed * 0.6) # Conservative

        if count < expected_min or count_vol < expected_min:
            logger.info(f"Data missing for {year} (NDX: {count}, VXN: {count_vol}). Syncing...")
            # Cap end_date at today if it's current year
            sync_end = min(end_date, date.today())
            try:
                logger.info(f"Calling sync_historical_data for {symbol}...")
                await self.sync_service.sync_historical_data(symbol, start_date, sync_end)
                logger.info(f"Successfully synced data for {symbol}")
            except Exception as e:
                logger.error(f"Failed to sync data for {symbol}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                raise Exception(f"Failed to fetch historical data for {symbol}. Please ensure IB Gateway is running and connected. Error: {str(e)}")
        else:
            logger.info(f"Data exists for {year} (NDX: {count}, VXN: {count_vol}). Skipping sync.")

    async def run_backtest(self, year: int, initial_capital: float = 100000.0, step_days: int = 1, underlying: str = "NDX", leap_underlying: str = "NDX", strategy_name: str = "IRON_CONDOR") -> Dict[str, Any]:
        symbol = underlying
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        
        # Cap end date if current year
        if year == date.today().year:
            end_date = date.today()

        # 1. Ensure Data for both symbols
        await self.ensure_data_for_year(year, symbol)
        if leap_underlying != symbol:
            await self.ensure_data_for_year(year, leap_underlying)

        # 2. Run Backtest
        if strategy_name == "IRON_CONDOR":
            strategy = TaxCondorStrategy(symbol, leap_underlying, initial_capital)
        else:
            # Default or raise error
            strategy = TaxCondorStrategy(symbol, leap_underlying, initial_capital)

        engine = BacktestEngine(strategy, start_date, end_date, initial_capital, step_days=step_days)
        await engine.run()

        # 3. Format Results
        # Analyze Performance
        metrics = PerformanceAnalyzer.analyze(engine.daily_stats, initial_capital)
        
        results = {
            "year": year,
            "initial_capital": initial_capital,
            "final_equity": engine.portfolio.total_equity,
            "realized_pnl": engine.portfolio.realized_pnl,
            "unrealized_pnl": engine.portfolio.total_unrealized_pnl,
            "trades": engine.portfolio.trade_log,
            "metrics": metrics
        }
        
        return results
