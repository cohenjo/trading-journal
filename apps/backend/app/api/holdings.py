from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.bond_models import BondHolding, BondHoldingCreate, BondHoldingUpdate
from app.services.household_service import get_user_household_id

router = APIRouter()

@router.get("/holdings", response_model=list[BondHolding])
def list_holdings(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Return the full current bond holdings portfolio for the authenticated user's household.

    RLS policies ensure users only see bonds from their household.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    statement = (
        select(BondHolding)
        .where(BondHolding.household_id == household_id)
        .where(BondHolding.deleted_at.is_(None))
    )
    results = db.exec(statement).all()
    return list(results)


@router.post("/holdings", response_model=BondHolding)
def create_holding(
    holding: BondHoldingCreate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Create a new bond holding in the authenticated user's household."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    # Check if bond with this ID already exists
    existing = db.get(BondHolding, holding.id)
    if existing and existing.deleted_at is None:
        raise HTTPException(status_code=400, detail="Bond holding with this ID already exists")
    
    db_holding = BondHolding(
        **holding.model_dump(),
        household_id=household_id
    )
    db.add(db_holding)
    db.commit()
    db.refresh(db_holding)
    return db_holding


@router.put("/holdings/{bond_id}", response_model=BondHolding)
def update_holding(
    bond_id: str, 
    updates: BondHoldingUpdate,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Update selected fields of a bond holding."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    db_holding = db.get(BondHolding, bond_id)
    if not db_holding or db_holding.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Bond not found")
    
    if db_holding.household_id != household_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this bond")
    
    # Update only provided fields
    update_data = updates.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_holding, key, value)
    
    db.add(db_holding)
    db.commit()
    db.refresh(db_holding)
    return db_holding


@router.delete("/holdings/{bond_id}")
def delete_holding(
    bond_id: str,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """Soft-delete a bond holding from the authenticated user's household portfolio."""
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    db_holding = db.get(BondHolding, bond_id)
    if not db_holding or db_holding.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Bond not found")
    
    if db_holding.household_id != household_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this bond")
    
    # Soft delete by setting deleted_at
    from datetime import datetime
    db_holding.deleted_at = datetime.now().date()
    db.add(db_holding)
    db.commit()
    
    return {"status": "deleted", "id": bond_id}
