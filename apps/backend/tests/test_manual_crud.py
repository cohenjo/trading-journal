"""Tests for account-scoped manual CRUD endpoints — issue H3.

Scope:
  H3.1  POST /api/accounts/{account_id}/positions creates a manual row;
        rejected for IBKR account.
  H3.2  PATCH /api/accounts/{account_id}/positions/{id} updates a manual row;
        rejected on flex rows.
  H3.3  DELETE /api/accounts/{account_id}/positions/{id} removes a manual row;
        rejected on flex rows.
  H3.4  POST /api/accounts/{account_id}/positions/import inserts 5 rows;
        re-upload with 4 rows replaces all.
  H3.5  CSV import: malformed row reports error, valid rows still inserted.
  H3.6  RLS guard: wrong household cannot mutate another user's positions.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import HTTPException, UploadFile

# ---------------------------------------------------------------------------
# Shared test constants
# ---------------------------------------------------------------------------

TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")
TEST_HOUSEHOLD_STR = str(TEST_HOUSEHOLD_ID)

OTHER_USER_ID = UUID("00000000-0000-0000-0000-000000000002")
OTHER_HOUSEHOLD_STR = "00000000-0000-0000-0000-000000000202"

SCHWAB_ACCOUNT_ID = 71
IBKR_ACCOUNT_ID = 1

_POSITION_UUID = UUID("aaaabbbb-cccc-dddd-eeee-ffffffffffff")
_FLEX_POSITION_UUID = UUID("11112222-3333-4444-5555-666677778888")


# ---------------------------------------------------------------------------
# Fake SQLAlchemy helpers (mirror test_stock_positions.py pattern)
# ---------------------------------------------------------------------------


class _Row(Mapping):
    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __iter__(self):
        return iter(self._data)

    def __len__(self) -> int:
        return len(self._data)


class _FakeMappings:
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
            raise RuntimeError("No row returned")
        return self._rows[0]


class _DeleteResult:
    def __init__(self, rowcount: int = 1) -> None:
        self.rowcount = rowcount


def _make_position_row(
    *,
    position_id: UUID = _POSITION_UUID,
    account_id: int = SCHWAB_ACCOUNT_ID,
    ticker: str = "VOO",
    quantity: Decimal = Decimal("100"),
    source: str = "manual",
    cost_basis: Decimal | None = Decimal("425.50"),
    cost_basis_total: Decimal | None = Decimal("42550.00"),
    market_value: Decimal | None = Decimal("46800.00"),
) -> dict[str, Any]:
    return {
        "id": str(position_id),
        "household_id": TEST_HOUSEHOLD_STR,
        "account_id": account_id,
        "ticker": ticker,
        "quantity": quantity,
        "cost_basis": cost_basis,
        "cost_basis_total": cost_basis_total,
        "currency": "USD",
        "as_of_date": date(2026, 5, 10),
        "source": source,
        "con_id": None,
        "description": None,
        "sub_category": None,
        "mark_price": None,
        "market_value": market_value,
        "unrealized_pnl": None,
        "last_broker_sync_at": None,
        "created_at": "2026-05-10T00:00:00Z",
        "updated_at": "2026-05-10T00:00:00Z",
    }


# ---------------------------------------------------------------------------
# Fake sessions for account-scoped endpoint tests
# ---------------------------------------------------------------------------


class _ManualCRUDSession:
    """Fake session that intercepts SQL for account-scoped CRUD endpoints."""

    def __init__(
        self,
        *,
        account_type: str = "schwab",
        position_source: str = "manual",
        delete_rowcount: int = 1,
        insert_row: dict[str, Any] | None = None,
        update_row: dict[str, Any] | None = None,
    ) -> None:
        self.account_type = account_type
        self.position_source = position_source
        self.delete_rowcount = delete_rowcount
        self._insert_row = insert_row or _make_position_row()
        self._update_row = update_row or _make_position_row()
        self.committed = False
        self.deleted_rows: int = 0
        self.inserted_count: int = 0
        self.last_insert_params: dict[str, Any] = {}

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> Any:
        sql = str(statement).lower()
        params = params or {}

        # Account lookup
        if "from public.trading_account_config" in sql and "select" in sql:
            return _FakeMappings([{"id": SCHWAB_ACCOUNT_ID, "name": "Schwab Test", "account_type": self.account_type}])

        # Position existence check (PATCH)
        if "select" in sql and "from public.stock_positions" in sql and "id = :id" in sql:
            return _FakeMappings(
                [{"id": str(_POSITION_UUID), "source": self.position_source}] if params.get("id") else []
            )

        # INSERT
        if "insert into public.stock_positions" in sql:
            self.last_insert_params = dict(params)
            self.inserted_count += 1
            return _FakeMappings([self._insert_row])

        # UPDATE
        if "update public.stock_positions" in sql:
            return _FakeMappings([self._update_row])

        # DELETE
        if "delete from public.stock_positions" in sql:
            self.deleted_rows += 1
            return _DeleteResult(rowcount=self.delete_rowcount)

        return _FakeMappings([])

    def commit(self) -> None:
        self.committed = True


class _ImportSession:
    """Fake session that tracks DELETE + multi-INSERT calls for import endpoint."""

    def __init__(self, *, account_type: str = "schwab") -> None:
        self.account_type = account_type
        self.committed = False
        self.delete_calls: int = 0
        self.insert_calls: int = 0

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> Any:
        sql = str(statement).lower()
        params = params or {}

        if "from public.trading_account_config" in sql and "select" in sql:
            return _FakeMappings([{"id": SCHWAB_ACCOUNT_ID, "name": "Schwab Test", "account_type": self.account_type}])

        if "delete from public.stock_positions" in sql:
            self.delete_calls += 1
            return _DeleteResult(rowcount=0)  # rowcount irrelevant for import

        if "insert into public.stock_positions" in sql:
            self.insert_calls += 1
            return _FakeMappings([])  # import doesn't use RETURNING

        return _FakeMappings([])

    def commit(self) -> None:
        self.committed = True


# ---------------------------------------------------------------------------
# Helper: build a fake UploadFile from a CSV string
# ---------------------------------------------------------------------------


def _csv_upload(csv_text: str) -> UploadFile:
    """Wrap a CSV string as a FastAPI UploadFile for testing."""
    raw = csv_text.encode()
    buf = BytesIO(raw)
    uf = UploadFile(filename="positions.csv", file=buf)
    return uf


def _patch_resolve(hh: str = TEST_HOUSEHOLD_STR):
    return patch("app.api.positions._resolve_household", return_value=hh)


# ---------------------------------------------------------------------------
# H3.1 — POST /api/accounts/{account_id}/positions
# ---------------------------------------------------------------------------


class TestCreateManualPosition:
    """H3.1 — account-scoped create endpoint."""

    def test_create_returns_manual_row(self):
        """POST with valid payload returns ManualPositionResponse with source='manual'."""
        from app.api.positions import ManualPositionCreate, create_manual_position

        body = ManualPositionCreate(
            ticker="VOO",
            quantity=Decimal("100"),
            average_cost=Decimal("425.50"),
            currency="USD",
            cost_basis_total=Decimal("42550.00"),
            market_value=Decimal("46800.00"),
            as_of_date=date(2026, 5, 10),
        )
        session = _ManualCRUDSession(account_type="schwab")

        with _patch_resolve():
            result = create_manual_position(
                account_id=SCHWAB_ACCOUNT_ID,
                body=body,
                user_id=TEST_USER_ID,
                db=session,
            )

        assert result.ticker == "VOO"
        assert result.source == "manual"
        assert result.account_type == "schwab"
        assert session.committed

    def test_create_ibkr_rejected_422(self):
        """POST for an IBKR account must return 422 — Flex-only sync."""
        from app.api.positions import ManualPositionCreate, create_manual_position

        body = ManualPositionCreate(ticker="AAPL", quantity=Decimal("10"))
        session = _ManualCRUDSession(account_type="ibkr")

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                create_manual_position(account_id=IBKR_ACCOUNT_ID, body=body, user_id=TEST_USER_ID, db=session)

        assert exc.value.status_code == 422
        assert "IBKR" in exc.value.detail

    def test_create_ticker_uppercased(self):
        """Ticker is normalised to uppercase before insertion."""
        from app.api.positions import ManualPositionCreate, create_manual_position

        body = ManualPositionCreate(ticker="voo", quantity=Decimal("50"))
        session = _ManualCRUDSession(account_type="schwab")

        with _patch_resolve():
            create_manual_position(account_id=SCHWAB_ACCOUNT_ID, body=body, user_id=TEST_USER_ID, db=session)

        assert session.last_insert_params.get("ticker") == "VOO"

    def test_create_average_cost_maps_to_cost_basis_param(self):
        """average_cost in the body is sent as cost_basis to the DB."""
        from app.api.positions import ManualPositionCreate, create_manual_position

        avg = Decimal("310.75")
        body = ManualPositionCreate(ticker="MSFT", quantity=Decimal("8"), average_cost=avg)
        session = _ManualCRUDSession(account_type="ira")

        with _patch_resolve():
            create_manual_position(account_id=72, body=body, user_id=TEST_USER_ID, db=session)

        assert session.last_insert_params.get("cost_basis") == avg

    def test_create_wrong_household_returns_404(self):
        """Account not found for caller's household → 404."""
        from app.api.positions import ManualPositionCreate, create_manual_position

        body = ManualPositionCreate(ticker="VYM", quantity=Decimal("10"))

        class _EmptyAccountSession(_ManualCRUDSession):
            def execute(self, statement: object, params: dict | None = None) -> Any:
                sql = str(statement).lower()
                if "from public.trading_account_config" in sql:
                    return _FakeMappings([])  # not found for this household
                return super().execute(statement, params)

        session = _EmptyAccountSession(account_type="schwab")

        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                create_manual_position(account_id=SCHWAB_ACCOUNT_ID, body=body, user_id=OTHER_USER_ID, db=session)
        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# H3.2 — PATCH /api/accounts/{account_id}/positions/{id}
