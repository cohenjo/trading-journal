"""
Valuation Multiples — Forward P/E, PEG, EV/FCF.

Pure functions using Decimal for monetary precision.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input / Output
# ---------------------------------------------------------------------------

class ValuationMultiplesInput(BaseModel):
    current_price: float = Field(..., gt=0)
    forward_eps: float = Field(..., description="Consensus forward EPS estimate")
    eps_growth_rate: float = Field(..., description="Expected EPS growth rate (e.g. 0.15 for 15%)")
    enterprise_value: float = Field(..., gt=0)
    free_cash_flow: float = Field(..., description="Trailing 12-month FCF")


class ValuationMultiplesResult(BaseModel):
    forward_pe: float | None
    peg_ratio: float | None
    ev_fcf: float | None


# ---------------------------------------------------------------------------
# Individual calculations
# ---------------------------------------------------------------------------

def calculate_forward_pe(price: float, forward_eps: float) -> Optional[float]:
    """Forward P/E = Price / Forward EPS. None if EPS ≤ 0."""
    if forward_eps <= 0:
        return None
    result = Decimal(str(price)) / Decimal(str(forward_eps))
    return _round2(result)


def calculate_peg_ratio(price: float, forward_eps: float, eps_growth_rate: float) -> Optional[float]:
    """PEG = (P/E) / (EPS growth rate × 100). None if inputs invalid."""
    if forward_eps <= 0 or eps_growth_rate <= 0:
        return None
    pe = Decimal(str(price)) / Decimal(str(forward_eps))
    growth_pct = Decimal(str(eps_growth_rate)) * Decimal("100")
    peg = pe / growth_pct
    return _round2(peg)


def calculate_ev_fcf(enterprise_value: float, fcf: float) -> Optional[float]:
    """EV/FCF ratio. None if FCF ≤ 0."""
    if fcf <= 0:
        return None
    result = Decimal(str(enterprise_value)) / Decimal(str(fcf))
    return _round2(result)


# ---------------------------------------------------------------------------
# Composite
# ---------------------------------------------------------------------------

def calculate_valuation_multiples(inp: ValuationMultiplesInput) -> ValuationMultiplesResult:
    """Compute all valuation multiples in one call."""
    return ValuationMultiplesResult(
        forward_pe=calculate_forward_pe(inp.current_price, inp.forward_eps),
        peg_ratio=calculate_peg_ratio(inp.current_price, inp.forward_eps, inp.eps_growth_rate),
        ev_fcf=calculate_ev_fcf(inp.enterprise_value, inp.free_cash_flow),
    )


def _round2(d: Decimal) -> float:
    return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
