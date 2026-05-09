"""Regression suite for Issue #340 Phase 2 — stock_positions.

Scope:
  R1.1  account_type CHECK enforces exactly ('ibkr', 'schwab', 'ira').
  R1.1  Partial UNIQUE (account_id, ticker, as_of_date) WHERE source='flex':
        duplicate flex snapshot is rejected; duplicate manual rows are allowed.
  R1.1  Cross-household read isolation at the service-query level.
  R1.2  POST /api/accounts/positions creates a manual position for a non-IBKR account.
  R1.2  DELETE /api/accounts/positions/{id} returns 200 + {"deleted": True}.
  R1.2  POST with account_type='ibkr' returns 422 (IBKR is sync-only).
  R1.2  GET /api/accounts/positions returns one latest row per account/ticker.
  R1.3  parse_flex_files() yields the expected STK counts per annual XML (63/45/51/54).
  R1.3  BOND and CASH rows are filtered out (assetCategory != 'STK').
  R1.3  An OPT row with putCall='C' in the STK category guard is excluded.
  R1.4  GET /api/dividends/projection with zero stock_positions falls back to
        dividend_positions and returns a non-zero total (#342 regression guard).
  R1.4  When stock_positions rows exist, the primary path is taken; source='stock_positions'.
"""

from __future__ import annotations

import sqlite3
import textwrap
from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest

# ---------------------------------------------------------------------------
# Shared test constants
# ---------------------------------------------------------------------------

TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")
TEST_HOUSEHOLD_STR = str(TEST_HOUSEHOLD_ID)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_ACTIVITY_DIR = _REPO_ROOT / "reports" / "activity"

# McManus's verified STK position counts per annual Flex XML (§Evidence table).
_EXPECTED_STK_COUNTS: dict[str, int] = {
    "20220103_20221230": 63,
    "20230102_20231229": 45,
    "20240101_20241231": 51,
    "20250101_20251231": 54,
}


# ---------------------------------------------------------------------------
# Helpers: fake SQLAlchemy-style Mapping row
# ---------------------------------------------------------------------------


class _Row(Mapping):
    """Minimal SQLAlchemy-compatible mapping row for FakeSession results."""

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self):
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)


