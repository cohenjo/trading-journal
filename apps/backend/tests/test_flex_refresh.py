"""Tests for the manual Flex refresh endpoint and worker poll job.

Covers all 10 items from the design spec (Section G):

  1. Endpoint queues request — 200 queued + DB has refresh_requested_at
  2. Endpoint throttles when within 1 hour — 200 throttled with next_eligible_at
  3. Endpoint returns 403 for unowned account
  4. Endpoint returns 404 for soft-deleted account
  5. Idempotent multi-click — only one row updated (latest timestamp)
  6. Worker picks up pending request and triggers sync
  7. Worker respects throttle (no sync, flag left in place)
  8. Worker skips orphaned households
  9. Worker clears flag on sync failure
  10. Nightly interaction — pending flag cleared after nightly advances last_sync_at

Design reference:
    ``.squad/decisions/inbox/keaton-refresh-button-design-2026-05-19.md``
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.api.trading import RefreshAccountResponse, refresh_account

# ---------------------------------------------------------------------------
# Shared constants (mirror conftest.py)
# ---------------------------------------------------------------------------

TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")
TEST_HOUSEHOLD_STR = str(TEST_HOUSEHOLD_ID)

OTHER_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000202")

CONFIG_ID = 42
ACCOUNT_ID = "U1234567"

# ---------------------------------------------------------------------------
# Fake helpers — endpoint tests
# ---------------------------------------------------------------------------


class _Row(Mapping):
    """Dict-backed row that supports both key access and attribute access."""

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __getattr__(self, key: str) -> Any:
        try:
            return self._data[key]
        except KeyError as exc:
            raise AttributeError(key) from exc

    def __iter__(self):
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)


class _FakeResult:
    """Minimal SQLAlchemy result fake."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = [_Row(r) for r in rows]

    def first(self) -> _Row | None:
        return self._rows[0] if self._rows else None


class _EndpointSession:
    """Fake session for refresh_account endpoint tests.

    Intercepts the two ``text()`` SELECT calls and the UPDATE by matching
    SQL sub-strings, returning caller-configured rows.
    """

    def __init__(
        self,
        *,
        config_row: dict[str, Any] | None = None,
        last_sync_at: datetime | None = None,
    ) -> None:
        self._config_row = config_row
        self._last_sync_at = last_sync_at
        self.committed = False
        self.update_calls: list[dict[str, Any]] = []

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> _FakeResult:
        sql = str(statement).lower()
        params = params or {}

        # Config ownership lookup
        if "from public.trading_account_config" in sql and "deleted_at is null" in sql:
            rows = [self._config_row] if self._config_row else []
            return _FakeResult(rows)

        # Sync-state throttle lookup
        if "from public.options_flex_sync_state" in sql:
            if self._last_sync_at is not None:
                return _FakeResult([{"last_sync_at": self._last_sync_at}])
            return _FakeResult([])

        # Queue the request
        if "update public.trading_account_config" in sql and "refresh_requested_at" in sql:
            self.update_calls.append(params)
            return _FakeResult([])

        return _FakeResult([])

    def commit(self) -> None:
        self.committed = True


def _config(household_id: str = TEST_HOUSEHOLD_STR) -> dict[str, Any]:
    """Return a minimal trading_account_config row dict."""
    return {
        "id": CONFIG_ID,
        "household_id": household_id,
        "account_id": ACCOUNT_ID,
    }


# ---------------------------------------------------------------------------
# 1. Endpoint queues request — 200 queued, refresh_requested_at written
# ---------------------------------------------------------------------------


def test_endpoint_queues_request_returns_queued() -> None:
    """POST with a valid, owned config and no recent sync → 200 queued."""
    session = _EndpointSession(config_row=_config(), last_sync_at=None)

    with patch("app.api.trading.get_user_household_id", return_value=TEST_HOUSEHOLD_ID):
        result = refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session)

    assert isinstance(result, RefreshAccountResponse)
    assert result.status == "queued"
    assert result.next_eligible_at is None
    # The DB UPDATE must have been issued
    assert len(session.update_calls) == 1
    assert session.update_calls[0].get("config_id") == CONFIG_ID
    assert session.committed


# ---------------------------------------------------------------------------
# 2. Endpoint throttles when last sync was < 1 hour ago
# ---------------------------------------------------------------------------


def test_endpoint_throttles_within_one_hour() -> None:
    """POST when last sync was 30 minutes ago → 200 throttled with next_eligible_at."""
    recent_sync = datetime.now(timezone.utc) - timedelta(minutes=30)
    session = _EndpointSession(config_row=_config(), last_sync_at=recent_sync)

    with patch("app.api.trading.get_user_household_id", return_value=TEST_HOUSEHOLD_ID):
        with patch("app.api.trading.settings") as mock_settings:
            mock_settings.flex_refresh_throttle_seconds = 3600
            result = refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session)

    assert result.status == "throttled"
    assert result.last_synced_at is not None
    assert result.next_eligible_at is not None
    # next_eligible_at ≈ last_synced_at + 1 h
    delta = (result.next_eligible_at - result.last_synced_at).total_seconds()
    assert abs(delta - 3600) < 2
    # Must NOT have written the UPDATE
    assert len(session.update_calls) == 0


