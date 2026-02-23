from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from typing import List, Dict, Any, Optional
from app.dal.database import get_session
from app.schema.trading_models import TradingAccountConfig, TradingAccountSummary, TradingPosition
from app.services.trading_service import trading_service
from pydantic import BaseModel

router = APIRouter(prefix="/api/trading", tags=["trading"])

class ConfigUpdate(BaseModel):
    id: Optional[int] = None
    name: str
    account_type: str
    host: Optional[str] = None
    port: Optional[int] = None
    client_id: Optional[int] = None
    app_key: Optional[str] = None
    app_secret: Optional[str] = None
    account_hash: Optional[str] = None
    tokens_path: Optional[str] = None
    linked_account_id: Optional[str] = None

@router.get("/configs", response_model=List[TradingAccountConfig])
def get_configs(session: Session = Depends(get_session)):
    return session.exec(select(TradingAccountConfig)).all()

@router.get("/config", response_model=Optional[TradingAccountConfig])
def get_config(id: Optional[int] = None, session: Session = Depends(get_session)):
    if id:
        return session.get(TradingAccountConfig, id)
    return session.exec(select(TradingAccountConfig)).first()

@router.post("/config", response_model=TradingAccountConfig)
def update_config(config_data: ConfigUpdate, session: Session = Depends(get_session)):
    config = None
    if config_data.id:
        config = session.get(TradingAccountConfig, config_data.id)
    
    if not config:
        config = TradingAccountConfig(**config_data.model_dump(exclude={'id'}))
    else:
        for key, value in config_data.model_dump(exclude={'id'}).items():
            setattr(config, key, value)
    
    session.add(config)
    session.commit()
    session.refresh(config)
    return config

@router.post("/sync")
async def sync_account(account_id: Optional[int] = None, session: Session = Depends(get_session)):
    """
    Triggers a live sync with a broker and stores results in DB.
    """
    try:
        return await trading_service.sync_account(session, config_id=account_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary", response_model=Optional[TradingAccountSummary])
def get_latest_summary(account_id: Optional[int] = None, session: Session = Depends(get_session)):
    statement = select(TradingAccountSummary)
    if account_id:
        statement = statement.where(TradingAccountSummary.account_config_id == account_id)
    statement = statement.order_by(TradingAccountSummary.timestamp.desc()).limit(1)
    return session.exec(statement).first()

@router.get("/positions", response_model=List[TradingPosition])
def get_latest_positions(account_id: Optional[int] = None, session: Session = Depends(get_session)):
    statement = select(TradingPosition)
    if account_id:
        statement = statement.where(TradingPosition.account_config_id == account_id)
    return session.exec(statement).all()

@router.post("/sync-to-dividends")
async def sync_to_dividends(session: Session = Depends(get_session)):
    """
    Propagates data from all trading accounts to the dividend dashboard.
    """
    try:
        return await trading_service.sync_to_dividends(session)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