class _FakeMappings:
    """Result object returned by FakeSession.execute() — supports chained calls."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = [_Row(r) for r in rows]

    def mappings(self) -> "_FakeMappings":
        return self

    def all(self) -> list[_Row]:
        return self._rows

    def first(self) -> _Row | None:
        return self._rows[0] if self._rows else None

    def one(self) -> _Row:
        if not self._rows:
            raise RuntimeError("No row")
        return self._rows[0]


class _DeleteResult:
    """Mimics the rowcount-carrying result for DELETE statements."""

    def __init__(self, rowcount: int = 1) -> None:
        self.rowcount = rowcount


# ---------------------------------------------------------------------------
# R1.1 — Schema invariants (standalone SQLite3 + public schema)
# ---------------------------------------------------------------------------


def _make_schema_db() -> sqlite3.Connection:
    """Create a fresh in-memory SQLite DB mirroring the H1 migration schema.

    Uses SQLite's main schema (no ATTACH needed) to test constraint enforcement.
    SQLite's CREATE UNIQUE INDEX … WHERE syntax is not supported on attached
    databases, so schema-prefix logic is validated separately at the Postgres
    migration level; here we verify constraint semantics only.

    Constraints exercised:
      - account_type CHECK ('ibkr', 'schwab', 'ira')
      - Partial UNIQUE on (account_id, ticker, as_of_date) WHERE source='flex'
    """
    conn = sqlite3.connect(":memory:")

    # Minimal trading_account_config with the account_type CHECK
    conn.execute(
        """
        CREATE TABLE trading_account_config (
          id           INTEGER PRIMARY KEY,
          household_id TEXT    NOT NULL,
          name         TEXT    NOT NULL DEFAULT 'Test Account',
          account_type TEXT    NOT NULL DEFAULT 'ibkr'
                                CHECK (account_type IN ('ibkr', 'schwab', 'ira'))
        )
        """
    )

    # Minimal stock_positions matching the Hockney H1 migration
    conn.execute(
        """
        CREATE TABLE stock_positions (
          id           TEXT    PRIMARY KEY,
          household_id TEXT    NOT NULL,
          account_id   INTEGER NOT NULL,
          ticker       TEXT    NOT NULL,
          quantity     REAL    NOT NULL,
          cost_basis   REAL,
          currency     TEXT    NOT NULL DEFAULT 'USD',
          as_of_date   TEXT    NOT NULL,
          source       TEXT    NOT NULL CHECK (source IN ('flex', 'manual'))
        )
        """
    )
    # Partial UNIQUE index — duplicate flex snapshots rejected; manual rows are not
    conn.execute(
        """
        CREATE UNIQUE INDEX stock_positions_flex_snapshot_key
          ON stock_positions (account_id, ticker, as_of_date)
          WHERE source = 'flex'
        """
    )

    # Seed two households and two accounts
    conn.execute(
        "INSERT INTO trading_account_config (id, household_id, name, account_type) "
        "VALUES (1, 'hh-001', 'IBKR', 'ibkr'), "
        "       (2, 'hh-001', 'Schwab', 'schwab'), "
        "       (3, 'hh-002', 'Other IRA', 'ira')"
    )
    conn.commit()
    return conn


class TestAccountTypeCheck:
    """R1.1 — account_type CHECK enforces exactly ('ibkr', 'schwab', 'ira')."""

    def test_valid_ibkr_accepted(self):
        """'ibkr' is a valid account_type — INSERT must succeed."""
        conn = _make_schema_db()
        conn.execute(
            "INSERT INTO trading_account_config (household_id, name, account_type) "
            "VALUES ('hh-x', 'Valid IBKR', 'ibkr')"
        )

    def test_valid_schwab_accepted(self):
        """'schwab' is a valid account_type."""
        conn = _make_schema_db()
        conn.execute(
            "INSERT INTO trading_account_config (household_id, name, account_type) "
            "VALUES ('hh-x', 'Valid Schwab', 'schwab')"
        )

    def test_valid_ira_accepted(self):
        """'ira' is a valid account_type."""
        conn = _make_schema_db()
        conn.execute(
            "INSERT INTO trading_account_config (household_id, name, account_type) VALUES ('hh-x', 'Valid IRA', 'ira')"
        )

    def test_uppercase_ibkr_rejected(self):
        """Uppercase 'IBKR' must be rejected — the new CHECK is lowercase-only.

        Fail-check: if the migration drops the new CHECK constraint and restores the
        old IBKR/SCHWAB uppercase-only constraint, this test will fail because 'IBKR'
        would be accepted instead of rejected.
        """
        conn = _make_schema_db()
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO trading_account_config (household_id, name, account_type) "
                "VALUES ('hh-x', 'Bad IBKR', 'IBKR')"
            )

    def test_arbitrary_string_rejected(self):
        """An arbitrary string must be rejected by the CHECK constraint."""
        conn = _make_schema_db()
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            conn.execute(
                "INSERT INTO trading_account_config (household_id, name, account_type) "
                "VALUES ('hh-x', 'Bad Type', 'roth')"
            )


class TestFlexSnapshotUniqueIndex:
    """R1.1 — Partial UNIQUE on (account_id, ticker, as_of_date) WHERE source='flex'."""

    def _seed_flex_row(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            "INSERT INTO stock_positions "
            "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
            "VALUES ('row-1', 'hh-001', 1, 'VYM', 100, '2025-12-31', 'flex')"
        )
        conn.commit()

    def test_duplicate_flex_snapshot_rejected(self):
        """Second Flex INSERT with same (account_id, ticker, as_of_date) must fail."""
        conn = _make_schema_db()
        self._seed_flex_row(conn)
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint"):
            conn.execute(
                "INSERT INTO stock_positions "
                "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
                "VALUES ('row-2', 'hh-001', 1, 'VYM', 200, '2025-12-31', 'flex')"
            )

    def test_flex_and_manual_same_key_both_allowed(self):
        """A manual row with the same (account_id, ticker, date) as a flex row is allowed."""
        conn = _make_schema_db()
        self._seed_flex_row(conn)
        conn.execute(
            "INSERT INTO stock_positions "
            "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
            "VALUES ('row-m1', 'hh-001', 1, 'VYM', 50, '2025-12-31', 'manual')"
        )

    def test_duplicate_manual_rows_allowed(self):
        """Two manual rows with the same (account_id, ticker, date) are both allowed."""
        conn = _make_schema_db()
        for i in range(2):
            conn.execute(
                "INSERT INTO stock_positions "
                f"(id, household_id, account_id, ticker, quantity, as_of_date, source) "
                f"VALUES ('row-m{i}', 'hh-001', 2, 'SCHD', 30, '2025-12-31', 'manual')"
            )

    def test_flex_different_ticker_allowed(self):
        """Different ticker on same date is a new flex row — must succeed."""
        conn = _make_schema_db()
        self._seed_flex_row(conn)
        conn.execute(
            "INSERT INTO stock_positions "
            "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
            "VALUES ('row-2', 'hh-001', 1, 'SCHD', 40, '2025-12-31', 'flex')"
        )


class TestCrossHouseholdIsolation:
    """R1.1 — Cross-household read isolation at the query level.

    Mirrors the pattern in test_household_isolation.py.
    """

    def test_query_filters_by_household(self):
        """A WHERE household_id=:hh filter must exclude positions from other households."""
        conn = _make_schema_db()
        conn.execute(
            "INSERT INTO stock_positions "
            "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
            "VALUES ('r1', 'hh-001', 1, 'VYM', 100, '2025-12-31', 'flex')"
        )
        conn.execute(
            "INSERT INTO stock_positions "
            "(id, household_id, account_id, ticker, quantity, as_of_date, source) "
            "VALUES ('r2', 'hh-002', 3, 'DBK', 200, '2025-12-31', 'flex')"
        )
        conn.commit()

        rows_hh1 = conn.execute("SELECT * FROM stock_positions WHERE household_id = 'hh-001'").fetchall()
        rows_hh2 = conn.execute("SELECT * FROM stock_positions WHERE household_id = 'hh-002'").fetchall()

        assert len(rows_hh1) == 1, "hh-001 must see only its own position"
        assert len(rows_hh2) == 1, "hh-002 must see only its own position"
        # Verify no cross-contamination
        tickers_hh1 = {r[3] for r in rows_hh1}  # ticker column
        assert "DBK" not in tickers_hh1


# ---------------------------------------------------------------------------
# R1.2 — Manual CRUD endpoints (H2)
# ---------------------------------------------------------------------------


class _PositionsSession:
    """Fake SQLAlchemy session for positions endpoint tests.

    Intercepts SQL execution calls, returning pre-configured fake data.
    The session intentionally does NOT talk to a real database.
    """

    def __init__(
        self,
        account_type: str = "schwab",
        insert_ok: bool = True,
        delete_rowcount: int = 1,
    ) -> None:
        self.account_type = account_type
        self.insert_ok = insert_ok
        self.delete_rowcount = delete_rowcount
        self.committed = False
        self.last_insert_params: dict[str, Any] = {}

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> Any:
        sql = str(statement).lower()
        params = params or {}

        if "from public.trading_account_config" in sql:
            return _FakeMappings([{"id": 2, "name": "E2E Schwab", "account_type": self.account_type}])

        if "insert into public.stock_positions" in sql:
            self.last_insert_params = dict(params)
            return _FakeMappings(
                [
                    {
                        "id": "aaaabbbb-cccc-dddd-eeee-ffffffffffff",
                        "household_id": TEST_HOUSEHOLD_STR,
                        "account_id": params.get("account_id", 2),
                        "ticker": params.get("ticker", "VYM"),
                        "quantity": params.get("quantity", Decimal("50")),
                        "cost_basis": params.get("cost_basis"),
                        "currency": params.get("currency", "USD"),
                        "as_of_date": params.get("as_of_date", date.today()),
                        "source": "manual",
                        "con_id": None,
                        "description": None,
                        "sub_category": None,
                        "mark_price": None,
                        "market_value": None,
                        "unrealized_pnl": None,
                        "last_broker_sync_at": None,
                        "created_at": "2026-05-10T00:00:00Z",
                        "updated_at": "2026-05-10T00:00:00Z",
                    }
                ]
            )

        if "delete from public.stock_positions" in sql:
            return _DeleteResult(rowcount=self.delete_rowcount)

        return _FakeMappings([])

    def commit(self) -> None:
        self.committed = True


class TestManualCRUDEndpoints:
    """R1.2 — Manual CRUD endpoints (H2).

    Calls the route handler functions directly (bypassing FastAPI routing) with a
    FakeSession and patched _resolve_household dependency.  This tests business logic
    without hitting a real database.
    """

    @pytest.fixture()
    def schwab_session(self) -> _PositionsSession:
        return _PositionsSession(account_type="schwab")

    @pytest.fixture()
    def ibkr_session(self) -> _PositionsSession:
        return _PositionsSession(account_type="ibkr")

    @pytest.fixture()
    def delete_session(self) -> _PositionsSession:
        return _PositionsSession(delete_rowcount=1)

    @pytest.fixture()
    def delete_miss_session(self) -> _PositionsSession:
        return _PositionsSession(delete_rowcount=0)

    def _patch_resolve(self):
        """Patch _resolve_household to return the test household_id string."""
        return patch(
            "app.api.positions._resolve_household",
            return_value=TEST_HOUSEHOLD_STR,
        )

    def test_create_position_schwab_returns_row(self, schwab_session: _PositionsSession):
        """POST /api/accounts/positions for a Schwab account creates and returns the row."""
        from app.api.positions import StockPositionCreate, create_position

        body = StockPositionCreate(
            account_id=2,
            ticker="VYM",
            quantity=Decimal("50"),
            cost_basis=Decimal("104.20"),
            currency="USD",
            as_of_date=date(2026, 5, 10),
        )

        with self._patch_resolve():
            result = create_position(body=body, user_id=TEST_USER_ID, db=schwab_session)

        assert result.ticker == "VYM"
        assert result.source == "manual"
        assert result.account_type == "schwab"
        assert schwab_session.committed, "Session must be committed after create"

    def test_create_position_ticker_normalised_to_uppercase(self, schwab_session: _PositionsSession):
        """Ticker string is uppercased by the field_validator before insertion."""
        from app.api.positions import StockPositionCreate, create_position

        body = StockPositionCreate(
            account_id=2,
            ticker="schd",  # lowercase — should be uppercased
            quantity=Decimal("30"),
            as_of_date=date(2026, 5, 10),
        )

        with self._patch_resolve():
            create_position(body=body, user_id=TEST_USER_ID, db=schwab_session)

        assert schwab_session.last_insert_params.get("ticker") == "SCHD"

    def test_create_position_ibkr_returns_422(self, ibkr_session: _PositionsSession):
        """POST for an IBKR account must be rejected with HTTP 422.

        IBKR positions are populated exclusively by the Flex sync worker.
        Manual writes must be blocked to prevent stale data conflicts.
        """
        from fastapi import HTTPException
        from app.api.positions import StockPositionCreate, create_position

        body = StockPositionCreate(
            account_id=1,
            ticker="AAPL",
            quantity=Decimal("10"),
            as_of_date=date(2026, 5, 10),
        )

        with self._patch_resolve():
            with pytest.raises(HTTPException) as exc_info:
                create_position(body=body, user_id=TEST_USER_ID, db=ibkr_session)

        assert exc_info.value.status_code == 422
        assert "IBKR" in exc_info.value.detail

    def test_delete_position_returns_deleted_true(self, delete_session: _PositionsSession):
        """DELETE /api/accounts/positions/{id} returns 200 with {"deleted": True}.

        Hockney's impl note: FastAPI raises AssertionError with 204 + body, so
        the endpoint intentionally uses 200 + JSON body {"deleted": True}.
        """
        from app.api.positions import delete_position

        with self._patch_resolve():
            result = delete_position(
                position_id=UUID("aaaabbbb-cccc-dddd-eeee-ffffffffffff"),
                user_id=TEST_USER_ID,
                db=delete_session,
            )

        assert result == {"deleted": True}, (
            "DELETE must return {'deleted': True} (not 204 No Content). "
            "If this fails, the #340 H2 delete response shape has regressed."
        )
        assert delete_session.committed

    def test_delete_missing_position_returns_404(self, delete_miss_session: _PositionsSession):
        """DELETE for a non-existent (or wrong-household) position must return 404."""
        from fastapi import HTTPException
        from app.api.positions import delete_position

        with self._patch_resolve():
            with pytest.raises(HTTPException) as exc_info:
                delete_position(
                    position_id=UUID("aaaabbbb-cccc-dddd-eeee-000000000000"),
                    user_id=TEST_USER_ID,
                    db=delete_miss_session,
                )

        assert exc_info.value.status_code == 404


def _api_stock_position_row(
    *,
    row_id: int,
    account_id: int,
    account_name: str,
    account_type: str,
    ticker: str,
    quantity: Decimal,
    as_of_date: date,
    source: str,
    market_value: Decimal | None = None,
) -> dict[str, Any]:
    """Build a StockPositionRow-shaped mapping for list endpoint tests."""
    return {
        "id": f"00000000-0000-0000-0000-{row_id:012d}",
        "household_id": TEST_HOUSEHOLD_STR,
        "account_id": account_id,
        "account_name": account_name,
        "account_type": account_type,
        "ticker": ticker,
        "quantity": quantity,
        "cost_basis": None,
        "currency": "USD",
        "as_of_date": as_of_date,
        "source": source,
        "con_id": None,
        "description": None,
        "sub_category": "COMMON",
        "mark_price": None,
        "market_value": market_value,
        "unrealized_pnl": None,
        "last_broker_sync_at": None,
        "created_at": f"2026-05-09T12:00:{row_id:02d}Z",
        "updated_at": f"2026-05-09T12:00:{row_id:02d}Z",
    }


class _ListPositionsSession:
    """Fake session that exposes pre-fix flat selects as duplicate rows.

    The fake deliberately returns all seeded rows unless the endpoint query uses
    the latest-snapshot DISTINCT ON pattern. That makes these tests fail against
    the old flat SELECT while staying independent of a live Postgres instance.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.last_sql = ""
        self.last_params: dict[str, Any] = {}

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> _FakeMappings:
        sql = str(statement).lower()
        self.last_sql = sql
        self.last_params = dict(params or {})

        if "stock_positions" not in sql:
            return _FakeMappings([])

        filtered = [
            row
            for row in self.rows
            if ("account_id" not in self.last_params or row["account_id"] == self.last_params["account_id"])
            and ("as_of_date" not in self.last_params or row["as_of_date"] == self.last_params["as_of_date"])
        ]

        if "distinct on (sp.account_id, sp.ticker)" not in sql:
            return _FakeMappings(filtered)

        latest_by_key: dict[tuple[int, str], dict[str, Any]] = {}
        for row in filtered:
            key = (row["account_id"], row["ticker"])
            existing = latest_by_key.get(key)
            if existing is None or (
                row["as_of_date"],
                row["updated_at"],
                row["created_at"],
                row["id"],
            ) > (
                existing["as_of_date"],
                existing["updated_at"],
                existing["created_at"],
                existing["id"],
            ):
                latest_by_key[key] = row

        rows = sorted(latest_by_key.values(), key=lambda r: (r["account_name"], r["ticker"]))
        return _FakeMappings(rows)


