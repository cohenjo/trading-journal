import sys
from pathlib import Path
from datetime import date
import logging

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent))

from app.services.backtester.engine import BacktestEngine
from app.services.backtester.strategy import TaxCondorStrategy

# Configure logging
logging.basicConfig(level=logging.INFO)

def main():
    # Define Backtest Parameters
    symbol = "NDX"
    start_date = date(2018, 1, 1)
    end_date = date.today()
    initial_capital = 100000.0
    
    # Initialize Strategy
    strategy = TaxCondorStrategy(symbol, initial_capital)
    
    # Initialize Engine
    engine = BacktestEngine(strategy, start_date, end_date, initial_capital)
    
    # Run Backtest
    engine.run()
    
    # Print Results
    print(f"Final Equity: {engine.portfolio.total_equity}")
    print(f"Realized PnL: {engine.portfolio.realized_pnl}")
    print(f"Unrealized PnL: {engine.portfolio.total_unrealized_pnl}")
    print("Trade Log:")
    for trade in engine.portfolio.trade_log:
        print(trade)

if __name__ == "__main__":
    main()