# ---------------------------------------------------------------------------


class TestPatchManualPosition:
    """H3.2 — account-scoped partial update endpoint."""

    def test_patch_manual_row_updates_and_returns(self):
        """PATCH on a manual row returns the updated ManualPositionResponse."""
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate(quantity=Decimal("120"))
        session = _ManualCRUDSession(
            position_source="manual",
            update_row=_make_position_row(quantity=Decimal("120")),
        )

        with _patch_resolve():
            result = patch_manual_position(
                account_id=SCHWAB_ACCOUNT_ID,
                position_id=_POSITION_UUID,
                body=body,
                user_id=TEST_USER_ID,
                db=session,
            )

        assert result.quantity == Decimal("120")
        assert result.source == "manual"
        assert session.committed

    def test_patch_flex_row_rejected_422(self):
        """PATCH on a flex row must return 422 — flex rows are immutable from UI."""
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate(quantity=Decimal("50"))
        session = _ManualCRUDSession(position_source="flex")

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                patch_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_FLEX_POSITION_UUID,
                    body=body,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 422
        assert "manual" in exc.value.detail.lower()

    def test_patch_no_fields_rejected_422(self):
        """PATCH with empty body (no updatable fields) must return 422."""
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate()  # all None
        session = _ManualCRUDSession(position_source="manual")

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                patch_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_POSITION_UUID,
                    body=body,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 422

    def test_patch_ibkr_account_rejected_422(self):
        """PATCH on an IBKR-typed account is rejected before touching any row."""
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate(quantity=Decimal("5"))
        session = _ManualCRUDSession(account_type="ibkr")

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                patch_manual_position(
                    account_id=IBKR_ACCOUNT_ID,
                    position_id=_POSITION_UUID,
                    body=body,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 422

    def test_patch_missing_position_returns_404(self):
        """PATCH for a non-existent position_id returns 404."""
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate(quantity=Decimal("5"))

        class _MissingPositionSession(_ManualCRUDSession):
            def execute(self, statement: object, params: dict | None = None) -> Any:
                sql = str(statement).lower()
                if "select" in sql and "from public.stock_positions" in sql:
                    return _FakeMappings([])  # not found
                return super().execute(statement, params)

        session = _MissingPositionSession(position_source="manual")

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                patch_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=UUID("00000000-0000-0000-0000-000000000000"),
                    body=body,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# H3.3 — DELETE /api/accounts/{account_id}/positions/{id}
# ---------------------------------------------------------------------------


class TestDeleteManualPosition:
    """H3.3 — account-scoped delete endpoint."""

    def test_delete_manual_row_returns_deleted_true(self):
        """DELETE a manual row returns 200 + {'deleted': True}."""
        from app.api.positions import delete_manual_position

        session = _ManualCRUDSession(delete_rowcount=1)

        with _patch_resolve():
            result = delete_manual_position(
                account_id=SCHWAB_ACCOUNT_ID,
                position_id=_POSITION_UUID,
                user_id=TEST_USER_ID,
                db=session,
            )

        assert result == {"deleted": True}
        assert session.committed

    def test_delete_flex_or_missing_row_returns_404(self):
        """DELETE where source='flex' or row doesn't exist returns 404."""
        from app.api.positions import delete_manual_position

        session = _ManualCRUDSession(delete_rowcount=0)

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                delete_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_FLEX_POSITION_UUID,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 404

    def test_delete_wrong_household_returns_404(self):
        """DELETE for wrong household: account lookup fails → 404 before touching rows."""
        from app.api.positions import delete_manual_position

        class _WrongHHSession(_ManualCRUDSession):
            def execute(self, statement: object, params: dict | None = None) -> Any:
                sql = str(statement).lower()
                if "from public.trading_account_config" in sql and "select" in sql:
                    return _FakeMappings([])
                return super().execute(statement, params)

        session = _WrongHHSession(delete_rowcount=0)

        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                delete_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_POSITION_UUID,
                    user_id=OTHER_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# H3.4 — CSV import: 5 rows inserted; re-upload with 4 rows replaces all
# ---------------------------------------------------------------------------

_VALID_CSV_5 = """\
ticker,quantity,average_cost,currency,cost_basis_total,market_value,as_of_date
VOO,100,425.50,USD,42550.00,46800.00,2026-05-10
SCHD,150,26.50,USD,3975.00,4200.00,2026-05-10
VYM,200,108.35,USD,21670.00,22000.00,2026-05-10
AAPL,12,182.00,USD,2184.00,2300.00,2026-05-10
MSFT,8,310.50,USD,2484.00,2600.00,2026-05-10
"""

_VALID_CSV_4 = """\
ticker,quantity,average_cost,currency,cost_basis_total,market_value,as_of_date
VOO,110,430.00,USD,47300.00,48000.00,2026-05-10
SCHD,160,27.00,USD,4320.00,4500.00,2026-05-10
VYM,210,109.00,USD,22890.00,23000.00,2026-05-10
MSFT,10,315.00,USD,3150.00,3300.00,2026-05-10
"""


class TestCSVImport:
    """H3.4 — CSV bulk import endpoint."""

    def test_import_5_rows_inserts_5(self):
        """Uploading 5 valid rows should result in exactly 5 INSERT calls."""
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="schwab")
        upload = _csv_upload(_VALID_CSV_5)

        with _patch_resolve():
            result = import_manual_positions(
                account_id=SCHWAB_ACCOUNT_ID,
                file=upload,
                user_id=TEST_USER_ID,
                db=session,
            )

        assert result.rows_inserted == 5
        assert result.rows_skipped == 0
        assert result.errors == []
        assert session.insert_calls == 5
        assert session.delete_calls == 1  # one DELETE sweep before INSERTs
        assert session.committed

    def test_reimport_4_rows_deletes_then_inserts_4(self):
        """Re-uploading 4 rows: DELETE fires once, then 4 INSERTs (full account refresh)."""
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="schwab")
        upload = _csv_upload(_VALID_CSV_4)

        with _patch_resolve():
            result = import_manual_positions(
                account_id=SCHWAB_ACCOUNT_ID,
                file=upload,
                user_id=TEST_USER_ID,
                db=session,
            )

        assert result.rows_inserted == 4
        assert session.delete_calls == 1
        assert session.insert_calls == 4

    def test_import_ibkr_account_rejected(self):
        """CSV import for an IBKR account must be rejected with 422."""
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="ibkr")
        upload = _csv_upload(_VALID_CSV_5)

        with _patch_resolve():
            with pytest.raises(HTTPException) as exc:
                import_manual_positions(
                    account_id=IBKR_ACCOUNT_ID,
                    file=upload,
                    user_id=TEST_USER_ID,
                    db=session,
                )

        assert exc.value.status_code == 422

    def test_import_commits_transaction(self):
        """Import must commit the DB transaction after insert."""
        from app.api.positions import import_manual_positions

        session = _ImportSession()
        with _patch_resolve():
            import_manual_positions(
                account_id=SCHWAB_ACCOUNT_ID,
                file=_csv_upload(_VALID_CSV_4),
                user_id=TEST_USER_ID,
                db=session,
            )
        assert session.committed


