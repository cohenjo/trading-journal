"""
Options Analytics — IV Percentile, IV Rank, CSP breakeven, Greeks formatter.

Pure functions using Decimal for monetary precision.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------

class FormattedGreeks(BaseModel):
    delta: str
    gamma: str
    theta: str
    vega: str
    rho: str | None = None


class CSPBreakevenResult(BaseModel):
    strike_price: float
    premium_received: float
    breakeven_price: float
    max_loss: float
    return_on_capital_pct: float


class OptionsAnalyticsResult(BaseModel):
    iv_percentile: float | None
    iv_rank: float | None
    csp_breakeven: CSPBreakevenResult | None
    greeks: FormattedGreeks | None


# ---------------------------------------------------------------------------
# IV Percentile
# ---------------------------------------------------------------------------

def calculate_iv_percentile(
    current_iv: float,
    iv_history: List[float],
) -> Optional[float]:
    """
    IV Percentile = % of days in the last year where IV was BELOW current IV.

    Returns 0–100 percentage, or None if history is empty.
    """
    if not iv_history:
        return None
    below = sum(1 for iv in iv_history if iv < current_iv)
    pct = (below / len(iv_history)) * 100.0
    return round(pct, 2)


# ---------------------------------------------------------------------------
# IV Rank
# ---------------------------------------------------------------------------

def calculate_iv_rank(
    current_iv: float,
    iv_history: List[float],
) -> Optional[float]:
    """
    IV Rank = (Current IV - 1yr Low) / (1yr High - 1yr Low) × 100.

    Returns 0–100 percentage, or None if range is zero / history empty.
    """
    if not iv_history:
        return None

    iv_low = min(iv_history)
    iv_high = max(iv_history)
    iv_range = iv_high - iv_low

    if iv_range == 0:
        return None

    rank = ((current_iv - iv_low) / iv_range) * 100.0
    return round(rank, 2)


# ---------------------------------------------------------------------------
# Cash Secured Put Breakeven
# ---------------------------------------------------------------------------

def calculate_csp_breakeven(
    strike_price: float,
    premium: float,
    contracts: int = 1,
    multiplier: int = 100,
) -> CSPBreakevenResult:
    """
    Cash Secured Put analytics.

    Breakeven = Strike - Premium
    Max Loss  = (Strike - Premium) × contracts × multiplier  (stock goes to 0)
    Return on Capital = Premium / Strike × 100
    """
    s = Decimal(str(strike_price))
    p = Decimal(str(premium))
    c = Decimal(str(contracts))
    m = Decimal(str(multiplier))

    breakeven = s - p
    max_loss = breakeven * c * m
    roc = (p / s) * Decimal("100") if s > 0 else Decimal("0")

    return CSPBreakevenResult(
        strike_price=float(s),
        premium_received=float(p),
        breakeven_price=_r2(breakeven),
        max_loss=_r2(max_loss),
        return_on_capital_pct=_r2(roc),
    )


# ---------------------------------------------------------------------------
# Greeks Display Formatter
# ---------------------------------------------------------------------------

def format_greeks(
    delta: float,
    gamma: float,
    theta: float,
    vega: float,
    rho: Optional[float] = None,
) -> FormattedGreeks:
    """
    Format raw greeks into human-readable strings with appropriate precision.

    Delta/Gamma → 4 dp, Theta/Vega → 2 dp, Rho → 4 dp.
    """
    return FormattedGreeks(
        delta=f"{delta:+.4f}",
        gamma=f"{gamma:.4f}",
        theta=f"{theta:+.2f}",
        vega=f"{vega:.2f}",
        rho=f"{rho:+.4f}" if rho is not None else None,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _r2(d: Decimal) -> float:
    return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
