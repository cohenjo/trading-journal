from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.dal.database import get_session
from app.schema.finance_models import FinanceSnapshot, SnapshotData

router = APIRouter(prefix="/api/finances", tags=["finances"])


@router.get("/price/{symbol}")
def get_stock_price(symbol: str):
    """
    Get real-time stock price from Yahoo Finance.
    """
    import yfinance as yf
    try:
        ticker = yf.Ticker(symbol)
        # fast_info is often faster than history(period='1d')
        price = ticker.fast_info.last_price
        
        # Fallback if fast_info fails or returns None
        if not price:
            history = ticker.history(period="1d")
            if not history.empty:
                price = history['Close'].iloc[-1]
        
        if not price:
             raise HTTPException(status_code=404, detail=f"Could not fetch price for {symbol}")

        # Try to get dividend yield from info (slower but more detailed)
        dividend_yield = 0
        try:
            info = ticker.info
            # dividendYield is returned as percentage (e.g. 0.77 for 0.77% or 6.97 for 6.97%)
            if 'dividendYield' in info and info['dividendYield']:
                dividend_yield = round(info['dividendYield'], 2)
        except:
            pass # Ignore info fetch failures

        return {
            "symbol": symbol.upper(),
            "price": round(price, 2),
            "currency": ticker.fast_info.currency or "USD",
            "dividend_yield": dividend_yield
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/latest", response_model=FinanceSnapshot)
def get_latest_snapshot(db: Session = Depends(get_session)):
    """
    Get the most recent finance snapshot, enriched with latest dashboard dividend data.
    """
    statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)
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
def create_snapshot(data: SnapshotData, db: Session = Depends(get_session)):
    """
    Create or update a finance snapshot.
    Upserts based on date (PK). Defaults to today if date not provided.
    """
    snapshot_date = data.date if data.date else date.today()
    
    # Check if a snapshot already exists for the date
    statement = select(FinanceSnapshot).where(FinanceSnapshot.date == snapshot_date)
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
def get_snapshot_history(limit: int = 30, db: Session = Depends(get_session)):
    """
    Get historical snapshots, useful for graphing.
    Returns list sorted by date descending.
    """
    # We might want to return a lighter model here if the JSON data is huge,
    # but for now returning the full object is fine.
    statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(limit)
    history = db.exec(statement).all()
    return history


@router.delete("/{date_str}", response_model=bool)
def delete_snapshot(date_str: date, db: Session = Depends(get_session)):
    """
    Delete a finance snapshot by date.
    """
    statement = select(FinanceSnapshot).where(FinanceSnapshot.date == date_str)
    snapshot = db.exec(statement).first()
    
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
        
    db.delete(snapshot)
    db.commit()
    return True
