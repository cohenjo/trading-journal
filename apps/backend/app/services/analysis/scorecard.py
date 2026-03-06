"""
Financial Scorecard — quality and value-creation metrics.

Pure functions — no side effects, no DB, no network.
Uses Decimal where monetary precision matters.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Input / Output models
# ---------------------------------------------------------------------------

class FinancialScorecardInput(BaseModel):
    """All fields needed to compute the full scorecard."""
    # ROIC
    nopat: float = Field(..., description="Net Operating Profit After Tax")
    invested_capital: float = Field(..., gt=0, description="Total Equity + Total Debt - Cash")

    # WACC
    market_cap: float = Field(..., gt=0)
    total_debt: float = Field(0.0, ge=0)
    cost_of_equity: float = Field(..., description="e.g. 0.10 for 10%")
    cost_of_debt: float = Field(..., description="Pre-tax cost of debt, e.g. 0.05")
    tax_rate: float = Field(0.21, description="Corporate tax rate, e.g. 0.21")

    # CAGR inputs (oldest → newest, ascending order)
    revenue_history: List[float] = Field(..., min_length=2, description="Annual revenues, oldest first")
    fcf_history: List[float] = Field(..., min_length=2, description="Annual FCFs, oldest first")

    # Leverage
    net_debt: float = Field(..., description="Total Debt - Cash")
    ebitda: float = Field(..., description="Most recent EBITDA")


class FinancialScorecardResult(BaseModel):
    roic_pct: float
    wacc_pct: float
    roic_wacc_spread_pct: float
    value_creating: bool
    revenue_cagr_pct: float
    fcf_cagr_pct: float
    net_debt_to_ebitda: float | None


# ---------------------------------------------------------------------------
# Individual calculations
# ---------------------------------------------------------------------------

def calculate_roic(nopat: float, invested_capital: float) -> float:
    """Return on Invested Capital as a percentage."""
    if invested_capital <= 0:
        raise ValueError("Invested capital must be positive")
    return _pct(Decimal(str(nopat)) / Decimal(str(invested_capital)))


def calculate_wacc(
    market_cap: float,
    total_debt: float,
    cost_of_equity: float,
    cost_of_debt: float,
    tax_rate: float = 0.21,
) -> float:
    """Weighted Average Cost of Capital as a percentage."""
    mc = Decimal(str(market_cap))
    td = Decimal(str(total_debt))
    total = mc + td
    if total <= 0:
        raise ValueError("Market cap + debt must be positive")

    ke = Decimal(str(cost_of_equity))
    kd = Decimal(str(cost_of_debt))
    t = Decimal(str(tax_rate))

    w_equity = mc / total
    w_debt = td / total
    wacc = w_equity * ke + w_debt * kd * (Decimal("1") - t)
    return _pct(wacc)


def calculate_cagr(values: List[float]) -> float:
    """
    Compound Annual Growth Rate over len(values)-1 years.

    values: ordered oldest → newest (must have ≥ 2 entries).
    Returns percentage (e.g. 12.5 for 12.5%).
    Returns 0.0 if the starting value is zero or negative (cannot compute).
    """
    if len(values) < 2:
        raise ValueError("Need at least 2 data points for CAGR")

    begin = Decimal(str(values[0]))
    end = Decimal(str(values[-1]))
    n = len(values) - 1

    if begin <= 0:
        return 0.0

    # CAGR = (end/begin)^(1/n) - 1
    ratio = float(end / begin)
    if ratio <= 0:
        return 0.0
    cagr = ratio ** (1.0 / n) - 1.0
    return round(cagr * 100, 2)


def calculate_net_debt_to_ebitda(net_debt: float, ebitda: float) -> Optional[float]:
    """Net Debt / EBITDA ratio. Returns None if EBITDA is zero."""
    if ebitda == 0:
        return None
    result = Decimal(str(net_debt)) / Decimal(str(ebitda))
    return float(result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------------------
# Composite scorecard
# ---------------------------------------------------------------------------

def calculate_financial_scorecard(inp: FinancialScorecardInput) -> FinancialScorecardResult:
    """Compute all scorecard metrics in one call."""
    roic = calculate_roic(inp.nopat, inp.invested_capital)
    wacc = calculate_wacc(
        inp.market_cap, inp.total_debt,
        inp.cost_of_equity, inp.cost_of_debt, inp.tax_rate,
    )
    spread = round(roic - wacc, 2)
    rev_cagr = calculate_cagr(inp.revenue_history)
    fcf_cagr = calculate_cagr(inp.fcf_history)
    nd_ebitda = calculate_net_debt_to_ebitda(inp.net_debt, inp.ebitda)

    return FinancialScorecardResult(
        roic_pct=roic,
        wacc_pct=wacc,
        roic_wacc_spread_pct=spread,
        value_creating=spread > 0,
        revenue_cagr_pct=rev_cagr,
        fcf_cagr_pct=fcf_cagr,
        net_debt_to_ebitda=nd_ebitda,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pct(d: Decimal) -> float:
    """Convert decimal ratio to percentage rounded to 2 dp."""
    return float((d * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