# ---------------------------------------------------------------------------
# 3. Endpoint returns 403 for unowned account
# ---------------------------------------------------------------------------


def test_endpoint_returns_403_for_unowned_account() -> None:
    """Config belongs to a different household → 403."""
    other_config = _config(household_id=str(OTHER_HOUSEHOLD_ID))
    session = _EndpointSession(config_row=other_config)

    with patch("app.api.trading.get_user_household_id", return_value=TEST_HOUSEHOLD_ID):
        with pytest.raises(HTTPException) as exc_info:
            refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session)

    assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# 4. Endpoint returns 404 for soft-deleted / missing account
# ---------------------------------------------------------------------------


def test_endpoint_returns_404_for_missing_account() -> None:
    """Config not found (deleted or nonexistent) → 404."""
    session = _EndpointSession(config_row=None)  # no row returned

    with patch("app.api.trading.get_user_household_id", return_value=TEST_HOUSEHOLD_ID):
        with pytest.raises(HTTPException) as exc_info:
            refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session)

    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# 5. Idempotent multi-click — latest timestamp wins, single UPDATE per call
# ---------------------------------------------------------------------------


def test_endpoint_idempotent_multiple_clicks() -> None:
    """Two rapid POSTs each issue their own UPDATE; last click's timestamp wins.

    The endpoint does ``SET refresh_requested_at = now()`` unconditionally,
    so each click overwrites the previous value — no queue accumulation.
    """
    session1 = _EndpointSession(config_row=_config(), last_sync_at=None)
    session2 = _EndpointSession(config_row=_config(), last_sync_at=None)

    with patch("app.api.trading.get_user_household_id", return_value=TEST_HOUSEHOLD_ID):
        r1 = refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session1)
        r2 = refresh_account(config_id=CONFIG_ID, user_id=TEST_USER_ID, session=session2)

    # Both succeed as queued
    assert r1.status == "queued"
    assert r2.status == "queued"
    # Each session issued exactly one UPDATE (last click overwrites)
    assert len(session1.update_calls) == 1
    assert len(session2.update_calls) == 1


# ---------------------------------------------------------------------------
# Fake helpers — worker tests
# ---------------------------------------------------------------------------