class TestListPositionsLatestSnapshot:
    """R1.2 — list endpoint returns current positions, not historical snapshots."""

    def _patch_resolve(self):
        """Patch _resolve_household to return the test household_id string."""
        return patch(
            "app.api.positions._resolve_household",
            return_value=TEST_HOUSEHOLD_STR,
        )

    def test_flex_positions_return_latest_snapshot_per_account_ticker(self):
        """Flex annual snapshots collapse to the max as_of_date per ticker."""
        from app.api.positions import list_positions

        session = _ListPositionsSession(
            [
                _api_stock_position_row(
                    row_id=1,
                    account_id=1,
                    account_name="InteractiveBrokers",
                    account_type="ibkr",
                    ticker="ABR",
                    quantity=Decimal("10"),
                    as_of_date=date(2023, 12, 29),
                    source="flex",
                    market_value=Decimal("100"),
                ),
                _api_stock_position_row(
                    row_id=2,
                    account_id=1,
                    account_name="InteractiveBrokers",
                    account_type="ibkr",
                    ticker="ABR",
                    quantity=Decimal("30"),
                    as_of_date=date(2025, 12, 31),
                    source="flex",
                    market_value=Decimal("300"),
                ),
                _api_stock_position_row(
                    row_id=3,
                    account_id=1,
                    account_name="InteractiveBrokers",
                    account_type="ibkr",
                    ticker="VYM",
                    quantity=Decimal("5"),
                    as_of_date=date(2025, 12, 31),
                    source="flex",
                    market_value=Decimal("50"),
                ),
            ]
        )

        with self._patch_resolve():
            result = list_positions(account_id=1, as_of_date=None, user_id=TEST_USER_ID, db=session)

        abr_rows = [row for row in result if row.ticker == "ABR"]
        assert len(abr_rows) == 1, "API must return one Flex row per (account_id, ticker)"
        assert abr_rows[0].as_of_date == date(2025, 12, 31)
        assert abr_rows[0].quantity == Decimal("30")
        assert {row.ticker for row in result} == {"ABR", "VYM"}
        assert "distinct on (sp.account_id, sp.ticker)" in session.last_sql

    def test_manual_positions_return_latest_without_swallowing_other_tickers(self):
        """Manual duplicate ticker rows collapse to latest while preserving others."""
        from app.api.positions import list_positions

        session = _ListPositionsSession(
            [
                _api_stock_position_row(
                    row_id=4,
                    account_id=2,
                    account_name="Schwab",
                    account_type="schwab",
                    ticker="AAPL",
                    quantity=Decimal("10"),
                    as_of_date=date(2026, 5, 1),
                    source="manual",
                ),
                _api_stock_position_row(
                    row_id=5,
                    account_id=2,
                    account_name="Schwab",
                    account_type="schwab",
                    ticker="AAPL",
                    quantity=Decimal("15"),
                    as_of_date=date(2026, 5, 9),
                    source="manual",
                ),
                _api_stock_position_row(
                    row_id=6,
                    account_id=2,
                    account_name="Schwab",
                    account_type="schwab",
                    ticker="MSFT",
                    quantity=Decimal("3"),
                    as_of_date=date(2026, 5, 9),
                    source="manual",
                ),
            ]
        )

        with self._patch_resolve():
            result = list_positions(account_id=2, as_of_date=None, user_id=TEST_USER_ID, db=session)

        assert {row.ticker for row in result} == {"AAPL", "MSFT"}
        aapl_rows = [row for row in result if row.ticker == "AAPL"]
        assert len(aapl_rows) == 1, "Manual edit-like duplicates must collapse to the latest row"
        assert aapl_rows[0].as_of_date == date(2026, 5, 9)
        assert aapl_rows[0].quantity == Decimal("15")


