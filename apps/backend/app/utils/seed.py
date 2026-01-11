import os
import random
import sys
from datetime import date, timedelta

from sqlmodel import Session

# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))


from app.dal.database import engine, create_db_and_tables
from app.schema.models import DailySummary, Trade, Note


def populate_sample_data():
    # if os.path.exists("database.db"):
    #     os.remove("database.db")
    # create_db_and_tables()
    with Session(engine) as session:
        today = date.today()
        for i in range(30):
            current_date = today - timedelta(days=i)
            # Monday is 0 and Sunday is 6
            if current_date.weekday() < 5:  # Monday to Friday
                total_pnl = random.uniform(-300, 300)
                winning_trades = random.randint(0, 5)
                losing_trades = random.randint(0, 5)

                # Avoid creating a summary if there are no trades
                if winning_trades == 0 and losing_trades == 0:
                    continue

                total_trades = winning_trades + losing_trades
                win_rate = winning_trades / total_trades if total_trades > 0 else 0
                
                # Approximate avg win/loss
                avg_win = random.uniform(50, 150) if winning_trades > 0 else 0
                avg_loss = random.uniform(-150, -50) if losing_trades > 0 else 0

                daily_summary = DailySummary(
                    date=current_date,
                    total_pnl=total_pnl,
                    winning_trades=winning_trades,
                    losing_trades=losing_trades,
                    win_rate=win_rate,
                    avg_win=avg_win,
                    avg_loss=avg_loss,
                )
                session.add(daily_summary)

        session.commit()


if __name__ == "__main__":
    populate_sample_data()