class _FakeWorkerMappings:
    """Mappings wrapper for worker FakeSession."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> "_FakeWorkerMappings":
        return self

    def all(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def first(self) -> Any:
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)


class _WorkerSession:
    """Fake session for run_flex_refresh_poll worker tests.

    Configurable pending rows and sync-state rows.  Records UPDATE and
    commit calls for assertions.
    """

    def __init__(
        self,
        *,
        pending_rows: list[dict[str, Any]] | None = None,
        last_sync_at: datetime | None = None,
    ) -> None:
        self._pending_rows = pending_rows or []
        self._last_sync_at = last_sync_at
        self.flag_cleared: list[int] = []  # config_ids whose flag was cleared
        self.commit_count = 0

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> _FakeWorkerMappings:
        sql = str(statement).lower()
        params = params or {}

        # Pending config poll (FOR UPDATE … SKIP LOCKED)
        if (
            "where c.refresh_requested_at is not null" in sql or "refresh_requested_at is not null" in sql
        ) and "select" in sql:
            return _FakeWorkerMappings(self._pending_rows)

        # last_sync_at lookup
        if "from public.options_flex_sync_state" in sql:
            if self._last_sync_at is not None:
                return _FakeWorkerMappings([{"last_sync_at": self._last_sync_at}])
            return _FakeWorkerMappings([])

        # Clear refresh_requested_at
        if "set refresh_requested_at = null" in sql:
            cfg_id = params.get("config_id")
            if cfg_id is not None:
                self.flag_cleared.append(int(cfg_id))
            return _FakeWorkerMappings([])

        return _FakeWorkerMappings([])

    def commit(self) -> None:
        self.commit_count += 1

    def __enter__(self) -> "_WorkerSession":
        return self

    def __exit__(self, *args: object) -> bool:
        return False


def _pending_row(
    *,
    config_id: int = CONFIG_ID,
    household_id: str = TEST_HOUSEHOLD_STR,
    account_id: str = ACCOUNT_ID,
) -> dict[str, Any]:
    return {
        "id": config_id,
        "household_id": household_id,
        "account_id": account_id,
        "refresh_requested_at": datetime.now(timezone.utc) - timedelta(seconds=10),
    }


# ---------------------------------------------------------------------------
# 6. Worker picks up pending request and triggers sync
# ---------------------------------------------------------------------------


def test_worker_picks_up_pending_and_triggers_sync() -> None:
    """Poll finds pending row → calls run_flex_options_sync → clears flag."""
    from app.worker.handlers.flex_refresh import run_flex_refresh_poll

    session = _WorkerSession(
        pending_rows=[_pending_row()],
        last_sync_at=None,  # no prior sync → eligible immediately
    )

    with patch("app.worker.handlers.flex_refresh.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__ = lambda s, *_: session
        mock_session_cls.return_value.__exit__ = lambda s, *_: False

        with patch("app.worker.handlers.options_sync.run_flex_options_sync") as mock_sync:
            run_flex_refresh_poll()

    mock_sync.assert_called_once_with(session, account_id=ACCOUNT_ID)
    assert CONFIG_ID in session.flag_cleared
    assert session.commit_count == 1


# ---------------------------------------------------------------------------
# 7. Worker respects throttle — no sync, flag stays set
# ---------------------------------------------------------------------------


def test_worker_respects_throttle_no_sync() -> None:
    """Pending row but last sync was 30 min ago → skip sync, leave flag."""
    from app.worker.handlers.flex_refresh import run_flex_refresh_poll

    recent_sync = datetime.now(timezone.utc) - timedelta(minutes=30)
    session = _WorkerSession(
        pending_rows=[_pending_row()],
        last_sync_at=recent_sync,
    )

    with patch("app.worker.handlers.flex_refresh.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__ = lambda s, *_: session
        mock_session_cls.return_value.__exit__ = lambda s, *_: False

        with patch("app.worker.handlers.options_sync.run_flex_options_sync") as mock_sync:
            with patch("app.worker.handlers.flex_refresh.settings") as mock_settings:
                mock_settings.flex_refresh_throttle_seconds = 3600
                run_flex_refresh_poll()

    mock_sync.assert_not_called()
    # Flag must NOT have been cleared
    assert CONFIG_ID not in session.flag_cleared
    assert session.commit_count == 0


# ---------------------------------------------------------------------------
# 8. Worker skips orphaned households
# ---------------------------------------------------------------------------


def test_worker_skips_orphaned_household() -> None:
    """Config whose household is gone is excluded by the JOIN guard → no sync."""
    from app.worker.handlers.flex_refresh import run_flex_refresh_poll

    # The orphan guard (h.id IS NOT NULL) lives in the SQL the worker issues.
    # Simulate it by having the pending-rows query return nothing (the JOIN
    # filters the orphaned row out before it reaches Python).
    session = _WorkerSession(pending_rows=[])  # JOIN excluded the orphan

    with patch("app.worker.handlers.flex_refresh.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__ = lambda s, *_: session
        mock_session_cls.return_value.__exit__ = lambda s, *_: False

        with patch("app.worker.handlers.options_sync.run_flex_options_sync") as mock_sync:
            run_flex_refresh_poll()

    mock_sync.assert_not_called()
    assert session.flag_cleared == []


# ---------------------------------------------------------------------------
# 9. Worker clears flag on sync failure
# ---------------------------------------------------------------------------


def test_worker_clears_flag_on_sync_failure() -> None:
    """run_flex_options_sync raises → flag still cleared, no infinite retry."""
    from app.worker.handlers.flex_refresh import run_flex_refresh_poll

    session = _WorkerSession(
        pending_rows=[_pending_row()],
        last_sync_at=None,
    )

    with patch("app.worker.handlers.flex_refresh.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__ = lambda s, *_: session
        mock_session_cls.return_value.__exit__ = lambda s, *_: False

        with patch(
            "app.worker.handlers.options_sync.run_flex_options_sync",
            side_effect=RuntimeError("IBKR API timeout"),
        ):
            # Must not propagate the exception
            run_flex_refresh_poll()

    # Flag cleared despite the error
    assert CONFIG_ID in session.flag_cleared
    assert session.commit_count == 1


# ---------------------------------------------------------------------------
# 10. Nightly interaction — nightly advances last_sync_at, next poll clears flag
# ---------------------------------------------------------------------------


def test_worker_clears_stale_flag_after_nightly_sync() -> None:
    """Pending flag + last_sync_at = now (nightly ran) → throttle gate satisfied
    after 1 h.  Simulated by setting last_sync_at to > 1 h ago so the *next*
    poll sees a past-eligible timestamp and clears without re-fetching.

    Scenario:
      T-90min  User clicked Refresh → refresh_requested_at set
      T-70min  Nightly cron ran     → last_sync_at = T-70min
      T-0      flex_refresh_poll fires → 70 min > 60 min → eligible → sync + clear

    This test models that final poll.
    """
    from app.worker.handlers.flex_refresh import run_flex_refresh_poll

    # Nightly ran 70 minutes ago — throttle (1 h) is satisfied
    nightly_sync_at = datetime.now(timezone.utc) - timedelta(minutes=70)
    session = _WorkerSession(
        pending_rows=[_pending_row()],
        last_sync_at=nightly_sync_at,
    )

    with patch("app.worker.handlers.flex_refresh.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__ = lambda s, *_: session
        mock_session_cls.return_value.__exit__ = lambda s, *_: False

        with patch("app.worker.handlers.options_sync.run_flex_options_sync") as mock_sync:
            with patch("app.worker.handlers.flex_refresh.settings") as mock_settings:
                mock_settings.flex_refresh_throttle_seconds = 3600
                run_flex_refresh_poll()

    # Poll dispatches sync because 70 min > 60 min threshold
    mock_sync.assert_called_once_with(session, account_id=ACCOUNT_ID)
    assert CONFIG_ID in session.flag_cleared