# ---------------------------------------------------------------------------
# H3.5 — CSV import: malformed row reports error, valid rows still inserted
# ---------------------------------------------------------------------------

_MIXED_CSV = """\
ticker,quantity,average_cost,currency,cost_basis_total,market_value,as_of_date
VOO,100,425.50,USD,42550.00,46800.00,2026-05-10
,50,100.00,USD,,,2026-05-10
SCHD,not-a-number,26.50,USD,,,2026-05-10
VYM,200,108.35,USD,,,2026-05-10
AAPL,12,182.00,USD,,,2026-05-10
"""


class TestCSVImportMalformed:
    """H3.5 — malformed rows report errors; valid rows are still inserted."""

    def test_malformed_rows_skipped_with_errors(self):
        """Two bad rows (blank ticker, bad quantity) produce errors; 3 valid rows inserted."""
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="schwab")
        upload = _csv_upload(_MIXED_CSV)

        with _patch_resolve():
            result = import_manual_positions(
                account_id=SCHWAB_ACCOUNT_ID,
                file=upload,
                user_id=TEST_USER_ID,
                db=session,
            )

        # 3 valid rows (VOO, VYM, AAPL), 2 skipped (blank ticker + bad qty)
        assert result.rows_inserted == 3
        assert result.rows_skipped == 2
        assert len(result.errors) == 2
        # Error messages must mention the problematic rows
        combined = " ".join(result.errors)
        assert "ticker" in combined or "quantity" in combined

    def test_malformed_rows_do_not_block_valid_inserts(self):
        """Even with errors, the valid rows must be committed to the DB."""
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="schwab")
        with _patch_resolve():
            result = import_manual_positions(
                account_id=SCHWAB_ACCOUNT_ID,
                file=_csv_upload(_MIXED_CSV),
                user_id=TEST_USER_ID,
                db=session,
            )

        assert session.insert_calls == 3, "3 valid rows must reach the DB"
        assert session.committed


