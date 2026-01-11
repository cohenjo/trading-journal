# Backtester Module

This module implements a backtesting engine for the Tax Condor strategy.

## Components

*   **`engine.py`**: The main simulation loop. It iterates through historical dates, updates portfolio values, runs the strategy, and executes trades.
*   **`portfolio.py`**: Tracks cash, open positions, and PnL. Handles trade execution logic (FIFO, average cost).
*   **`strategy.py`**: Abstract base class for strategies. `TaxCondorStrategy` implements the specific logic for LEAP + Iron Condor.

## Usage

```python
from datetime import date
from app.services.backtester.engine import BacktestEngine
from app.services.backtester.strategy import TaxCondorStrategy

start = date(2024, 1, 1)
end = date(2024, 12, 31)
strategy = TaxCondorStrategy(symbol="NDX", budget=50000)
engine = BacktestEngine(strategy, start, end)

engine.run()
```

## Data Requirement

The backtester relies on `HistoricalOptionBar` data in the PostgreSQL database.
Run `apps/backend/scripts/run_backtest_sync.py` to populate the database from IBKR before running the backtest.

## Current Limitations

*   **IBKR Historical Data**: Fetching expired option contracts via IBKR API (`reqContractDetails`) is currently failing with "No security definition". This requires a specific "Historical Data" subscription or a different method to resolve expired contract IDs.
