from uuid import UUID
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import text
from sqlmodel import Session, select
from typing import List, Literal, Optional
from app.core.config import settings
from app.dal.database import get_session
from app.dependencies import get_current_user_id
from app.schema.trading_models import TradingAccountConfig, TradingAccountSummary, TradingPosition
from app.services.trading_service import trading_service
from app.services.household_service import get_user_household_id
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
    """List all trading account configurations."""
    return session.exec(select(TradingAccountConfig)).all()


@router.get("/config", response_model=Optional[TradingAccountConfig])
def get_config(id: Optional[int] = None, session: Session = Depends(get_session)):
    """Get a trading account config by ID, or the first available."""
    if id:
        return session.get(TradingAccountConfig, id)
    return session.exec(select(TradingAccountConfig)).first()


@router.post("/config", response_model=TradingAccountConfig)
def update_config(config_data: ConfigUpdate, session: Session = Depends(get_session)):
    """Create or update a trading account configuration."""
    config = None
    if config_data.id:
        config = session.get(TradingAccountConfig, config_data.id)

    if not config:
        config = TradingAccountConfig(**config_data.model_dump(exclude={"id"}))
    else:
        for key, value in config_data.model_dump(exclude={"id"}).items():
            setattr(config, key, value)

    session.add(config)
    session.commit()
    session.refresh(config)
    return config


@router.post("/sync", deprecated=True)
async def sync_account(
    account_id: Optional[int] = None,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """
    Triggers a live sync with a broker and stores results in DB.
    """
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    try:
        return await trading_service.sync_account(session, household_id, config_id=account_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/summary", response_model=Optional[TradingAccountSummary])
def get_latest_summary(
    account_id: Optional[int] = None,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """Return the most recent trading account summary for the authenticated user's household."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    statement = select(TradingAccountSummary).where(TradingAccountSummary.household_id == household_id)
    if account_id:
        statement = statement.where(TradingAccountSummary.account_config_id == account_id)
    statement = statement.order_by(TradingAccountSummary.timestamp.desc()).limit(1)
    return session.exec(statement).first()


@router.get("/positions", response_model=List[TradingPosition])
def get_latest_positions(
    account_id: Optional[int] = None,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
):
    """List current trading positions for the authenticated user's household, optionally filtered by account."""
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    statement = select(TradingPosition).where(TradingPosition.household_id == household_id)
    if account_id:
        statement = statement.where(TradingPosition.account_config_id == account_id)
    return session.exec(statement).all()


@router.post("/sync-to-dividends")
async def sync_to_dividends(user_id: UUID = Depends(get_current_user_id), session: Session = Depends(get_session)):
    """
    Propagates data from all trading accounts to the dividend dashboard.
    """
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    try:
        return await trading_service.sync_to_dividends(session, household_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Manual Flex Refresh
# ---------------------------------------------------------------------------


class RefreshAccountResponse(BaseModel):
    """Response for POST /api/trading/accounts/{config_id}/refresh.

    ``status`` discriminates between two non-error outcomes:
    - ``"queued"``    — request written; worker will process within 5 min.
    - ``"throttled"`` — last sync was too recent; try again later.
    """

    status: Literal["queued", "throttled"]
    last_synced_at: Optional[datetime]
    next_eligible_at: Optional[datetime]


@router.post("/accounts/{config_id}/refresh", response_model=RefreshAccountResponse)
def refresh_account(
    config_id: int,
    user_id: UUID = Depends(get_current_user_id),
    session: Session = Depends(get_session),
) -> RefreshAccountResponse:
    """Queue a manual Flex data refresh for the given IBKR account.

    Applies a throttle gate: if the last successful sync was less than
    ``FLEX_REFRESH_THROTTLE_SECONDS`` ago (default 1 hour), returns
    ``status="throttled"`` with ``next_eligible_at`` so the frontend can
    show a countdown.  In all success cases the HTTP status is **200 OK**.

    Args:
        config_id: ``trading_account_config.id`` to refresh.
        user_id: Injected from the bearer token by ``get_current_user_id``.
        session: Database session injected by ``get_session``.

    Returns:
        :class:`RefreshAccountResponse` with ``status`` discriminator.

    Raises:
        HTTPException 403: Authenticated user does not own this account.
        HTTPException 404: Config not found or soft-deleted.
    """
    household_id = get_user_household_id(session, user_id)
    if not household_id:
        raise HTTPException(status_code=403, detail="User not associated with any household")

    # Verify ownership — 404 for missing/soft-deleted, 403 for wrong household
    config_row = session.execute(
        text(
            """
            SELECT id, household_id, account_id
              FROM public.trading_account_config
             WHERE id = :config_id
               AND deleted_at IS NULL
            """
        ),
        {"config_id": config_id},
    ).first()

    if config_row is None:
        raise HTTPException(status_code=404, detail="Account config not found")

    if str(config_row.household_id) != str(household_id):
        raise HTTPException(status_code=403, detail="Account does not belong to your household")

    account_id: str | None = config_row.account_id

    # ------------------------------------------------------------------
    # Read last_sync_at from options_flex_sync_state for throttle check
    # ------------------------------------------------------------------
    sync_row = session.execute(
        text(
            """
            SELECT last_sync_at
              FROM public.options_flex_sync_state
             WHERE household_id = :hid
               AND account_id   = :aid
               AND query_name   = 'all'
            """
        ),
        {"hid": str(household_id), "aid": account_id},
    ).first()

    last_synced_at: datetime | None = None
    if sync_row is not None:
        # Access by column name — works with real SQLAlchemy Rows and test fakes
        raw_ts: datetime | None = getattr(sync_row, "last_sync_at", None)
        if raw_ts is None and hasattr(sync_row, "__getitem__"):
            try:
                raw_ts = sync_row["last_sync_at"]  # type: ignore[assignment]
            except (KeyError, TypeError):
                raw_ts = None
        if raw_ts is not None:
            last_synced_at = raw_ts if raw_ts.tzinfo else raw_ts.replace(tzinfo=timezone.utc)

    # ------------------------------------------------------------------
    # Throttle check
    # ------------------------------------------------------------------
    throttle_seconds = settings.flex_refresh_throttle_seconds
    now = datetime.now(timezone.utc)

    if last_synced_at is not None:
        elapsed = (now - last_synced_at).total_seconds()
        if elapsed < throttle_seconds:
            next_eligible_at = last_synced_at + timedelta(seconds=throttle_seconds)
            return RefreshAccountResponse(
                status="throttled",
                last_synced_at=last_synced_at,
                next_eligible_at=next_eligible_at,
            )

    # ------------------------------------------------------------------
    # Queue the refresh (idempotent — last click wins)
    # ------------------------------------------------------------------
    session.execute(
        text(
            """
            UPDATE public.trading_account_config
               SET refresh_requested_at = now()
             WHERE id = :config_id
            """
        ),
        {"config_id": config_id},
    )
    session.commit()

    return RefreshAccountResponse(
        status="queued",
        last_synced_at=last_synced_at,
        next_eligible_at=None,
    )
