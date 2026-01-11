from fastapi import APIRouter, Depends
from sqlmodel import Session, select, or_
from datetime import datetime, timedelta, date
from typing import Optional
from app.dal.database import get_session
from app.schema.models import Trade, DailySummary, Note, MatchedTrade, date_type, SQLModel, DailyBar
from app.services.data_ingestion import MarketDataSync

router = APIRouter()

class DayDetails(SQLModel):
    summary: Optional[DailySummary] = None
    trades: list[Trade] = []
    note: Optional[Note] = None
    matched_trades: list[MatchedTrade] = []
    market_data: Optional[DailyBar] = None

@router.get("/day/{date}", response_model=DayDetails)
async def get_trades_for_day(date: date_type, session: Session = Depends(get_session)):
    summary_statement = select(DailySummary).where(DailySummary.date == date)
    summary = session.exec(summary_statement).first()

    note_statement = select(Note).where(Note.date == date)
    note = session.exec(note_statement).first()

    start_of_day = datetime.combine(date, datetime.min.time())
    end_of_day = start_of_day + timedelta(days=1)

    matched_trades_statement = select(MatchedTrade).where(
        or_(
            (MatchedTrade.open_date >= start_of_day) & (MatchedTrade.open_date < end_of_day),
            (MatchedTrade.close_date >= start_of_day) & (MatchedTrade.close_date < end_of_day)
        )
    )
    matched_trades_results = session.exec(matched_trades_statement)
    matched_trades = matched_trades_results.all()
    
    # Check Market Data (NDX)
    market_data = session.get(DailyBar, ("NDX", date))
    
    if not market_data and date <= date.today():
        try:
            syncer = MarketDataSync()
            # Sync NDX and VXN
            await syncer.sync_underlying_history("NDX", date, date)
            await syncer.sync_underlying_history("VXN", date, date)
            
            # Re-fetch
            # We need to clear the session cache or use a new query to see the changes made by the other session
            session.expire_all() 
            market_data = session.get(DailyBar, ("NDX", date))
        except Exception as e:
            print(f"Failed to sync market data for {date}: {e}")
 
    return DayDetails(
        summary=summary, 
        trades=[], 
        note=note, 
        matched_trades=list(matched_trades),
        market_data=market_data
    )
