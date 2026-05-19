"""Worker handler: poll for pending manual Flex refresh requests.

Every 5 minutes the scheduler calls :func:`run_flex_refresh_poll`.  It finds
``trading_account_config`` rows where ``refresh_requested_at IS NOT NULL``,
applies the throttle gate (same 1-hour window as the endpoint), dispatches
:func:`~app.worker.handlers.options_sync.run_flex_options_sync` for each
eligible account, and clears the flag.

Design reference:
    ``.squad/decisions/inbox/keaton-refresh-button-design-2026-05-19.md``
    Section C — Worker Poll.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlmodel import Session

from app.core.config import settings
from app.dal.database import engine

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry-point (registered in registry.py)
# ---------------------------------------------------------------------------


def run_flex_refresh_poll() -> None:
    """Check for pending manual refresh requests and dispatch Flex sync.

    - Uses ``FOR UPDATE OF c SKIP LOCKED`` so overlapping poll instances
      never double-process the same account.
    - Commits per-account so one failure cannot roll back others.
    - On sync failure: logs the exception, clears the flag anyway (avoids
      infinite retry), leaves ``last_sync_at`` unchanged.
    - Re-checks the throttle inside the worker as defence-in-depth (handles
      the case where a nightly cron ran between the user's click and this poll).
    """
    # Import here to avoid circular imports at module load time
    from app.worker.handlers.options_sync import run_flex_options_sync

    throttle_seconds = settings.flex_refresh_throttle_seconds

    with Session(engine) as session:
        pending = (
            session.execute(
                text(
                    """
                SELECT c.id,
                       c.household_id::text AS household_id,
                       c.account_id,
                       c.refresh_requested_at
                  FROM public.trading_account_config c
                  LEFT JOIN public.households h
                         ON h.id = c.household_id
                        AND h.deleted_at IS NULL
                 WHERE c.refresh_requested_at IS NOT NULL
                   AND c.deleted_at IS NULL
                   AND h.id IS NOT NULL
                 ORDER BY c.refresh_requested_at ASC
                   FOR UPDATE OF c SKIP LOCKED
                """
                )
            )
            .mappings()
            .all()
        )

        for row in pending:
            config_id: int = row["id"]
            account_id: str | None = row["account_id"]
            household_id: str = row["household_id"]

            last_sync = _get_last_sync_at(session, household_id, account_id)

            if last_sync is not None:
                elapsed = (datetime.now(timezone.utc) - last_sync).total_seconds()
                if elapsed < throttle_seconds:
                    logger.info(
                        "flex_refresh_poll: throttled config_id=%s account_id=%s (last_sync=%s elapsed=%.0fs < %ss)",
                        config_id,
                        account_id,
                        last_sync.isoformat(),
                        elapsed,
                        throttle_seconds,
                    )
                    # Leave the request in place; the next poll will re-check.
                    continue

            logger.info(
                "flex_refresh_poll: dispatching sync for config_id=%s account_id=%s",
                config_id,
                account_id,
            )
            try:
                run_flex_options_sync(session, account_id=account_id)
            except Exception:
                logger.exception(
                    "flex_refresh_poll: sync failed for config_id=%s account_id=%s — "
                    "clearing flag to avoid infinite retry",
                    config_id,
                    account_id,
                )
            finally:
                # Always clear the flag — success or failure.
                session.execute(
                    text(
                        """
                        UPDATE public.trading_account_config
                           SET refresh_requested_at = NULL
                         WHERE id = :config_id
                        """
                    ),
                    {"config_id": config_id},
                )
                session.commit()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_last_sync_at(
    session: Session,
    household_id: str,
    account_id: str | None,
) -> datetime | None:
    """Return ``last_sync_at`` from ``options_flex_sync_state`` for this account.

    Filters on ``query_name = 'all'`` per the design spec.  Returns ``None``
    if no row exists (new account — allow immediately).
    """
    row = session.execute(
        text(
            """
            SELECT last_sync_at
              FROM public.options_flex_sync_state
             WHERE household_id = :hid
               AND account_id   = :aid
               AND query_name   = 'all'
            """
        ),
        {"hid": household_id, "aid": account_id},
    ).first()
    if row is None:
        return None
    ts: datetime | None = getattr(row, "last_sync_at", None)
    if ts is None and hasattr(row, "__getitem__"):
        try:
            ts = row["last_sync_at"]  # type: ignore[assignment]
        except (KeyError, TypeError):
            ts = None
    if ts is None:
        return None
    # Ensure timezone-aware (Postgres returns tz-aware; SQLite may not)
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts
