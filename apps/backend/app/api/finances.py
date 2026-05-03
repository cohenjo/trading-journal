from datetime import date
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.finance_models import FinanceSnapshot, SnapshotData
from app.services.household_service import get_user_household_id
from app.services.price_cache import fetch_external_price

router = APIRouter(prefix="/api/finances", tags=["finances"])


@router.get("/price/{symbol}", deprecated=True)
def get_stock_price(symbol: str):
    """Deprecated live lookup retained for local maintenance only.

    TJ-020 moved frontend reads to ``public.price_cache`` populated by the
    scheduled ``prices_refresh`` worker. New callers should read that cache.
    """

    try:
        quote = fetch_external_price(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - deprecated endpoint preserves legacy 500s
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "symbol": quote.symbol,
        "price": str(quote.price),
        "currency": quote.currency,
        "as_of": quote.as_of.isoformat(),
        "deprecated": True,
    }


@router.get("/latest", response_model=FinanceSnapshot)
def get_latest_snapshot(
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """
    Get the most recent finance snapshot for the authenticated user's household,
    enriched with latest dashboard dividend data.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .order_by(FinanceSnapshot.date.desc())
        .limit(1)
    )
    snapshot = db.exec(statement).first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="No finance snapshots found")
    
    # Enrich with latest dashboard dividends for linked accounts
    try:
        from app.schema.dividend_models import DividendAccount, DividendPosition, DividendTickerData
        from app.utils.currency import convert_currency
        
        items = snapshot.data.get('items', [])
        updated = False
        
        for item in items:
            linked_id = item.get('id')
            if not linked_id: continue
            
            # Find linked dividend account
            stmt = select(DividendAccount).where(DividendAccount.linked_id == linked_id)
            div_acc = db.exec(stmt).first()
            
            if div_acc:
                # Calculate total annual income
                d_positions = db.exec(select(DividendPosition).where(DividendPosition.account == div_acc.name)).all()
                if d_positions:
                    tickers = [p.ticker for p in d_positions]
                    td_list = db.exec(select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))).all()
                    td_map = {t.ticker: t for t in td_list}
                    
                    total_income = 0.0
                    for p in d_positions:
                        td = td_map.get(p.ticker)
                        if td:
                            # Convert to item's native currency
                            total_income += convert_currency(p.shares * td.dividend_rate, td.currency, item.get('currency', 'USD'))
                    
                    if total_income > 0:
                        if 'details' not in item: item['details'] = {}
                        item['details']['dividend_fixed_amount'] = round(total_income, 2)
                        item['details']['dividend_mode'] = 'Fixed'
                        updated = True
        
        if updated:
            # We don't commit it to the DB here to avoid side effects during GET, 
            # just return the enriched object.
            # But the caller expects a model.
             pass 
    except Exception as e:
        # Log and continue with non-enriched snapshot
        print(f"Failed to enrich snapshot: {e}")

    return snapshot


@router.post("/", response_model=FinanceSnapshot)
def create_snapshot(
    data: SnapshotData, 
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """
    Create or update a finance snapshot for the authenticated user's household.
    Upserts based on (household_id, date). Defaults to today if date not provided.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    snapshot_date = data.date if data.date else date.today()
    
    # Check if a snapshot already exists for this household and date
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .where(FinanceSnapshot.date == snapshot_date)
    )
    existing_snapshot = db.exec(statement).first()
    
    # Prepare the snapshot data dictionary
    snapshot_data_dict = data.model_dump(mode='json')
    
    if existing_snapshot:
        # Update existing
        existing_snapshot.data = snapshot_data_dict
        existing_snapshot.net_worth = data.net_worth
        existing_snapshot.total_assets = data.total_assets
        existing_snapshot.total_liabilities = data.total_liabilities
        db.add(existing_snapshot)
        db.commit()
        db.refresh(existing_snapshot)
        return existing_snapshot
    else:
        # Create new
        new_snapshot = FinanceSnapshot(
            household_id=household_id,
            date=snapshot_date,
            data=snapshot_data_dict,
            net_worth=data.net_worth,
            total_assets=data.total_assets,
            total_liabilities=data.total_liabilities
        )
        db.add(new_snapshot)
        db.commit()
        db.refresh(new_snapshot)
        return new_snapshot


@router.get("/history", response_model=List[FinanceSnapshot])
def get_snapshot_history(
    limit: int = 30,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """
    Get historical snapshots for the authenticated user's household, useful for graphing.
    Returns list sorted by date descending.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .order_by(FinanceSnapshot.date.desc())
        .limit(limit)
    )
    history = db.exec(statement).all()
    return history


@router.delete("/{date_str}", response_model=bool)
def delete_snapshot(
    date_str: date,
    user_id: UUID = Depends(get_current_user_id),
    db: Session = Depends(get_session)
):
    """
    Delete a finance snapshot by date for the authenticated user's household.
    """
    household_id = get_user_household_id(db, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")
    
    statement = (
        select(FinanceSnapshot)
        .where(FinanceSnapshot.household_id == household_id)
        .where(FinanceSnapshot.date == date_str)
    )
    snapshot = db.exec(statement).first()
    
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
        
    db.delete(snapshot)
    db.commit()
    return True
