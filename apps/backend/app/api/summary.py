from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from datetime import timedelta
from app.dal.database import get_session
from app.schema.models import DailySummary, date_type

router = APIRouter()

@router.get("/summary/latest-month")
def get_latest_summary_month(session: Session = Depends(get_session)):
    latest_date = session.exec(select(DailySummary.date).order_by(DailySummary.date.desc())).first()
    if latest_date is None:
        return None
    return {"year": latest_date.year, "month": latest_date.month}

@router.get("/summary/{year}/{month}", response_model=list[DailySummary])
def get_summary_for_month(year: int, month: int, session: Session = Depends(get_session)):
    start_date = date_type(year, month, 1)
    end_date = start_date.replace(day=28) + timedelta(days=4)
    end_date = end_date - timedelta(days=end_date.day - 1)
    statement = select(DailySummary).where(DailySummary.date >= start_date).where(DailySummary.date < end_date)
    results = session.exec(statement)
    summaries = results.all()
    return summaries
