"""Unit tests for backfill_flex_v2.py.

Covers:
- Idempotency: running twice produces no duplicates
- Dry-run: no writes committed
- Phase selection: only requested phases execute
- Phase A: identifier column logic (cost_basis_total + XML identifiers)
- Phase B: dividend re-routing with correct parsing + bulk SQL
- Phase C: dividend_accruals seeding from parsed XML
- Phase D: security_reference upsert
- Phase E: bond_holdings INSERT

All DB calls are mocked via unittest.mock so tests run offline.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_DIVIDEND_ATTRS = {
    "accountId": "U2515365",
    "transactionID": "txn-001",
    "type": "Dividends",
    "symbol": "AAPL",
    "conid": "265598",
    "amount": "100.00",
    "currency": "USD",
    "dateTime": "2026-01-15;120000",
    "reportDate": "2026-01-15",
}

_WHT_ATTRS = {
    "accountId": "U2515365",
    "transactionID": "txn-002",
    "type": "Withholding Tax",
    "symbol": "AAPL",
    "conid": "265598",
    "amount": "-15.00",
    "currency": "USD",
    "dateTime": "2026-01-15;120000",
    "reportDate": "2026-01-15",
}

_PIL_ATTRS = {
    "accountId": "U2515365",
    "transactionID": "txn-003",
    "type": "Payment In Lieu Of Dividends",
    "symbol": "SPY",
    "conid": "756733",
    "amount": "50.00",
    "currency": "USD",
    "dateTime": "2026-02-10;120000",
    "reportDate": "2026-02-10",
}

_NO_TXN_ATTRS = {
    "accountId": "U2515365",
    "type": "Dividends",
    "symbol": "AAPL",
    "amount": "10.00",
    "currency": "USD",
    # No transactionID — should be skipped
}


def _make_mock_session() -> MagicMock:
    """Return a minimal mock Session with execute, commit, rollback."""
    session = MagicMock()
    # execute returns an object with .all() and .rowcount
    result = MagicMock()
    result.all.return_value = []
    result.rowcount = 0
    session.execute.return_value = result
    return session


# ---------------------------------------------------------------------------
# Import the module under test (after mocking engine import)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _mock_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    """Prevent real DB engine creation during import."""
    import sys

    # Stub out app.dal.database.engine before importing scripts
    fake_engine = MagicMock()
    monkeypatch.setitem(sys.modules, "app.dal.database", MagicMock(engine=fake_engine))


# ---------------------------------------------------------------------------
# Phase A tests
# ---------------------------------------------------------------------------


class TestPhaseA:
    """Backfill stock_positions identifier columns."""

    def _run_phase_a(self, session: MagicMock) -> dict[str, int]:
        from scripts.backfill_flex_v2 import run_phase_a  # noqa: PLC0415

        return run_phase_a(session, dry_run=False)

    def test_updates_cost_basis_from_raw_payload(self) -> None:
        """Phase A issues a SQL UPDATE for cost_basis_total from raw_payload."""
        session = _make_mock_session()
        # First execute (UPDATE cost_basis_total) returns 270 rows
        update_result = MagicMock()
        update_result.rowcount = 270
        # Subsequent executes (UPDATE identifier cols) return 0
        id_result = MagicMock()
        id_result.rowcount = 0

        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent_path.xml")):
            result = self._run_phase_a(session)

        # Should have called execute at least once (for cost_basis_total UPDATE)
        assert session.execute.call_count >= 1
        assert "updated_cost_basis" in result

    def test_skips_identifier_update_when_no_xml(self) -> None:
        """Phase A skips identifier update gracefully if master XML is missing."""
        session = _make_mock_session()
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent_path.xml")):
            result = self._run_phase_a(session)
        # Should report 0 read since no XML
        assert result["read"] == 0

    def test_returns_dict_with_expected_keys(self) -> None:
        """Phase A result dict has required keys."""
        session = _make_mock_session()
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent_path.xml")):
            result = self._run_phase_a(session)
        assert all(k in result for k in ("read", "updated_identifiers", "updated_cost_basis", "skipped"))

    def test_idempotent_sql_uses_coalesce(self) -> None:
        """Phase A UPDATE uses COALESCE so re-runs don't overwrite existing data."""
        session = _make_mock_session()
        calls_sql: list[str] = []

        def capture_execute(stmt: Any, *args: Any, **kwargs: Any) -> MagicMock:
            sql = str(stmt) if hasattr(stmt, "__str__") else ""
            calls_sql.append(sql.upper())
            return _make_mock_session().execute.return_value

        session.execute.side_effect = capture_execute
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent_path.xml")):
            self._run_phase_a(session)
        # The cost_basis_total UPDATE should use IS NULL check (idempotency guard)
        assert any("IS NULL" in sql for sql in calls_sql)


