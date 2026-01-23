from sqlalchemy import create_engine, text
from app.dal.database import DATABASE_URL

def check_data():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT count(*) FROM finance_snapshots"))
        print(f"Count: {result.scalar()}")

if __name__ == "__main__":
    check_data()
