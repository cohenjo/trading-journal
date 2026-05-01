from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from pydantic import BaseModel

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.dividend_models import DividendAccount, DividendPosition
from app.schema.finance_models import FinanceSnapshot
from app.services.household_service import get_user_household_id

router = APIRouter(prefix="/api/dividends/accounts", tags=["Dividend Accounts"])

class ImportableAccount(BaseModel):
    id: str
    name: str
    type: str
    details: Optional[dict] = None

class ImportRequest(BaseModel):
    linked_id: str
    name: str

@router.get("", response_model=List[str])
def get_accounts(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session)
):
    """List all dividend account names for the authenticated user's household."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    accounts = session.exec(
        select(DividendAccount).where(DividendAccount.household_id == household_id)
    ).all()
    # Return list of names
    return [a.name for a in accounts]

@router.get("/importable", response_model=List[ImportableAccount])
def get_importable_accounts(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session)
):
    """List investment accounts available for import from finance snapshots."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    # 1. Get existing linked IDs for this household
    existing_accounts = session.exec(
        select(DividendAccount).where(DividendAccount.household_id == household_id)
    ).all()
    linked_ids = {a.linked_id for a in existing_accounts if a.linked_id}

    # 2. Get latest snapshot for this household
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .order_by(FinanceSnapshot.date.desc())
        .limit(1)
    )
    snapshot = session.exec(statement).first()
    
    if not snapshot or not snapshot.data or 'items' not in snapshot.data:
        return []

    importable = []
    for item in snapshot.data['items']:
        # Filter for Investments that are not yet linked
        if item.get('category') == 'Investments' and item.get('id') not in linked_ids:
            importable.append(ImportableAccount(
                id=item['id'],
                name=item['name'],
                type=item.get('type', 'Unknown'),
                details=item.get('details')
            ))
            
    return importable

@router.post("/import", response_model=str)
def import_account(
    req: ImportRequest,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session)
):
    """Import a finance snapshot investment as a dividend account."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    # Check if name exists for this household
    existing = session.exec(
        select(DividendAccount)
        .where(DividendAccount.name == req.name)
        .where(DividendAccount.household_id == household_id)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Account name already exists")
    
    # Check if linked_id already used in this household
    existing_linked = session.exec(
        select(DividendAccount)
        .where(DividendAccount.linked_id == req.linked_id)
        .where(DividendAccount.household_id == household_id)
    ).first()
    if existing_linked:
         raise HTTPException(status_code=400, detail="This investment account is already linked")

    # Create Account
    new_account = DividendAccount(
        name=req.name,
        linked_id=req.linked_id,
        household_id=household_id
    )
    session.add(new_account)
    
    # Auto-populate RSU positions
    # Need to fetch the item details from snapshot
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .order_by(FinanceSnapshot.date.desc())
        .limit(1)
    )
    snapshot = session.exec(statement).first()
    
    if snapshot and snapshot.data and 'items' in snapshot.data:
        item = next((i for i in snapshot.data['items'] if i['id'] == req.linked_id), None)
        if item and item.get('details'):
            details = item['details']
            stock_symbol = details.get('stock_symbol')
            # RSU logic: 'rsu_grants' is list of {vested: int, ...}
            # We aggregate total vested shares? Or create one position?
            # User said "we already have the amount of stocks and ticker".
            # Usually RSU grants are multiple. Let's sum vested shares.
            grants = details.get('rsu_grants', [])
            total_shares = 0
            if isinstance(grants, list):
                for g in grants:
                    total_shares += float(g.get('vested', 0))
            
            if stock_symbol and total_shares > 0:
                # Create position
                pos = DividendPosition(
                    account=req.name,
                    ticker=stock_symbol,
                    shares=total_shares
                )
                session.add(pos)

    session.commit()
    return new_account.name

@router.post("", response_model=str)
def create_account(
    name: str,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session)
):
    """Create a new empty dividend account."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    # Check if exists for this household
    existing = session.exec(
        select(DividendAccount)
        .where(DividendAccount.name == name)
        .where(DividendAccount.household_id == household_id)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Account already exists")
    
    account = DividendAccount(name=name, household_id=household_id)
    session.add(account)
    session.commit()
    return account.name

@router.delete("/{name}")
def delete_account(
    name: str,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session)
):
    """Delete a dividend account and its positions from the authenticated user's household."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    account = session.exec(
        select(DividendAccount)
        .where(DividendAccount.name == name)
        .where(DividendAccount.household_id == household_id)
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    # Delete positions first (Cascading Delete)
    positions = session.exec(select(DividendPosition).where(DividendPosition.account == name)).all()
    for pos in positions:
        session.delete(pos)
    
    linked_id = account.linked_id
    
    session.delete(account)
    
    # If linked, update the latest snapshot to set dividend_yield to 0
    if linked_id:
        statement = (
            select(FinanceSnapshot)
            .where(FinanceSnapshot.household_id == household_id)
            .order_by(FinanceSnapshot.date.desc())
            .limit(1)
        )
        snapshot = session.exec(statement).first()
        if snapshot and snapshot.data and 'items' in snapshot.data:
            # We need to clone the data to trigger update detection if using SQLAlchemy JSON mutation tracking, 
            # but usually re-assigning works.
            updated = False
            for item in snapshot.data['items']:
                if item['id'] == linked_id:
                    if 'details' not in item:
                        item['details'] = {}
                    item['details']['dividend_yield'] = 0
                    updated = True
                    break
            
            if updated:
                snapshot.data = dict(snapshot.data) # Force refresh
                session.add(snapshot)

    session.commit()
    return {"status": "success"}
