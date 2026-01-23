from sqlalchemy import create_engine, inspect
from app.dal.database import DATABASE_URL
import os

# Ensure we are in the right directory or have the right path context
# Assuming run from apps/backend

def inspect_db():
    print(f"Connecting to {DATABASE_URL}")
    engine = create_engine(DATABASE_URL)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print("Tables found:", tables)
    
    if "finance_snapshots" in tables:
        print("\nColumns in finance_snapshots:")
        for col in inspector.get_columns("finance_snapshots"):
            print(f"- {col['name']}: {col['type']}")
    else:
        print("\nfinance_snapshots table NOT found!")

if __name__ == "__main__":
    inspect_db()
