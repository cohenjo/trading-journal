import os
import sys
from datetime import date, datetime

from dotenv import load_dotenv
from sqlalchemy import select
from sqlmodel import Session, create_engine

# Add the project root to the Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.schema.models import MatchedTrade, Trade

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable not set")

engine = create_engine(DATABASE_URL)


def get_trades_by_date(session: Session, trade_date: date) -> list[Trade]:
    statement = select(Trade).where(Trade.tradeDate == trade_date)
    trades = session.exec(statement).scalars().all()
    return trades


def match_trades(trades: list[Trade]) -> list[MatchedTrade]:
    """
    Matches opening and closing trades from a list of trades.
    """
    matched_trades = []
    unmatched_opens = {}

    # Separate trades by symbol
    trades_by_symbol = {}
    for trade in trades:
        if trade.symbol not in trades_by_symbol:
            trades_by_symbol[trade.symbol] = []
        trades_by_symbol[trade.symbol].append(trade)

    for symbol, symbol_trades in trades_by_symbol.items():
        opens = sorted([t for t in symbol_trades if t.openCloseIndicator == 'O' and t.dateTime is not None], key=lambda x: x.dateTime)
        closes = sorted([t for t in symbol_trades if t.openCloseIndicator == 'C' and t.dateTime is not None], key=lambda x: x.dateTime)

        for open_trade in opens:
            open_qty = open_trade.quantity
            
            # Find a corresponding close
            for close_trade in closes:
                if close_trade.quantity == -open_qty and open_trade.transactionID and close_trade.transactionID and open_trade.dateTime and close_trade.dateTime:
                    matched = MatchedTrade(
                        symbol=symbol,
                        open_transaction_id=open_trade.transactionID,
                        open_date=open_trade.dateTime,
                        close_transaction_id=close_trade.transactionID,
                        close_date=close_trade.dateTime,
                        open_price=open_trade.tradePrice,
                        close_price=close_trade.tradePrice,
                        pnl=close_trade.fifoPnlRealized,
                    )
                    matched_trades.append(matched)
                    closes.remove(close_trade) # Avoid reusing the same close
                    break # Move to the next open trade

    return matched_trades


def main():
    if len(sys.argv) > 1:
        try:
            trade_date_str = sys.argv[1]
            trade_date = datetime.strptime(trade_date_str, "%Y-%m-%d").date()
        except ValueError:
            print("Please use the format YYYY-MM-DD for the date.")
            sys.exit(1)
    else:
        trade_date = date.today()

    with Session(engine) as session:
        trades_on_date = get_trades_by_date(session, trade_date)
        
        print(f"Found {len(trades_on_date)} trades for {trade_date}")

        matched_trades = match_trades(trades_on_date)
        
        if not matched_trades:
            print("No new matched trades found.")
            return

        print(f"Found {len(matched_trades)} matched trades. Storing to database.")
        for matched_trade in matched_trades:
            session.add(matched_trade)
        
        session.commit()
        print("Matched trades stored successfully.")


if __name__ == "__main__":
    main()
