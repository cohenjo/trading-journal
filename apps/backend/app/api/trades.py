from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from datetime import timedelta
from app.dal.database import get_session
from app.schema.models import Trade, DailySummary

router = APIRouter()

@router.post("/trades", response_model=Trade)
def create_trade(trade: Trade, session: Session = Depends(get_session)):
    if not trade.dateTime:
        raise HTTPException(status_code=422, detail="Trade dateTime cannot be null")
    trade_date = trade.dateTime.date()
    session.add(trade)
    session.commit()
    session.refresh(trade)
 
    # Recalculate the daily summary
    trades_statement = select(Trade).where(Trade.dateTime >= trade_date).where(Trade.dateTime < trade_date + timedelta(days=1))
    trades_results = session.exec(trades_statement)
    trades = trades_results.all()

    total_pnl = sum(t.fifoPnlRealized for t in trades)
    winning_trades = sum(1 for t in trades if t.fifoPnlRealized > 0)
    losing_trades = sum(1 for t in trades if t.fifoPnlRealized <= 0)
    total_trades = winning_trades + losing_trades
    win_rate = winning_trades / total_trades if total_trades > 0 else 0
    
    winning_pnls = [t.fifoPnlRealized for t in trades if t.fifoPnlRealized > 0]
    losing_pnls = [t.fifoPnlRealized for t in trades if t.fifoPnlRealized <= 0]

    avg_win = sum(winning_pnls) / len(winning_pnls) if winning_pnls else 0
    avg_loss = sum(losing_pnls) / len(losing_pnls) if losing_pnls else 0

    summary_statement = select(DailySummary).where(DailySummary.date == trade_date)
    summary = session.exec(summary_statement).first()

    if summary:
        summary.total_pnl = total_pnl
        summary.winning_trades = winning_trades
        summary.losing_trades = losing_trades
        summary.win_rate = win_rate
        summary.avg_win = avg_win
        summary.avg_loss = avg_loss
    else:
        summary = DailySummary(
            date=trade_date,
            total_pnl=total_pnl,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate,
            avg_win=avg_win,
            avg_loss=avg_loss,
        )
    
    session.add(summary)
    session.commit()
    session.refresh(summary)
    return trade
