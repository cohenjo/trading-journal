import sys
import os
sys.path.append(os.getcwd())

from sqlmodel import Session, select, create_engine
from app.dal.database import get_session
from app.schema.finance_models import FinanceSnapshot
from datetime import date

# Assuming sqlite for local dev or checking env
# Using the same logic as app.dal.database usually would
# But let's look at app/dal/database.py first to match connection string
# Or just try to import everything and run a query.

from app.dal.database import engine

def test_read():
    print("Testing DB Read...")
    state = "Init"
    try:
        with Session(engine) as session:
            state = "Session Created"
            statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)
            state = "Statement Prepared"
            result = session.exec(statement).first()
            state = "Query Executed"
            print(f"Result: {result}")
            if result:
                 print(f"Result Data Type: {type(result.data)}")
    except Exception as e:
        print(f"Error at [{state}]: {e}")
        import traceback
        traceback.print_exc()

from app.schema.finance_models import FinanceSnapshot, SnapshotData, FinanceItem

def test_controller_logic():
    print("Testing Controller Logic...")
    try:
        # 1. Create Data Object (Simulate Request Body)
        item = FinanceItem(
            id="1", category="Savings", name="Test", value=100.0, type="Savings", owner="You"
        ) # Ensure all required fields
        data = SnapshotData(
            items=[item],
            total_savings=100.0,
            total_investments=0,
            total_assets=0,
            total_liabilities=0,
            net_worth=100.0
        )
        print("Model Created")
        
        # 2. Simulate Dump
        dump = data.model_dump(mode='json')
        print(f"Model Dumped: {dump}")
        
        # 3. Simulate Logic
        snapshot_date = data.date if data.date else date.today()
        # Skip DB part as we tested write separately, or combine?
        # Let's combine slightly
        with Session(engine) as session:
            # Check exist
            statement = select(FinanceSnapshot).where(FinanceSnapshot.date == snapshot_date)
            existing = session.exec(statement).first()
            if existing:
                print("Found existing (should overwrite)")
            else:
                print("Creating new")
                new_snap = FinanceSnapshot(
                    date=snapshot_date,
                    data=dump,
                    net_worth=data.net_worth,
                    total_assets=data.total_assets,
                    total_liabilities=data.total_liabilities
                )
                session.add(new_snap)
                session.commit()
                print("Controller Logic Write Success")
                
                # Cleanup
                session.delete(new_snap)
                session.commit()
                
    except Exception as e:
        print(f"Controller Logic Error: {e}")
        import traceback
        traceback.print_exc()

def test_write():
    # Only verify raw write if needed, controller logic covers it mostly
    pass

if __name__ == "__main__":
    test_read()
    test_controller_logic()
