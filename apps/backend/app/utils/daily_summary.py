import os
import sys
import calendar
from datetime import date, datetime

from dotenv import load_dotenv
from sqlalchemy import select, func
from sqlmodel import Session, create_engine

# Add the project root to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.schema.models import MatchedTrade, DailySummary

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set")

engine = create_engine(DATABASE_URL)


def get_matched_trades_by_date(session: Session, trade_date: date) -> list[MatchedTrade]:
    statement = select(MatchedTrade).where(func.date(MatchedTrade.close_date) == trade_date)
    trades = session.exec(statement).scalars().all()
    return trades


def calculate_daily_summary(trades: list[MatchedTrade]) -> dict:
    """
    Calculates the daily summary from a list of matched trades.
    """
    if not trades:
        return {
            "total_pnl": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "win_rate": 0,
            "avg_win": 0,
            "avg_loss": 0,
        }

    total_pnl = sum(trade.pnl for trade in trades)
    winning_trades = [trade for trade in trades if trade.pnl > 0]
    losing_trades = [trade for trade in trades if trade.pnl <= 0]

    win_count = len(winning_trades)
    loss_count = len(losing_trades)
    total_trades = win_count + loss_count

    win_rate = win_count / total_trades if total_trades > 0 else 0
    avg_win = sum(trade.pnl for trade in winning_trades) / win_count if win_count > 0 else 0
    avg_loss = sum(trade.pnl for trade in losing_trades) / loss_count if loss_count > 0 else 0

    return {
        "total_pnl": total_pnl,
        "winning_trades": win_count,
        "losing_trades": loss_count,
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
    }


def process_single_date(trade_date: date, session: Session):
    matched_trades = get_matched_trades_by_date(session, trade_date)
    
    print(f"Found {len(matched_trades)} matched trades for {trade_date}")

    summary_data = calculate_daily_summary(matched_trades)

    existing_summary = session.get(DailySummary, trade_date)
    
    if existing_summary:
        print(f"Updating existing daily summary for {trade_date}.")
        for key, value in summary_data.items():
            setattr(existing_summary, key, value)
        session.add(existing_summary)
    elif len(matched_trades) > 0:
        print(f"Creating new daily summary for {trade_date}.")
        daily_summary = DailySummary(date=trade_date, **summary_data)
        session.add(daily_summary)
    else:
        print(f"No trades for {trade_date}, skipping summary creation.")

    session.commit()


def main():
    dates_to_process = []
    if len(sys.argv) > 1:
        input_str = sys.argv[1]
        try:
            trade_date = datetime.strptime(input_str, "%Y-%m-%d").date()
            dates_to_process.append(trade_date)
        except ValueError:
            try:
                year_month = datetime.strptime(input_str, "%Y-%m")
                year, month = year_month.year, year_month.month
                num_days = calendar.monthrange(year, month)[1]
                for day in range(1, num_days + 1):
                    dates_to_process.append(date(year, month, day))
            except ValueError:
                print("Please use the format YYYY-MM-DD for a single day or YYYY-MM for a month.")
                sys.exit(1)
    else:
        dates_to_process.append(date.today())

    with Session(engine) as session:
        for trade_date in dates_to_process:
            process_single_date(trade_date, session)
    
    print("Daily summary processing complete.")


if __name__ == "__main__":
    main()