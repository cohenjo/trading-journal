from typing import List, Dict, Any

INFLATION_RATE = 1.015

BASE_BRACKETS = [
    {"limit": 7010, "rate": 0.10},
    {"limit": 10060, "rate": 0.14},
    {"limit": 16150, "rate": 0.20},
    {"limit": 22440, "rate": 0.31},
    {"limit": 46690, "rate": 0.35},
    {"limit": 60000, "rate": 0.47},
    {"limit": float("inf"), "rate": 0.50},
]

BASE_CREDIT_POINT = 242


def calculate_marginal_tax(monthly_taxable_income: float, current_year: int, apply_credit_points: bool = True) -> float:
    """
    Calculates the marginal tax on a given monthly taxable income.
    Optionally applies the standard 2.25 credit points for a resident.
    """
    if monthly_taxable_income <= 0:
        return 0.0

    years_from_2026 = max(0, current_year - 2026)
    inflation_factor = INFLATION_RATE**years_from_2026

    tax = 0.0
    previous_limit = 0.0

    for bracket in BASE_BRACKETS:
        inflated_limit = bracket["limit"] * inflation_factor
        if monthly_taxable_income > previous_limit:
            taxable_in_bracket = min(monthly_taxable_income, inflated_limit) - previous_limit
            tax += taxable_in_bracket * bracket["rate"]
        previous_limit = inflated_limit

    if apply_credit_points:
        credit_points_amount = 2.25 * BASE_CREDIT_POINT * inflation_factor
        tax = max(0.0, tax - credit_points_amount)

    return tax


def calculate_tax_on_additional_income(
    base_annual_income: float, additional_annual_income: float, current_year: int
) -> float:
    """
    Calculates the tax on additional income (e.g. RSU vesting or sale) on top of a base income.
    This correctly applies marginal brackets without double-counting credit points.
    """
    if additional_annual_income <= 0:
        return 0.0

    base_monthly = base_annual_income / 12.0
    new_monthly = (base_annual_income + additional_annual_income) / 12.0

    base_tax = calculate_marginal_tax(base_monthly, current_year, apply_credit_points=True)
    total_tax = calculate_marginal_tax(new_monthly, current_year, apply_credit_points=True)

    return (total_tax - base_tax) * 12.0


def calculate_rsu_withdrawal_effective_tax_rate(
    gross_withdrawal_amount: float,
    rsu_grants: List[Dict[str, Any]],
    sale_price: float,
    current_year: int,
    base_annual_income: float,
) -> float:
    """
    Calculate the effective tax rate on a Gross RSU withdrawal.

    In Israel:
    - Up to grant price: taxed as Income
    - Above grant price: taxed as Capital Gains (25%)

    Uses a blended average grant price across all grants.
    """
    if gross_withdrawal_amount <= 0.0:
        return 0.0

    if not rsu_grants or sale_price <= 0.0:
        return 0.0

    total_shares = 0.0
    total_grant_value = 0.0

    for grant in rsu_grants:
        shares = float(grant.get("shares", 0))
        price = float(grant.get("price", 0))
        total_shares += shares
        total_grant_value += shares * price

    if total_shares <= 0.0:
        return 0.0

    blended_grant_price = total_grant_value / total_shares
    shares_sold = gross_withdrawal_amount / sale_price

    income_portion = shares_sold * blended_grant_price
    cap_gains_portion = max(0.0, shares_sold * (sale_price - blended_grant_price))

    income_tax = calculate_tax_on_additional_income(base_annual_income, income_portion, current_year)
    cap_gains_tax = cap_gains_portion * 0.25

    total_tax = income_tax + cap_gains_tax

    effective_rate = total_tax / gross_withdrawal_amount
    return min(0.99, effective_rate)
