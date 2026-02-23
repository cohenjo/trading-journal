from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import List, Dict, Any
from sqlmodel import Session

from app.dal.database import get_session
from app.schema.dividend_models import (
    DividendPosition,
    DividendPositionCreate,
    DividendPositionStats,
    DividendDashboardStats,
    DividendRecord, # Legacy
    DividendProjectionParams, # Legacy
    DividendProjectionResponse # Legacy
)
from app.services import dividend_service
from app.data.dividends_xlsx import load_dividends, save_dividends

router = APIRouter(tags=["dividends"]) # Prefix handled in main.py usually, checking main.py it is prefix="/api", tags=["dividends"]

# --- New Dashboard Endpoints ---

@router.get("/dividends/dashboard", response_model=Dict[str, Any])
def get_dividend_dashboard(
    background_tasks: BackgroundTasks,
    account: str = Query(None), 
    currency: str = Query("USD"),
    db: Session = Depends(get_session)
):
    """
    Get dashboard stats and enriched positions.
    Optionally filter by account.
    """
    positions = dividend_service.get_all_positions(db, account)
    
    # Trigger background cache update
    if positions:
        tickers = list(set(p.ticker for p in positions))
        background_tasks.add_task(dividend_service.update_dividend_cache_background, tickers)
        
    result = dividend_service.enrich_positions(positions, db, target_currency=currency)
    return result

@router.post("/dividends/position", response_model=DividendPosition)
def create_dividend_position(position: DividendPositionCreate, db: Session = Depends(get_session)):
    return dividend_service.create_position(db, position)

@router.put("/dividends/position/{position_id}", response_model=DividendPosition)
def update_dividend_position(position_id: int, position: DividendPositionCreate, db: Session = Depends(get_session)):
    updated = dividend_service.update_position(db, position_id, position)
    if not updated:
        raise HTTPException(status_code=404, detail="Position not found")
    return updated

@router.delete("/dividends/position/{position_id}", response_model=bool)
def delete_dividend_position(position_id: int, db: Session = Depends(get_session)):
    success = dividend_service.delete_position(db, position_id)
    if not success:
        raise HTTPException(status_code=404, detail="Position not found")
    return True

# --- Legacy / Existing Endpoints (Preserved for now) ---

@router.get("/dividends", response_model=List[DividendRecord])
def get_dividends():
    return load_dividends()


@router.post("/dividends", response_model=List[DividendRecord])
def update_dividends(records: List[DividendRecord]):
    save_dividends(records)
    return records


@router.post("/dividends/projection", response_model=DividendProjectionResponse)
def get_dividend_projection(params: DividendProjectionParams):
    from app.schema.dividend_models import DividendProjectionPoint # Import locally to avoid circular if any
    
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