# ---------------------------------------------------------------------------
# H3.6 — RLS: wrong household cannot mutate another user's positions
# ---------------------------------------------------------------------------


class TestRLSGuard:
    """H3.6 — household isolation for all mutation endpoints."""

    def _wrong_hh_session(self) -> _ManualCRUDSession:
        """Session where the account does NOT belong to the caller's household."""

        class _NotFoundSession(_ManualCRUDSession):
            def execute(self, statement: object, params: dict | None = None) -> Any:
                sql = str(statement).lower()
                if "from public.trading_account_config" in sql and "select" in sql:
                    return _FakeMappings([])  # not in household
                return super().execute(statement, params)

        return _NotFoundSession(account_type="schwab")

    def test_create_wrong_household_blocked(self):
        from app.api.positions import ManualPositionCreate, create_manual_position

        body = ManualPositionCreate(ticker="VOO", quantity=Decimal("10"))
        session = self._wrong_hh_session()
        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                create_manual_position(account_id=SCHWAB_ACCOUNT_ID, body=body, user_id=OTHER_USER_ID, db=session)
        assert exc.value.status_code == 404

    def test_patch_wrong_household_blocked(self):
        from app.api.positions import ManualPositionUpdate, patch_manual_position

        body = ManualPositionUpdate(quantity=Decimal("5"))
        session = self._wrong_hh_session()
        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                patch_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_POSITION_UUID,
                    body=body,
                    user_id=OTHER_USER_ID,
                    db=session,
                )
        assert exc.value.status_code == 404

    def test_delete_wrong_household_blocked(self):
        from app.api.positions import delete_manual_position

        session = self._wrong_hh_session()
        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                delete_manual_position(
                    account_id=SCHWAB_ACCOUNT_ID,
                    position_id=_POSITION_UUID,
                    user_id=OTHER_USER_ID,
                    db=session,
                )
        assert exc.value.status_code == 404

    def test_import_wrong_household_blocked(self):
        from app.api.positions import import_manual_positions

        session = _ImportSession(account_type="schwab")

        class _WrongHHImportSession(_ImportSession):
            def execute(self, statement: object, params: dict | None = None) -> Any:
                sql = str(statement).lower()
                if "from public.trading_account_config" in sql and "select" in sql:
                    return _FakeMappings([])
                return super().execute(statement, params)

        session = _WrongHHImportSession(account_type="schwab")
        with _patch_resolve(OTHER_HOUSEHOLD_STR):
            with pytest.raises(HTTPException) as exc:
                import_manual_positions(
                    account_id=SCHWAB_ACCOUNT_ID,
                    file=_csv_upload(_VALID_CSV_4),
                    user_id=OTHER_USER_ID,
                    db=session,
                )
        assert exc.value.status_code == 404
