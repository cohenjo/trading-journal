from fastapi import APIRouter
from typing import List
from app.schema.options_models import (
    OptionsRecord,
    OptionsProjectionParams,
    OptionsProjectionPoint,
    OptionsProjectionResponse,
)
from app.data.options_xlsx import load_options, save_options

router = APIRouter()

@router.get("/options", response_model=List[OptionsRecord])
def get_options_income():
    return load_options()


@router.post("/options", response_model=List[OptionsRecord])
def update_options_income(records: List[OptionsRecord]):
    save_options(records)
    return records


@router.post("/options/projection", response_model=OptionsProjectionResponse)
def get_options_projection(params: OptionsProjectionParams):
    historical = load_options()

    if not historical:
        return OptionsProjectionResponse(data=[])

    historical.sort(key=lambda x: x.year)

    # Base income is the average of historical amounts
    total = sum(r.amount for r in historical)
    count = len(historical)
    base_amount = total / count if count > 0 else 0.0

    if base_amount <= 0:
        # If average is zero or negative, just return historical
        points: List[OptionsProjectionPoint] = [
            OptionsProjectionPoint(year=r.year, amount=r.amount, type="historical")
            for r in historical
        ]
        return OptionsProjectionResponse(data=points)

    points: List[OptionsProjectionPoint] = []
    for record in historical:
        points.append(
            OptionsProjectionPoint(
                year=record.year,
                amount=record.amount,
                type="historical",
            )
        )

    end_year = params.final_year
    # If final year is before or at the last historical year, just return historical.
    last_hist_year = historical[-1].year
    if end_year <= last_hist_year:
        return OptionsProjectionResponse(data=points)

    # We grow from the historical average (base_amount) starting at the last
    # historical year, compounding until the cutoff_year. After cutoff_year,
    # income stays flat at whatever level was reached in the cutoff year.
    cutoff_value: float | None = None
    for year in range(last_hist_year + 1, end_year + 1):
        if year <= params.cutoff_year:
            years_from_last_hist = year - last_hist_year
            current_amount = base_amount * ((1 + params.growth_rate) ** years_from_last_hist)
            if year == params.cutoff_year:
                cutoff_value = current_amount
        else:
            # Flat phase: keep income equal to the value at cutoff year
            if cutoff_value is None:
                # If cutoff is before or at last_hist_year, just use base_amount
                cutoff_value = base_amount
            current_amount = cutoff_value

        points.append(
            OptionsProjectionPoint(
                year=year,
                amount=current_amount,
                type="projected",
            )
        )

    return OptionsProjectionResponse(data=points)
