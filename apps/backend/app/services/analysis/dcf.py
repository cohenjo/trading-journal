"""
Discounted Cash Flow (DCF) Valuation Model

Pure functions — no side effects, no DB, no network.
Uses Decimal for monetary precision per team decision.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import List
from pydantic import BaseModel, Field


class DCFInput(BaseModel):
    """Inputs for a two-stage DCF model."""
    current_fcf: float = Field(..., description="Most recent annual Free Cash Flow")
    growth_rate: float = Field(..., description="Expected FCF growth rate (e.g. 0.15 for 15%)")
    discount_rate: float = Field(..., description="WACC / required return (e.g. 0.10 for 10%)")
    terminal_growth_rate: float = Field(0.03, description="Perpetuity growth rate (e.g. 0.03 for 3%)")
    projection_years: int = Field(10, ge=1, le=30, description="Number of explicit forecast years")
    shares_outstanding: float = Field(..., gt=0, description="Diluted shares outstanding")
    current_price: float = Field(0.0, description="Current share price (for margin of safety)")
    net_debt: float = Field(0.0, description="Total debt minus cash (subtracted from equity value)")


class DCFProjectionYear(BaseModel):
    year: int
    fcf: float
    discount_factor: float
    present_value: float


class DCFResult(BaseModel):
    projected_fcfs: List[DCFProjectionYear]
    pv_explicit_period: float
    terminal_value: float
    pv_terminal_value: float
    enterprise_value: float
    equity_value: float
    intrinsic_value_per_share: float
    margin_of_safety_pct: float | None = None


def calculate_dcf(inp: DCFInput) -> DCFResult:
    """
    Two-stage DCF: explicit high-growth period → terminal (Gordon Growth) perpetuity.

    Returns intrinsic value per share and margin of safety vs current price.
    """
    fcf = Decimal(str(inp.current_fcf))
    g = Decimal(str(inp.growth_rate))
    r = Decimal(str(inp.discount_rate))
    tg = Decimal(str(inp.terminal_growth_rate))
    shares = Decimal(str(inp.shares_outstanding))
    net_debt = Decimal(str(inp.net_debt))
    one = Decimal("1")

    if r <= tg:
        raise ValueError(
            f"Discount rate ({inp.discount_rate}) must exceed terminal growth rate ({inp.terminal_growth_rate})"
        )

    projected: List[DCFProjectionYear] = []
    pv_sum = Decimal("0")

    for yr in range(1, inp.projection_years + 1):
        fcf = fcf * (one + g)
        discount_factor = one / ((one + r) ** yr)
        pv = fcf * discount_factor
        pv_sum += pv
        projected.append(DCFProjectionYear(
            year=yr,
            fcf=_to_float(fcf),
            discount_factor=_to_float(discount_factor),
            present_value=_to_float(pv),
        ))

    # Terminal value using Gordon Growth Model on last projected FCF
    terminal_fcf = fcf * (one + tg)
    terminal_value = terminal_fcf / (r - tg)
    terminal_discount = one / ((one + r) ** inp.projection_years)
    pv_terminal = terminal_value * terminal_discount

    enterprise_value = pv_sum + pv_terminal
    equity_value = enterprise_value - net_debt
    intrinsic_per_share = equity_value / shares

    margin_of_safety: float | None = None
    if inp.current_price > 0:
        price = Decimal(str(inp.current_price))
        margin_of_safety = _to_float((intrinsic_per_share - price) / price * Decimal("100"))

    return DCFResult(
        projected_fcfs=projected,
        pv_explicit_period=_to_float(pv_sum),
        terminal_value=_to_float(terminal_value),
        pv_terminal_value=_to_float(pv_terminal),
        enterprise_value=_to_float(enterprise_value),
        equity_value=_to_float(equity_value),
        intrinsic_value_per_share=_to_float(intrinsic_per_share),
        margin_of_safety_pct=margin_of_safety,
    )


def _to_float(d: Decimal) -> float:
    """Round to 2 decimal places and convert to float for JSON serialisation."""
    return float(d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
