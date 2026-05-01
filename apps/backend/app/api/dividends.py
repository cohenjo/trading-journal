from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Dict, Any
from uuid import UUID
from sqlmodel import Session

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.dividend_models import (
    DividendPosition,
    DividendPositionCreate # Legacy
)
from app.services import dividend_service
from app.services.household_service import get_user_household_id

router = APIRouter(tags=["dividends"]) # Prefix handled in main.py usually, checking main.py it is prefix="/api", tags=["dividends"]

# --- New Dashboard Endpoints ---

@router.get("/dividends/dashboard", response_model=Dict[str, Any])
def get_dividend_dashboard(
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
    account: str = Query(None), 
    currency: str = Query("USD"),
    db: Session = Depends(get_session)
):
    """
    Get dashboard stats and enriched positions for the authenticated user's household.
    Optionally filter by account.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    positions = dividend_service.get_all_positions(db, household_id=household_id, account=account)
    
    # Trigger background cache update
    if positions:
        tickers = list(set(p.ticker for p in positions))
        background_tasks.add_task(dividend_service.update_dividend_cache_background, tickers)
        
    result = dividend_service.enrich_positions(positions, db, target_currency=currency)
    return result

@router.post("/dividends/position", response_model=DividendPosition)
def create_dividend_position(
    position: DividendPositionCreate, 
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Create a new dividend position in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    return dividend_service.create_position(db, position, household_id)

@router.put("/dividends/position/{position_id}", response_model=DividendPosition)
def update_dividend_position(
    position_id: int, 
    position: DividendPositionCreate, 
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Update an existing dividend position in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    updated = dividend_service.update_position(db, position_id, position, household_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Position not found")
    return updated

@router.delete("/dividends/position/{position_id}", response_model=bool)
def delete_dividend_position(
    position_id: int, 
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Delete a dividend position by ID from the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    success = dividend_service.delete_position(db, position_id, household_id)
    if not success:
        raise HTTPException(status_code=404, detail="Position not found")
    return True

# --- Legacy / Existing Endpoints (REMOVED - XLSX file storage deprecated) ---
# The following endpoints have been removed as part of migration to DB storage:
# - GET /dividends (load_dividends from XLSX)
# - POST /dividends (save_dividends to XLSX)
# - POST /dividends/projection (uses XLSX historical data)
#
# Frontend should migrate to use:
# - GET /dividends/dashboard for dashboard data
# - POST/PUT/DELETE /dividends/position for CRUD operations