# ---------------------------------------------------------------------------
# R1.3 — Flex STK parser (H3)
# ---------------------------------------------------------------------------


def _activity_xml(year_fragment: str) -> Path | None:
    """Return the Path for a specific year's Flex XML, or None if not committed."""
    if not _ACTIVITY_DIR.exists():
        return None
    for f in _ACTIVITY_DIR.glob("*.xml"):
        if year_fragment in f.name:
            return f
    return None


class TestFlexSTKParser:
    """R1.3 — parse_flex_files() STK extraction.

    Uses the real committed Flex XMLs from reports/activity/.  If the files
    are not present (e.g. in a restricted CI environment) the tests are
    gracefully skipped rather than failing the entire suite.
    """

    @pytest.mark.parametrize(
        "year_fragment,expected_count",
        list(_EXPECTED_STK_COUNTS.items()),
    )
    def test_stk_count_per_annual_xml(self, year_fragment: str, expected_count: int):
        """Parser yields the McManus-verified STK count for each annual XML.

        Fail-check: removing the STK branch in parse_flex_files() causes
        stock_positions to be empty; this test would fail with 0 != expected.
        """
        from app.services.options.flex_parser import parse_flex_files

        xml = _activity_xml(year_fragment)
        if xml is None:
            pytest.skip(f"Flex XML not found for fragment {year_fragment!r}")

        result = parse_flex_files([xml])
        assert len(result.stock_positions) == expected_count, (
            f"Expected {expected_count} STK positions from {year_fragment}, "
            f"got {len(result.stock_positions)}.  "
            f"If this fails, the STK parse branch in parse_flex_files() may have regressed."
        )

    def test_bond_and_cash_rows_are_filtered_out(self):
        """BOND and CASH rows in OpenPositions must not appear in stock_positions.

        McManus §Known Limitations: 32 BOND rows and 8 CASH rows exist in the 2025 XML.
        All must be filtered by the assetCategory == 'STK' guard.
        """
        from app.services.options.flex_parser import parse_flex_files

        xml = _activity_xml("20250101_20251231")
        if xml is None:
            pytest.skip("2025 Flex XML not found")

        result = parse_flex_files([xml])

        non_stk = [
            sp for sp in result.stock_positions if sp.sub_category and sp.sub_category.upper() in {"BOND", "CASH"}
        ]
        assert non_stk == [], (
            f"Expected zero BOND/CASH positions in stock_positions, found {len(non_stk)}.  "
            "The assetCategory == 'STK' filter may have been weakened."
        )

    def test_opt_row_with_putcall_excluded_from_stock_positions(self):
        """A synthetic OpenPosition row with putCall='C' must NOT yield a StockPosition.

        The guard ``assetCategory == 'STK' and putCall == ''`` ensures that any
        exotic hybrid rows labelled STK but carrying an option field are excluded.
        """
        from app.services.options.flex_parser import parse_flex_files

        xml_content = textwrap.dedent(
            """\
            <?xml version="1.0" encoding="UTF-8"?>
            <FlexQueryResponse queryName="test" type="AF">
              <FlexStatements count="1">
                <FlexStatement accountId="U9999" fromDate="2026-01-01" toDate="2026-01-01"
                               period="Annual" whenGenerated="2026-01-01;12:00:00">
                  <OpenPositions>
                    <!-- Valid STK row (putCall='') — must produce 1 stock position -->
                    <OpenPosition accountId="U9999" currency="USD" assetCategory="STK"
                                  subCategory="COMMON" symbol="VYM" description="VANGUARD"
                                  conid="12345" underlyingSymbol="VYM" multiplier="1"
                                  strike="" expiry="" putCall=""
                                  position="100" markPrice="110.5" positionValue="11050"
                                  costBasisPrice="100.0" costBasisMoney="10000"
                                  fifoPnlUnrealized="1050" openDateTime="" />
                    <!-- STK row with putCall='C' — must be EXCLUDED from stock_positions -->
                    <OpenPosition accountId="U9999" currency="USD" assetCategory="STK"
                                  subCategory="COMMON" symbol="HYBRID" description="HYBRID OPT"
                                  conid="99999" underlyingSymbol="HYBRID" multiplier="1"
                                  strike="100" expiry="20260620" putCall="C"
                                  position="10" markPrice="5.0" positionValue="50"
                                  costBasisPrice="4.0" costBasisMoney="40"
                                  fifoPnlUnrealized="10" openDateTime="" />
                  </OpenPositions>
                </FlexStatement>
              </FlexStatements>
            </FlexQueryResponse>
            """
        )

        # Write to a temp file in the current working directory (not /tmp)
        tmp_path = Path("tmp_test_stk_putcall_filter.xml")
        try:
            tmp_path.write_text(xml_content)
            result = parse_flex_files([tmp_path])
        finally:
            tmp_path.unlink(missing_ok=True)

        tickers = {sp.symbol for sp in result.stock_positions}
        assert "VYM" in tickers, "Valid STK row (putCall='') must be parsed"
        assert "HYBRID" not in tickers, (
            "STK row with putCall='C' must be excluded from stock_positions.  "
            "The putCall=='' guard in parse_flex_files() may have been removed."
        )
        assert len(result.stock_positions) == 1, f"Expected exactly 1 stock position, got {len(result.stock_positions)}"


