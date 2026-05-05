"""Manual trade entry and IBKR trade endpoints wired to Supabase schema."""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.models import DailySummary, ManualTrade, Trade
from app.services.household_service import get_user_household_id

router = APIRouter()


class ManualTradeCreate(BaseModel):
    """Input schema for creating a manual trade (id and household_id are server-injected)."""

    timestamp: datetime
    symbol: str
    side: str
    size: Decimal
    entry_price: Decimal
    exit_price: Decimal
    pnl: Decimal
    notes: Optional[str] = None


class ManualTradeUpdate(BaseModel):
    """Partial-update schema for manual trades — all fields optional."""

    timestamp: Optional[datetime] = None
    symbol: Optional[str] = None
    side: Optional[str] = None
    size: Optional[Decimal] = None
    entry_price: Optional[Decimal] = None
    exit_price: Optional[Decimal] = None
    pnl: Optional[Decimal] = None
    notes: Optional[str] = None


def _get_household_or_403(session: Session, user_id: UUID) -> UUID:
    """Return the user household_id or raise HTTP 403."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not associated with any household",
        )
    return household_id


def _get_manual_trade_or_404(session: Session, trade_id: int, household_id: UUID) -> ManualTrade:
    """Return the manual trade owned by the household or raise HTTP 404."""
    trade = session.exec(
        select(ManualTrade).where(ManualTrade.id == trade_id).where(ManualTrade.household_id == household_id)
    ).first()
    if trade is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ManualTrade {trade_id} not found",
        )
    return trade


@router.post(
    "/manual-trades",
    response_model=ManualTrade,
    status_code=status.HTTP_201_CREATED,
    tags=["manual-trades"],
)
def create_manual_trade(
    payload: ManualTradeCreate,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> ManualTrade:
    """Create a manual trade scoped to the authenticated user household."""
    household_id = _get_household_or_403(session, user_id)
    trade = ManualTrade(
        household_id=household_id,
        timestamp=payload.timestamp,
        symbol=payload.symbol,
        side=payload.side,
        size=payload.size,
        entry_price=payload.entry_price,
        exit_price=payload.exit_price,
        pnl=payload.pnl,
        notes=payload.notes,
    )
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade


@router.get(
    "/manual-trades",
    response_model=List[ManualTrade],
    tags=["manual-trades"],
)
def list_manual_trades(
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> List[ManualTrade]:
    """List all manual trades for the authenticated user household."""
    household_id = _get_household_or_403(session, user_id)
    return list(
        session.exec(
            select(ManualTrade).where(ManualTrade.household_id == household_id).order_by(ManualTrade.timestamp.desc())  # type: ignore[attr-defined]
        ).all()
    )


@router.get(
    "/manual-trades/{trade_id}",
    response_model=ManualTrade,
    tags=["manual-trades"],
)
def get_manual_trade(
    trade_id: int,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> ManualTrade:
    """Retrieve a single manual trade by ID."""
    household_id = _get_household_or_403(session, user_id)
    return _get_manual_trade_or_404(session, trade_id, household_id)


@router.put(
    "/manual-trades/{trade_id}",
    response_model=ManualTrade,
    tags=["manual-trades"],
)
def update_manual_trade(
    trade_id: int,
    payload: ManualTradeUpdate,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> ManualTrade:
    """Partial-update a manual trade."""
    household_id = _get_household_or_403(session, user_id)
    trade = _get_manual_trade_or_404(session, trade_id, household_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trade, field, value)
    session.add(trade)
    session.commit()
    session.refresh(trade)
    return trade


@router.delete(
    "/manual-trades/{trade_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["manual-trades"],
)
def delete_manual_trade(
    trade_id: int,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> None:
    """Delete a manual trade."""
    household_id = _get_household_or_403(session, user_id)
    trade = _get_manual_trade_or_404(session, trade_id, household_id)
    session.delete(trade)
    session.commit()


@router.post(
    "/trades",
    response_model=Trade,
    deprecated=True,
    tags=["trades"],
    description=(
        "**Deprecated** — kept for the IBKR import pipeline. Use POST /api/manual-trades for manual trade entry."
    ),
)
def create_trade(
    trade: Trade,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> Trade:
    """Create an IBKR-sourced Trade record and recalculate the daily summary.

    .. deprecated:: injects household_id; use POST /api/manual-trades for manual entry.
    """
    if not trade.dateTime:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trade dateTime cannot be null",
        )

    household_id = _get_household_or_403(session, user_id)
    trade.household_id = household_id

    # SQLModel table models may deserialize datetime fields as strings in some
    # environments (e.g. SQLite). Coerce to datetime before inserting.
    if isinstance(trade.dateTime, str):
        trade.dateTime = datetime.fromisoformat(trade.dateTime)
    trade_date = trade.dateTime.date()
    session.add(trade)
    session.commit()
    session.refresh(trade)

    trades_statement = (
        select(Trade)
        .where(Trade.household_id == household_id)
        .where(Trade.dateTime >= trade_date)
        .where(Trade.dateTime < trade_date + timedelta(days=1))
    )
    trades = list(session.exec(trades_statement).all())

    total_pnl = sum(t.fifoPnlRealized for t in trades)
    winning_trades = sum(1 for t in trades if t.fifoPnlRealized > 0)
    losing_trades = sum(1 for t in trades if t.fifoPnlRealized <= 0)
    total_trades = winning_trades + losing_trades
    win_rate = Decimal(winning_trades) / Decimal(total_trades) if total_trades > 0 else Decimal(0)

    winning_pnls = [t.fifoPnlRealized for t in trades if t.fifoPnlRealized > 0]
    losing_pnls = [t.fifoPnlRealized for t in trades if t.fifoPnlRealized <= 0]
    avg_win = sum(winning_pnls) / len(winning_pnls) if winning_pnls else Decimal(0)
    avg_loss = sum(losing_pnls) / len(losing_pnls) if losing_pnls else Decimal(0)

    summary_statement = (
        select(DailySummary).where(DailySummary.household_id == household_id).where(DailySummary.date == trade_date)
    )
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
            household_id=household_id,
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
