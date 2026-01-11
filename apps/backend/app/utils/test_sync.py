import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from app.utils.ndx_data import sync_ndx_data
from app.dal.database import engine, create_db_and_tables
from app.schema.models import Ndx1m
from sqlmodel import Session, select
from datetime import date

def run_test():
    print("--- Starting Test ---")
    
    # Ensure tables are created
    create_db_and_tables()
    
    # Define the test date
    test_date = "2025-07-01"
    print(f"Testing sync for date: {test_date}")

    # Run the sync function
    result = sync_ndx_data(test_date)
    print(f"Sync function result: {result}")

    # Verify the data in the database
    with Session(engine) as session:
        start_date = date(2025, 7, 1)
        statement = select(Ndx1m).where(Ndx1m.timestamp >= start_date)
        results = session.exec(statement).all()
        
        print(f"Found {len(results)} records in the database for {test_date}.")
        if len(results) > 0:
            print("Sample record:", results[0])
            print("Data sync verification successful!")
        else:
            print("Data sync verification FAILED. No data found in DB.")

    print("--- Test Finished ---")

if __name__ == "__main__":
    run_test()