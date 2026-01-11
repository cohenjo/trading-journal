import yfinance as yf
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
from sqlmodel import Session, delete, select
from app.dal.database import engine
from app.schema.models import Ndx1m
from datetime import datetime, timedelta

def sync_ndx_data(date_str: str):
    """
    Downloads 1-minute NDX data for a given date and stores it in the database.
    """
    start_date = datetime.strptime(date_str, "%Y-%m-%d")
    end_date = start_date + timedelta(days=1)

    # Download data
    ndx_ticker = yf.Ticker("^NDX")
    hist = ndx_ticker.history(start=start_date.strftime("%Y-%m-%d"), end=end_date.strftime("%Y-%m-%d"), interval="1m")

    if hist.empty:
        return {"message": f"No data found for {date_str}"}

    # Store data in the database
    with Session(engine) as session:
        # Use a transaction to ensure atomicity
        with session.begin():
            # Delete existing data for the given date
            # Delete existing data for the given date
            # Delete existing data for the given date
            statement = select(Ndx1m).where(Ndx1m.timestamp >= start_date).where(Ndx1m.timestamp < end_date)
            results = session.exec(statement)
            for record in results:
                session.delete(record)

            # Insert new data
            for i in range(len(hist)):
                row = hist.iloc[i]
                timestamp = hist.index[i]
                db_record = Ndx1m(
                    timestamp=timestamp.to_pydatetime(),
                    open=float(row['Open']),
                    high=float(row['High']),
                    low=float(row['Low']),
                    close=float(row['Close']),
                    volume=int(row['Volume'])
                )
                session.add(db_record)

    return {"message": f"Successfully synced NDX data for {date_str}"}
