from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from datetime import timedelta
from app.dal.database import get_session
from app.schema.models import Ndx1m, date_type, Ndx1mChartData
from app.utils.ndx_data import sync_ndx_data

router = APIRouter()

@router.post("/ndx/sync/{date}")
def sync_ndx_data_for_date(date: date_type):
    return sync_ndx_data(date.strftime("%Y-%m-%d"))


@router.get("/ndx/{date}", response_model=list[Ndx1mChartData])
def get_ndx_data_for_day(date: date_type, session: Session = Depends(get_session)):
    statement = select(Ndx1m).where(Ndx1m.timestamp >= date).where(Ndx1m.timestamp < date + timedelta(days=1)).order_by(Ndx1m.timestamp)
    results = session.exec(statement)
    data = results.all()
    
    chart_data = [
        Ndx1mChartData(
            time=item.timestamp.timestamp(),
            open=item.open,
            high=item.high,
            low=item.low,
            close=item.close,
        )
        for item in data
    ]
    return chart_data