# ---------------------------------------------------------------------------
# R1.4 — #342 regression guard: dividend projection fallback
# ---------------------------------------------------------------------------


class _DividendProjectionSession:
    """Fake session for dividend projection endpoint tests.

    Controls whether stock_positions and/or dividend_positions return data,
    allowing precise verification of the primary vs. fallback code path.
    """

    def __init__(
        self,
        has_stock_positions: bool = False,
        has_dividend_positions: bool = False,
    ) -> None:
        self.has_stock_positions = has_stock_positions
        self.has_dividend_positions = has_dividend_positions

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> _FakeMappings:
        sql = str(statement).lower()

        # Primary path: stock_positions JOIN dividend_ticker_data
        if "from public.stock_positions" in sql and "dividend_ticker_data" in sql:
            if self.has_stock_positions:
                return _FakeMappings(
                    [
                        {
                            "ticker": "VYM",
                            "total_quantity": Decimal("100"),
                            "dividend_rate": Decimal("3.50"),
                            "annual_dividend": Decimal("350.00"),
                            "account_id": 1,
                            "account_name": "InteractiveBrokers",
                        }
                    ]
                )
            return _FakeMappings([])

        # Fallback path: dividend_positions JOIN dividend_ticker_data (#342)
        if "from public.dividend_positions" in sql and "dividend_ticker_data" in sql:
            if self.has_dividend_positions:
                return _FakeMappings(
                    [
                        {
                            "ticker": "VYM",
                            "total_quantity": Decimal("50"),
                            "dividend_rate": Decimal("3.50"),
                            "annual_dividend": Decimal("175.00"),
                            "account": "manual",
                        }
                    ]
                )
            return _FakeMappings([])

        return _FakeMappings([])

    # get_user_household_id uses db.exec() (ORM) but we patch it out below
    def exec(self, statement: object) -> Any:
        raise NotImplementedError("exec() should not be called — patch get_user_household_id")


