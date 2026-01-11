from fastapi import APIRouter
from typing import List
from app.schema.dividend_models import (
    DividendRecord,
    DividendProjectionParams,
    DividendProjectionPoint,
    DividendProjectionResponse,
)
from app.data.dividends_xlsx import load_dividends, save_dividends

router = APIRouter()

@router.get("/dividends", response_model=List[DividendRecord])
def get_dividends():
    return load_dividends()


@router.post("/dividends", response_model=List[DividendRecord])
def update_dividends(records: List[DividendRecord]):
    save_dividends(records)
    return records


@router.post("/dividends/projection", response_model=DividendProjectionResponse)
def get_dividend_projection(params: DividendProjectionParams):
    historical = load_dividends()

    if not historical:
        return DividendProjectionResponse(data=[])

    # Sort historical data just in case
    historical.sort(key=lambda x: x.year)

    last_record = historical[-1]
    current_amount = last_record.amount
    current_year = last_record.year

    projection_points: List[DividendProjectionPoint] = []

    # Add historical points
    for record in historical:
        projection_points.append(
            DividendProjectionPoint(
                year=record.year, amount=record.amount, type="historical"
            )
        )

    # Project forward
    # We project until the requested final year
    end_year = params.final_year

    # If current year is already past end_year, just return historical
    if current_year >= end_year:
        return DividendProjectionResponse(data=projection_points)

    for year in range(current_year + 1, end_year + 1):
        if year <= params.cutoff_year:
            # Reinvest phase
            # Next Dividend = Current * (1 + Growth_Rate + (Reinvest_Rate * Yield))
            growth_factor = 1 + params.growth_rate + (params.reinvest_rate * params.yield_rate)
        else:
            # Withdrawal phase
            # Next Dividend = Current * (1 + Growth_Rate)
            growth_factor = 1 + params.growth_rate

        current_amount = current_amount * growth_factor

        projection_points.append(
            DividendProjectionPoint(year=year, amount=current_amount, type="projected")
        )

    return DividendProjectionResponse(data=projection_points)
