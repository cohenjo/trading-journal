"""
Company Analysis — Financial Calculation Modules

Pure, testable functions for long-term valuation and short-term technical analysis.
All monetary calculations use decimal.Decimal for precision (per team decision).
"""

from app.services.analysis.dcf import calculate_dcf, DCFInput, DCFResult
from app.services.analysis.scorecard import (
    calculate_roic,
    calculate_wacc,
    calculate_cagr,
    calculate_net_debt_to_ebitda,
    calculate_financial_scorecard,
    FinancialScorecardInput,
    FinancialScorecardResult,
)
from app.services.analysis.valuation import (
    calculate_forward_pe,
    calculate_peg_ratio,
    calculate_ev_fcf,
    calculate_valuation_multiples,
    ValuationMultiplesInput,
    ValuationMultiplesResult,
)
from app.services.analysis.technicals import (
    calculate_ema,
    calculate_bollinger_bands,
    calculate_rsi,
    calculate_macd,
    detect_support_resistance,
    TechnicalIndicatorsResult,
)
from app.services.analysis.options_analytics import (
    calculate_iv_percentile,
    calculate_iv_rank,
    calculate_csp_breakeven,
    format_greeks,
    OptionsAnalyticsResult,
)

__all__ = [
    "calculate_dcf", "DCFInput", "DCFResult",
    "calculate_roic", "calculate_wacc", "calculate_cagr",
    "calculate_net_debt_to_ebitda", "calculate_financial_scorecard",
    "FinancialScorecardInput", "FinancialScorecardResult",
    "calculate_forward_pe", "calculate_peg_ratio", "calculate_ev_fcf",
    "calculate_valuation_multiples", "ValuationMultiplesInput", "ValuationMultiplesResult",
    "calculate_ema", "calculate_bollinger_bands", "calculate_rsi",
    "calculate_macd", "detect_support_resistance", "TechnicalIndicatorsResult",
    "calculate_iv_percentile", "calculate_iv_rank", "calculate_csp_breakeven",
    "format_greeks", "OptionsAnalyticsResult",
]
