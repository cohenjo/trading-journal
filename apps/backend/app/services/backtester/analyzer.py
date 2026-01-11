import pandas as pd
import numpy as np
from typing import List, Dict, Any

class PerformanceAnalyzer:
    @staticmethod
    def analyze(daily_stats: List[Dict[str, Any]], initial_capital: float) -> Dict[str, Any]:
        if not daily_stats:
            return {}
            
        df = pd.DataFrame(daily_stats)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        
        # Calculate Returns
        df['daily_return'] = df['equity'].pct_change().fillna(0)
        
        # Total Return
        final_equity = df['equity'].iloc[-1]
        total_return = (final_equity - initial_capital) / initial_capital
        
        # CAGR (assuming daily_stats covers the period)
        days = (df.index[-1] - df.index[0]).days
        if days > 0:
            cagr = (final_equity / initial_capital) ** (365 / days) - 1
        else:
            cagr = 0.0
            
        # Volatility (Annualized)
        volatility = df['daily_return'].std() * np.sqrt(252)
        
        # Sharpe Ratio (Risk Free Rate = 0 for simplicity or 4%)
        rf = 0.04
        excess_returns = df['daily_return'] - (rf / 252)
        sharpe = (excess_returns.mean() / df['daily_return'].std()) * np.sqrt(252) if df['daily_return'].std() != 0 else 0
        
        # Max Drawdown
        df['cum_max'] = df['equity'].cummax()
        df['drawdown'] = (df['equity'] - df['cum_max']) / df['cum_max']
        max_drawdown = df['drawdown'].min()
        
        # Win Rate (Daily)
        win_days = len(df[df['daily_return'] > 0])
        total_days = len(df)
        win_rate = win_days / total_days if total_days > 0 else 0
        
        # Convert to native Python types and handle NaNs
        def clean(val):
            if pd.isna(val) or np.isnan(val) or np.isinf(val):
                return 0.0
            return float(val)

        return {
            "total_return": clean(total_return),
            "cagr": clean(cagr),
            "volatility": clean(volatility),
            "sharpe_ratio": clean(sharpe),
            "max_drawdown": clean(max_drawdown),
            "win_rate": clean(win_rate),
            "final_equity": clean(final_equity)
        }
