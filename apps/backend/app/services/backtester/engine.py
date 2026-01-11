import logging
from datetime import date, datetime, timedelta
from typing import List
from sqlmodel import Session, select

from app.dal.database import engine as db_engine
from app.schema.backtest_models import HistoricalOptionBar, BacktestRun, BacktestTrade
from .portfolio import Portfolio
from .strategy import Strategy
from .data_provider import SyntheticDataProvider
from app.services.tax_condor_tool.core.pricer import BlackScholesPricer
from opentelemetry import trace

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

class BacktestEngine:
    def __init__(self, strategy: Strategy, start_date: date, end_date: date, initial_capital: float = 100000.0, data_provider=None, step_days: int = 1):
        self.strategy = strategy
        self.start_date = start_date
        self.end_date = end_date
        self.portfolio = Portfolio(initial_capital)
        self.data_provider = data_provider or SyntheticDataProvider()
        self.daily_stats = []
        self.step_days = step_days

    async def run(self):
        with tracer.start_as_current_span("backtest_run") as span:
            span.set_attribute("backtest.start_date", str(self.start_date))
            span.set_attribute("backtest.end_date", str(self.end_date))
            span.set_attribute("backtest.step_days", self.step_days)
            
            logger.info(f"Starting backtest from {self.start_date} to {self.end_date} with step {self.step_days} days")
            
            current_date = self.start_date
            while current_date <= self.end_date:
                with tracer.start_as_current_span("process_day") as day_span:
                    day_span.set_attribute("backtest.current_date", str(current_date))
                    
                    # Skip weekends if step is 1 (if step > 1, we might land on weekend, so we should adjust)
                    if self.step_days == 1 and current_date.weekday() >= 5:
                        current_date += timedelta(days=1)
                        continue
                    
                    # If step > 1 and we land on weekend, move to Monday
                    if current_date.weekday() >= 5:
                        current_date += timedelta(days=(7 - current_date.weekday()))
                        if current_date > self.end_date:
                            break

                    dt = datetime.combine(current_date, datetime.min.time()) # Use EOD or specific time
                    
                    # 1. Update Portfolio Market Value (Mark to Market)
                    with tracer.start_as_current_span("update_market_values"):
                        self.update_market_values(dt)
                    
                    # 2. Run Strategy
                    with tracer.start_as_current_span("strategy_on_bar"):
                        orders = await self.strategy.on_bar(dt, self.portfolio, self.data_provider)
                    
                    # 3. Execute Orders
                    with tracer.start_as_current_span("execute_orders") as order_span:
                        order_span.set_attribute("backtest.order_count", len(orders))
                        for order in orders:
                            try:
                                self.portfolio.add_trade(
                                    date=dt,
                                    conid=order['conid'],
                                    symbol=order.get('symbol', 'UNK'),
                                    action=order['action'],
                                    quantity=order['quantity'],
                                    price=order['price'],
                                    commission=order.get('commission', 1.0), # Default comm
                                    expiration=order.get('expiration'),
                                    strike=order.get('strike'),
                                    right=order.get('right')
                                )
                            except Exception as e:
                                logger.error(f"Failed to add trade: {order} - {e}")
                                raise e
                    
                    # 4. Record Daily Stats
                    self.daily_stats.append({
                        "date": dt,
                        "equity": self.portfolio.total_equity,
                        "realized_pnl": self.portfolio.realized_pnl,
                        "unrealized_pnl": self.portfolio.total_unrealized_pnl,
                        "cash": self.portfolio.cash
                    })
                    
                    current_date += timedelta(days=self.step_days)
                
            self.save_results()
            logger.info("Backtest complete")

    def update_market_values(self, date: datetime):
        # Update prices using Synthetic Data (Black-Scholes)
        spot_cache = {}
        vol_cache = {}
        
        for conid, pos in self.portfolio.positions.items():
            symbol = pos.symbol
            if symbol not in spot_cache:
                spot_cache[symbol] = self.data_provider.get_spot_price(symbol, date.date())
                vol_cache[symbol] = self.data_provider.get_volatility(symbol, date.date())
            
            S = spot_cache[symbol]
            sigma = vol_cache[symbol]
            
            if S == 0: continue # No data
            
            # Calculate Price
            if not pos.expiration:
                continue
                
            T = (pos.expiration - date.date()).days / 365.0
            
            # Handle Expiration
            if T <= 0:
                # Intrinsic Value
                if pos.right == 'C':
                    price = max(0, S - pos.strike)
                else:
                    price = max(0, pos.strike - S)
            else:
                r = 0.05 # Risk Free Rate
                is_call = (pos.right == 'C')
                price = BlackScholesPricer.price(S, pos.strike, T, r, sigma, is_call)
            
            self.portfolio.update_price(conid, price)

    def save_results(self):
        with Session(db_engine) as session:
            run = BacktestRun(
                start_date=self.start_date,
                end_date=self.end_date,
                initial_capital=self.portfolio.initial_capital,
                parameters="{}", # TODO
                final_equity=self.portfolio.total_equity,
                total_realized_pnl=self.portfolio.realized_pnl,
                total_unrealized_pnl=self.portfolio.total_unrealized_pnl
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            
            for trade in self.portfolio.trade_log:
                t = BacktestTrade(
                    run_id=run.id,
                    date=trade['date'],
                    action=trade['action'],
                    conid=trade['conid'],
                    quantity=trade['quantity'],
                    price=trade['price'],
                    commission=trade['commission'],
                    notes=f"Equity: {trade['equity']}"
                )
                session.add(t)
            session.commit()