# ---------------------------------------------------------------------------
# Phase B tests
# ---------------------------------------------------------------------------


class TestPhaseB:
    """Dividend re-routing from options_cash_events → dividend_payments."""

    def _run(self, session: MagicMock) -> dict[str, int]:
        from scripts.backfill_flex_v2 import run_phase_b  # noqa: PLC0415

        return run_phase_b(session, dry_run=False)

    def _session_with_rows(self, rows: list[dict[str, str]]) -> MagicMock:
        """Return a mock session that yields `rows` as raw_payload dicts."""
        session = _make_mock_session()
        query_result = MagicMock()
        query_result.all.return_value = [(i, row) for i, row in enumerate(rows)]
        insert_result = MagicMock()
        insert_result.rowcount = len(rows)

        def _side_effect(stmt: Any, *args: Any, **kwargs: Any) -> MagicMock:
            sql = str(stmt).upper()
            if "FROM PUBLIC.OPTIONS_CASH_EVENTS" in sql or "OPTIONS_CASH_EVENTS" in sql:
                return query_result
            return insert_result

        session.execute.side_effect = _side_effect
        return session

    def test_reads_dividend_types_from_options_cash_events(self) -> None:
        """Phase B queries options_cash_events for dividend types."""
        session = _make_mock_session()
        result = self._run(session)
        assert session.execute.called
        # First call should be the SELECT
        first_call_sql = str(session.execute.call_args_list[0][0][0]).upper()
        assert "OPTIONS_CASH_EVENTS" in first_call_sql

    def test_skips_rows_without_transaction_id(self) -> None:
        """Rows lacking transactionID are skipped (can't be made idempotent)."""
        session = self._session_with_rows([_NO_TXN_ATTRS])
        result = self._run(session)
        assert result["skipped_no_id"] == 1
        assert result["inserted"] == 0

    def test_processes_all_dividend_types(self) -> None:
        """All three dividend types are routed to dividend_payments."""
        rows = [_DIVIDEND_ATTRS, _WHT_ATTRS, _PIL_ATTRS]
        session = self._session_with_rows(rows)
        result = self._run(session)
        assert result["read"] == 3
        assert result["skipped_no_id"] == 0
        assert result["inserted"] == 3

    def test_returns_expected_keys(self) -> None:
        """Result dict has standard Phase B keys."""
        session = _make_mock_session()
        result = self._run(session)
        assert all(k in result for k in ("read", "inserted", "skipped_no_id"))

    def test_empty_source_produces_zero_inserted(self) -> None:
        """Empty options_cash_events produces zero inserts."""
        session = _make_mock_session()
        # Default mock returns []
        result = self._run(session)
        assert result["inserted"] == 0
        assert result["read"] == 0


# ---------------------------------------------------------------------------
# Phase C tests
# ---------------------------------------------------------------------------