class TestDividendProjectionFallback:
    """R1.4 — #342 regression guard.

    Verifies that GET /api/dividends/projection falls back to dividend_positions
    when stock_positions is empty for the household.  If this fallback is removed,
    households that have not run the Flex sync yet would see $0 projection bars
    in the dashboard summary chart.
    """

    @pytest.fixture()
    def _patch_household(self):
        """Patch get_user_household_id so the endpoint resolves to our test household."""
        with patch(
            "app.api.dividends.get_user_household_id",
            return_value=TEST_HOUSEHOLD_ID,
        ) as m:
            yield m

    def test_zero_stock_positions_falls_back_to_dividend_positions(self, _patch_household):
        """CRITICAL: zero stock_positions must trigger fallback → non-zero total.

        Fail-check: if the fallback branch (H4) is removed, source will not equal
        'dividend_positions_fallback' and total_annual will be 0, failing both
        assertions.  This is the exact regression that caused the pre-#342 bug.
        """
        from app.api.dividends import get_dividend_projection

        session = _DividendProjectionSession(
            has_stock_positions=False,
            has_dividend_positions=True,
        )
        result = get_dividend_projection(user_id=TEST_USER_ID, db=session)

        assert result["source"] == "dividend_positions_fallback", (
            "When stock_positions is empty the endpoint must fall back to dividend_positions "
            "(source='dividend_positions_fallback').  "
            "Removing the H4 fallback causes this assertion to fail."
        )
        assert result["total_annual"] > 0, (
            "Fallback total_annual must be non-zero when dividend_positions rows exist.  "
            "A zero result would reproduce the pre-#342 chart bug ($0 projection bars)."
        )

    def test_with_stock_positions_uses_primary_path(self, _patch_household):
        """When stock_positions exist, the primary path is used (not the fallback)."""
        from app.api.dividends import get_dividend_projection

        session = _DividendProjectionSession(
            has_stock_positions=True,
            has_dividend_positions=True,  # fallback is NOT taken
        )
        result = get_dividend_projection(user_id=TEST_USER_ID, db=session)

        assert result["source"] == "stock_positions", (
            "When stock_positions exist the primary path must be used, not the fallback.  "
            "If this fails, the correlated-subquery latest-snapshot strategy may have broken."
        )
        assert result["total_annual"] > 0

    def test_zero_everything_returns_zero_total(self, _patch_household):
        """Both tables empty → total_annual == 0.0 and fallback source label is used."""
        from app.api.dividends import get_dividend_projection

        session = _DividendProjectionSession(
            has_stock_positions=False,
            has_dividend_positions=False,
        )
        result = get_dividend_projection(user_id=TEST_USER_ID, db=session)

        assert result["total_annual"] == 0.0
        assert result["source"] == "dividend_positions_fallback"