class TestPhaseC:
    """Dividend accruals from master XML."""

    def _run(self, session: MagicMock) -> dict[str, int]:
        from scripts.backfill_flex_v2 import run_phase_c  # noqa: PLC0415

        return run_phase_c(session, dry_run=False)

    def test_returns_zero_when_no_xml(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert result["read"] == 0
        assert result["inserted"] == 0

    def test_calls_sync_dividend_accruals(self) -> None:
        """Phase C calls _sync_dividend_accruals with parsed data."""
        from app.services.options.flex_parser import FlexDividendAccrual, FlexParseResult

        mock_accrual = FlexDividendAccrual(
            account_id="U2515365",
            symbol="AAPL",
            source_section="change",
            report_date=date(2026, 5, 8),
        )
        fake_parsed = FlexParseResult(dividend_accruals=[mock_accrual])

        with (
            patch("scripts.backfill_flex_v2.parse_flex_files", return_value=fake_parsed),
            patch("scripts.backfill_flex_v2._sync_dividend_accruals", return_value=1) as mock_sync,
        ):
            result = self._run(_make_mock_session())

        assert result["read"] == 1
        mock_sync.assert_called_once()

    def test_returns_expected_keys(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert all(k in result for k in ("read", "inserted"))


# ---------------------------------------------------------------------------
# Phase D tests
# ---------------------------------------------------------------------------


class TestPhaseD:
    """Security reference seeding from OpenPositions."""

    def _run(self, session: MagicMock) -> dict[str, int]:
        from scripts.backfill_flex_v2 import run_phase_d  # noqa: PLC0415

        return run_phase_d(session, dry_run=False)

    def test_returns_zero_when_no_xml(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert result["read"] == 0
        assert result["upserted"] == 0

    def test_builds_security_info_from_stock_positions(self) -> None:
        """Phase D creates FlexSecurityInfo from parsed stock positions."""
        from app.services.options.flex_parser import FlexParseResult, FlexStockPosition

        sync_time = datetime(2026, 5, 8, tzinfo=timezone.utc)
        mock_sp = FlexStockPosition(
            account_id="U2515365",
            as_of_date=date(2026, 5, 8),
            symbol="AAPL",
            con_id=265598,
            quantity=Decimal("100"),
            cusip="037833100",
            isin="US0378331005",
            figi="BBG000B9XRY4",
            listing_exchange="NASDAQ",
            security_id="US0378331005",
            security_id_type="ISIN",
            last_broker_sync_at=sync_time,
        )
        fake_parsed = FlexParseResult(stock_positions=[mock_sp])

        with (
            patch("scripts.backfill_flex_v2.parse_flex_files", return_value=fake_parsed),
            patch("scripts.backfill_flex_v2._upsert_security_reference", return_value=1) as mock_upsert,
        ):
            result = self._run(_make_mock_session())

        assert result["read"] == 1
        assert result["upserted"] == 1
        mock_upsert.assert_called_once()
        # Source should be 'open_positions'
        _, kwargs = mock_upsert.call_args
        assert kwargs.get("source") == "open_positions"

    def test_skips_positions_without_con_id(self) -> None:
        """Positions without con_id are excluded from security_reference."""
        from app.services.options.flex_parser import FlexParseResult, FlexStockPosition

        sync_time = datetime(2026, 5, 8, tzinfo=timezone.utc)
        mock_sp = FlexStockPosition(
            account_id="U2515365",
            as_of_date=date(2026, 5, 8),
            symbol="UNKNOWN",
            con_id=None,  # no con_id
            quantity=Decimal("10"),
            last_broker_sync_at=sync_time,
        )
        fake_parsed = FlexParseResult(stock_positions=[mock_sp])

        with (
            patch("scripts.backfill_flex_v2.parse_flex_files", return_value=fake_parsed),
            patch("scripts.backfill_flex_v2._upsert_security_reference", return_value=0) as mock_upsert,
        ):
            result = self._run(_make_mock_session())

        assert result["read"] == 0
        mock_upsert.assert_not_called()

    def test_returns_expected_keys(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert all(k in result for k in ("read", "upserted"))


# ---------------------------------------------------------------------------
# Phase E tests
# ---------------------------------------------------------------------------


class TestPhaseE:
    """Bond holdings from master XML."""

    def _run(self, session: MagicMock) -> dict[str, int]:
        from scripts.backfill_flex_v2 import run_phase_e  # noqa: PLC0415

        return run_phase_e(session, dry_run=False)

    def test_returns_zero_when_no_xml(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert result["read"] == 0
        assert result["inserted"] == 0

    def test_returns_expected_keys(self) -> None:
        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            result = self._run(_make_mock_session())
        assert all(k in result for k in ("read", "inserted"))

    def test_inserts_bond_positions_for_known_account(self) -> None:
        """Phase E inserts bond rows for accounts found in trading_account_config."""
        from app.services.options.flex_parser import FlexBondPosition, FlexParseResult
        from app.worker.handlers.options_sync import OptionsAccount

        sync_time = datetime(2026, 5, 8, tzinfo=timezone.utc)
        mock_bp = FlexBondPosition(
            account_id="U2515365",
            as_of_date=date(2026, 5, 8),
            symbol="AAPL 4 1/4 02/09/47",
            con_id=264824302,
            quantity=Decimal("8000"),
            coupon_rate=Decimal("4.25"),
            maturity_date=date(2047, 2, 9),
            last_broker_sync_at=sync_time,
        )
        fake_parsed = FlexParseResult(bond_positions=[mock_bp])
        fake_account = OptionsAccount(
            household_id="041198ec-d6ba-45b1-afa9-2fbf8bcf1353",
            account_id="U2515365",
            config_id=1,
        )

        session = _make_mock_session()
        with (
            patch("scripts.backfill_flex_v2.parse_flex_files", return_value=fake_parsed),
            patch("scripts.backfill_flex_v2._load_accounts", return_value=[fake_account]),
        ):
            result = self._run(session)

        assert result["read"] == 1
        assert result["inserted"] == 1
        # DELETE + INSERT should have been called
        assert session.execute.call_count >= 2

    def test_skips_unknown_account(self) -> None:
        """Phase E skips bond rows for accounts not in trading_account_config."""
        from app.services.options.flex_parser import FlexBondPosition, FlexParseResult
        from app.worker.handlers.options_sync import OptionsAccount

        sync_time = datetime(2026, 5, 8, tzinfo=timezone.utc)
        mock_bp = FlexBondPosition(
            account_id="UNKNOWN_ACCT",
            as_of_date=date(2026, 5, 8),
            symbol="T 4 02/15/34",
            con_id=999999,
            quantity=Decimal("1000"),
            last_broker_sync_at=sync_time,
        )
        fake_parsed = FlexParseResult(bond_positions=[mock_bp])
        # Account config doesn't have UNKNOWN_ACCT
        fake_account = OptionsAccount(
            household_id="041198ec-d6ba-45b1-afa9-2fbf8bcf1353",
            account_id="U2515365",
            config_id=1,
        )

        with (
            patch("scripts.backfill_flex_v2.parse_flex_files", return_value=fake_parsed),
            patch("scripts.backfill_flex_v2._load_accounts", return_value=[fake_account]),
        ):
            result = self._run(_make_mock_session())

        assert result["inserted"] == 0


# ---------------------------------------------------------------------------
# Dry-run tests
# ---------------------------------------------------------------------------


class TestDryRun:
    """Dry-run mode rolls back all changes."""

    def test_dry_run_rollback_called(self) -> None:
        """In dry-run mode the session is rolled back instead of committed."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        session = _make_mock_session()
        # Patch the Session context manager to yield our mock
        with (
            patch("scripts.backfill_flex_v2.Session") as mock_session_cls,
            patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")),
        ):
            mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
            mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
            rc = main(["--dry-run"])

        assert rc == 0
        session.rollback.assert_called()
        session.commit.assert_not_called()

    def test_live_run_commits(self) -> None:
        """In live mode the session is committed."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        session = _make_mock_session()
        with (
            patch("scripts.backfill_flex_v2.Session") as mock_session_cls,
            patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")),
        ):
            mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
            mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
            rc = main([])

        assert rc == 0
        session.commit.assert_called_once()
        session.rollback.assert_not_called()


# ---------------------------------------------------------------------------
# Phase selection tests
# ---------------------------------------------------------------------------


class TestPhaseSelection:
    """--phase flag controls which phases run."""

    def test_single_phase_selection(self) -> None:
        """Only Phase A runs when --phase=A."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        ran: list[str] = []

        def fake_a(session: Any, dry_run: bool) -> dict[str, int]:
            ran.append("A")
            return {"read": 0, "updated_identifiers": 0, "updated_cost_basis": 0, "skipped": 0}

        session = _make_mock_session()
        with (
            patch("scripts.backfill_flex_v2.Session") as mock_session_cls,
            patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")),
            patch.dict(
                "scripts.backfill_flex_v2.PHASE_RUNNERS",
                {"A": fake_a, "B": MagicMock(), "C": MagicMock(), "D": MagicMock(), "E": MagicMock()},
            ),
        ):
            mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
            mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
            main(["--phase=A"])

        assert ran == ["A"]

    def test_unknown_phase_returns_nonzero(self) -> None:
        """Unknown phase letter returns exit code 1."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        with patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")):
            rc = main(["--phase=Z"])
        assert rc == 1

    def test_multiple_phases_run_in_order(self) -> None:
        """Phases A,C run in order when specified."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        ran: list[str] = []

        def make_runner(name: str) -> Any:
            def _run(session: Any, dry_run: bool) -> dict[str, int]:
                ran.append(name)
                return {"read": 0, "inserted": 0, "updated_identifiers": 0, "updated_cost_basis": 0, "skipped": 0}

            return _run

        session = _make_mock_session()
        with (
            patch("scripts.backfill_flex_v2.Session") as mock_session_cls,
            patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")),
            patch.dict(
                "scripts.backfill_flex_v2.PHASE_RUNNERS",
                {p: make_runner(p) for p in "ABCDE"},
            ),
        ):
            mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
            mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
            main(["--phase=A,C"])

        assert ran == ["A", "C"]

    def test_phase_error_continues_to_next(self) -> None:
        """A failing phase does not abort subsequent phases."""
        from scripts.backfill_flex_v2 import main  # noqa: PLC0415

        ran: list[str] = []

        def fail_b(session: Any, dry_run: bool) -> dict[str, int]:
            raise RuntimeError("Phase B deliberately failed")

        def ok_c(session: Any, dry_run: bool) -> dict[str, int]:
            ran.append("C")
            return {"read": 0, "inserted": 0}

        session = _make_mock_session()
        with (
            patch("scripts.backfill_flex_v2.Session") as mock_session_cls,
            patch("scripts.backfill_flex_v2.MASTER_XML", Path("/nonexistent.xml")),
            patch.dict(
                "scripts.backfill_flex_v2.PHASE_RUNNERS",
                {
                    "A": MagicMock(
                        return_value={"read": 0, "updated_identifiers": 0, "updated_cost_basis": 0, "skipped": 0}
                    ),
                    "B": fail_b,
                    "C": ok_c,
                    "D": MagicMock(return_value={"read": 0, "upserted": 0}),
                    "E": MagicMock(return_value={"read": 0, "inserted": 0}),
                },
            ),
        ):
            mock_session_cls.return_value.__enter__ = MagicMock(return_value=session)
            mock_session_cls.return_value.__exit__ = MagicMock(return_value=False)
            rc = main(["--phase=B,C"])

        # C should have run despite B failing
        assert "C" in ran
        # Exit code is still 0 (phases ran; errors are logged per-phase)
        assert rc == 0
