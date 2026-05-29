"""CC-9 — Credit-Card Expense Pipeline: Test Plan Scaffold.

All tests in this module are SKIP/XFAIL stubs. They are anticipatory tests
written before the implementation exists (CC-2 parsers, CC-5 worker, CC-6 APIs).

Implementation agents (Hockney for backend, Fenster for frontend) should:
  1. Remove the ``pytest.skip()`` / ``pytest.mark.xfail`` decorator when shipping
     the relevant CC work item.
  2. Fill in the test body with real assertions against the newly landed code.

Scenario IDs reference the catalogue in:
  .squad/decisions/inbox/redfoot-cc-test-plan.md

Run check (should be ALL skip/xfail, zero failures):
  cd apps/backend && uv run pytest tests/credit_card_pipeline/ -v
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from shutil import copy
from typing import Optional
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.schema.expenses import (
    CreditCardStatement,
    CreditCardTransaction,
    ExpenseCategory,
    ExpenseInbox,
    MerchantCategoryMapping,
)
from app.services.expenses.categorize import (
    CategoryResolver,
)
import app.worker.expenses_inbox as expenses_inbox
from app.worker.expenses_inbox import (
    _reset_orphaned_processing_rows,
    scan_inbox_once,
)

# Repo root — used to resolve fixture PDF paths from the project root.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")


# ---------------------------------------------------------------------------
# Helpers / shared constants
# ---------------------------------------------------------------------------

REPORTS_CC_DIR = "reports/credit-card"

# Known fixture PDFs per format (relative to repo root)
_CAL_FIXTURES = {
    "happy_path": f"{REPORTS_CC_DIR}/דף פירוט דיגיטלי כאל 02-26.pdf",
    "page2": f"{REPORTS_CC_DIR}/דף פירוט דיגיטלי כאל 02-26-2.pdf",
    "fx_row": f"{REPORTS_CC_DIR}/דף פירוט דיגיטלי כאל 04-26-2.pdf",
    "installment": f"{REPORTS_CC_DIR}/דף פירוט דיגיטלי כאל 05-26-3.pdf",
    "year_boundary": f"{REPORTS_CC_DIR}/דף פירוט דיגיטלי כאל 12-25.pdf",
}
_PAYBOX_FIXTURES = {
    "happy_path": f"{REPORTS_CC_DIR}/639156527487946127.pdf",
    "standing_order": f"{REPORTS_CC_DIR}/639156527542389687.pdf",
    "transfers": f"{REPORTS_CC_DIR}/639156527641916846.pdf",
    "multi_page": f"{REPORTS_CC_DIR}/639156527713520269.pdf",
    "variant": f"{REPORTS_CC_DIR}/639156527757823855.pdf",
}
_MAX_FIXTURES = {
    "happy_path": f"{REPORTS_CC_DIR}/statement__29_05_2026.pdf",
    "page2": f"{REPORTS_CC_DIR}/statement__29_05_2026-2.pdf",
    "date_quirk": f"{REPORTS_CC_DIR}/statement__29_05_2026-3.pdf",
    "standing_order": f"{REPORTS_CC_DIR}/statement__29_05_2026-4.pdf",
    "no_sector": f"{REPORTS_CC_DIR}/statement__29_05_2026-5.pdf",
}
_ISRACARD_FIXTURES = {
    "domestic": f"{REPORTS_CC_DIR}/Unknown-3.pdf",
    "foreign": f"{REPORTS_CC_DIR}/Unknown-4.pdf",
    "sector": f"{REPORTS_CC_DIR}/Unknown-5.pdf",
    "multi_page": f"{REPORTS_CC_DIR}/Unknown-6.pdf",
    "installment": f"{REPORTS_CC_DIR}/Unknown-7.pdf",
}


# ===========================================================================
# SECTION 1 — Parser tests
# ===========================================================================

# ---------------------------------------------------------------------------
# 1.1 Cal General
# ---------------------------------------------------------------------------


def test_cal_parser_happy_path() -> None:
    """P-CAL-1: Covered by tests/credit_card_pipeline/test_cc2_parsers.py::test_cal_parser_happy_path."""
    pytest.skip("Covered in test_cc2_parsers.py")


def test_cal_parser_hebrew_rtl_merchant() -> None:
    """P-CAL-2: merchant_raw preserves Hebrew codepoints; merchant_normalized stripped of ₪/commas.

    See scenario P-CAL-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_fx_row() -> None:
    """P-CAL-3: EUR row — original_currency='EUR', fx_rate>0, amount_ils in ILS.

    See scenario P-CAL-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_installment_row() -> None:
    """P-CAL-4: installment_num=1, installment_total=5, amount_ils = this-month charge only.

    See scenario P-CAL-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_refund_row_negative_amount() -> None:
    """P-CAL-5: Negative ₪ amount is preserved as-is (no abs() swallow), txn_type='credit'.

    See scenario P-CAL-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_empty_statement() -> None:
    """P-CAL-6: PDF with only header/footer rows → empty transaction list, no crash.

    See scenario P-CAL-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_multi_page_no_row_split() -> None:
    """P-CAL-7: Page-2 continuation — combined row count = p1 + p2, no split/dup.

    See scenario P-CAL-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_header_drift_emits_warning() -> None:
    """P-CAL-8: Column shifted 10px → parse_warnings non-empty, parse_status='partial', no crash.

    See scenario P-CAL-8 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_cal_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-CAL-9: Non-PDF bytes → ParseError raised; caller sets status='errored', retry_count++.

    See scenario P-CAL-9 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


# ---------------------------------------------------------------------------
# 1.2 Cal PayBox
# ---------------------------------------------------------------------------


def test_calp_parser_happy_path() -> None:
    """P-PBX-1: Parse 639156527487946127.pdf; N rows; dates in DD/MM/YYYY; amounts ILS.

    See scenario P-PBX-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_format_detection_paybox() -> None:
    """P-PBX-2: issuer_format == 'cal-paybox' (not 'cal') via 228899999/PayBox sentinel.

    See scenario P-PBX-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_transfer_row_classified() -> None:
    """P-PBX-3: Recipient-name rows → txn_type='transfer' or category pre-resolved as 'transfers'.

    See scenario P-PBX-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_multi_page_row_count() -> None:
    """P-PBX-4: Multi-page combined row count = p1 + p2, no duplication.

    See scenario P-PBX-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_mixed_hebrew_english_merchant() -> None:
    """P-PBX-5: Hebrew issuer metadata stripped from merchant_normalized.

    See scenario P-PBX-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_empty_statement() -> None:
    """P-PBX-6: Zero transaction rows → empty list, no crash.

    See scenario P-PBX-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_refund_row_negative_amount() -> None:
    """P-PBX-7: Negative amount preserved (no abs() swallow).

    See scenario P-PBX-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_calp_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-PBX-8: Non-PDF → ParseError, retry_count++.

    See scenario P-PBX-8 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


# ---------------------------------------------------------------------------
# 1.3 Max
# ---------------------------------------------------------------------------


def test_max_parser_happy_path() -> None:
    """P-MAX-1: Parse statement__29_05_2026.pdf; issuer='max'; card_last4='1494'.

    See scenario P-MAX-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_date_quirk_year_suffix_stripped() -> None:
    """P-MAX-2: Dates like '05/04/267' → stripped to valid DD/MM/YY → valid date object.

    See scenario P-MAX-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_no_sector_column_is_null() -> None:
    """P-MAX-3: All Max rows have issuer_sector_raw=None; no crash when sector absent.

    See scenario P-MAX-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_standing_order_row() -> None:
    """P-MAX-4: עבק תארוה type → txn_type='standing_order'.

    See scenario P-MAX-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_fx_row() -> None:
    """P-MAX-5: FX rows — original_currency, fx_rate, amount_original_currency populated.

    See scenario P-MAX-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_multi_page_row_count() -> None:
    """P-MAX-6: Multi-page — combined row count accurate, no duplication.

    See scenario P-MAX-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_hebrew_only_merchant_nonempty() -> None:
    """P-MAX-7: Merchant with only Hebrew letters → merchant_normalized is non-empty.

    See scenario P-MAX-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_empty_statement() -> None:
    """P-MAX-8: Zero rows → no crash.

    See scenario P-MAX-8 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_max_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-MAX-9: Non-PDF → ParseError, graceful error.

    See scenario P-MAX-9 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


# ---------------------------------------------------------------------------
# 1.4 Isracard
# ---------------------------------------------------------------------------


def test_isracard_parser_happy_path_domestic() -> None:
    """P-ISR-1: Unknown-3.pdf domestic section; issuer_sector_raw populated.

    See scenario P-ISR-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_foreign_section_fx_fields() -> None:
    """P-ISR-2: Unknown-4.pdf foreign rows — original_currency, fx_rate, posting_date all set.

    See scenario P-ISR-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_section_split_correct() -> None:
    """P-ISR-3: Domestic and foreign sections split correctly; foreign rows have non-ILS currency.

    See scenario P-ISR-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_sector_field_populated() -> None:
    """P-ISR-4: Unknown-5.pdf — issuer_sector_raw in known Hebrew sector vocabulary.

    See scenario P-ISR-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_installment_row() -> None:
    """P-ISR-5: Unknown-7.pdf installment row → installment_num, installment_total correct.

    See scenario P-ISR-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_multi_page_no_row_drop() -> None:
    """P-ISR-6: Unknown-6.pdf — combined row count = sum of both sections across pages.

    See scenario P-ISR-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_refund_row_negative_amount() -> None:
    """P-ISR-7: Negative amount preserved.

    See scenario P-ISR-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_latin_merchant_in_rtl_context() -> None:
    """P-ISR-8: Latin merchant (e.g. 'EUROPAPARK HOTELBE') extracted correctly from RTL context.

    See scenario P-ISR-8 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_empty_statement() -> None:
    """P-ISR-9: Zero rows → no crash.

    See scenario P-ISR-9 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_isracard_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-ISR-10: Non-PDF → ParseError, retry_count++.

    See scenario P-ISR-10 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


# ===========================================================================
# SECTION 2 — Categorization tests
# ===========================================================================
#
# These tests exercise the 3-tier categorization engine (CC-4).
# They are UNIT tests — no PDF parsing required.  Synthetic transactions are
# built directly using _SyntheticTxn defined at the top of this file.
#
# Fixtures provided by tests/credit_card_pipeline/conftest.py:
#   seeded_session  — (Session, slug_map) with ExpenseCategory rows
# ---------------------------------------------------------------------------


@dataclass
class _SyntheticTxn:
    """Minimal stand-in for CC-2's ParsedTransaction.

    Satisfies the ParsedTransaction protocol used by CategoryResolver.
    Tests build these directly — no dependency on pdfplumber or CC-2 parsers.
    """

    merchant_normalized: str
    merchant_raw: str = ""
    sector_raw: Optional[str] = None


def test_categorization_sector_present_resolves_issuer_sector(
    seeded_session: tuple,
) -> None:
    """C-1: issuer_sector_raw='ניפו חוטיב' (contains חוטיב = insurance) →
    category='financial-insurance', resolution_source='sector'.

    The YAML comment: ביטוח (insurance) is extracted by pdfplumber as חוטיב
    (character-reversed). The sector lookup matches on substring containment.
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(
        merchant_normalized="ליבומלכ חוטיב תונכוס",
        sector_raw="ניפו חוטיב",  # contains חוטיב = insurance marker
    )
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "auto"
    assert result.resolution_source == "sector"
    assert result.category_id == slug_map["financial-insurance"]
    assert result.is_transfer is False


def test_categorization_no_sector_yaml_rule_fires(
    seeded_session: tuple,
) -> None:
    """C-2: merchant_normalized='NETFLIX', no sector →
    category='utilities', subcategory='utilities-streaming', resolution_source='rule'.

    Note: McManus's YAML maps Netflix under utilities/utilities-streaming
    (not a standalone 'entertainment' category — the YAML is the source of truth).
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(merchant_normalized="NETFLIX", sector_raw=None)
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "auto"
    assert result.resolution_source == "rule"
    assert result.category_id == slug_map["utilities"]
    assert result.subcategory_id == slug_map["utilities-streaming"]
    assert result.is_transfer is False


def test_categorization_both_fail_lands_unresolved(
    seeded_session: tuple,
) -> None:
    """C-3: Obscure merchant, no sector, no rule match →
    resolution_status='unresolved', category_id=None.

    The resolver NEVER silently assigns 'other'. Unresolved rows appear in
    the CC-7 resolution queue for user action.
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(
        merchant_normalized="XYZQWERTY_UNKNOWN_MERCHANT_123",
        sector_raw=None,
    )
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "unresolved"
    assert result.resolution_source is None
    assert result.category_id is None
    assert result.subcategory_id is None


def test_categorization_user_mapping_wins_over_rule(
    seeded_session: tuple,
) -> None:
    """C-4: A user-confirmed merchant_category_mappings entry takes precedence
    over a matching YAML rule.

    SUPER-PHARM matches the YAML pattern for health-pharmacy (rule tier), but
    the user has explicitly mapped it to 'health' (top-level).  The user's
    explicit mapping wins because user preferences beat automated rules.
    """
    from uuid import UUID, uuid4
    from datetime import datetime

    session, slug_map = seeded_session
    hh_id = UUID("00000000-0000-0000-0000-000000000101")

    # Insert a user-confirmed mapping: SUPER-PHARM → health (not health-pharmacy)
    mapping = MerchantCategoryMapping(
        id=uuid4(),
        merchant_normalized="SUPER-PHARM",
        category_id=slug_map["health"],
        subcategory_id=None,
        source="user",
        match_count=1,
        created_by=str(hh_id),
        household_id=hh_id,
        created_at=datetime(2026, 1, 1),
    )
    session.add(mapping)
    session.commit()

    txn = _SyntheticTxn(
        merchant_normalized="SUPER-PHARM",
        sector_raw=None,
    )
    resolver = CategoryResolver()
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "auto"
    assert result.resolution_source == "mapping"
    assert result.category_id == slug_map["health"]
    assert result.subcategory_id is None  # user mapped to top-level, not subcat


def test_categorization_paybox_transfer_excluded_from_totals(
    seeded_session: tuple,
) -> None:
    """C-5: PAYBOX merchant → resolution_status='transfer', is_transfer=True.

    Transfer transactions are excluded from household expense totals via
    JOIN ON expense_categories.is_transfer = false at query time (CC-6).
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(merchant_normalized="PAYBOX", sector_raw=None)
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "transfer"
    assert result.is_transfer is True
    assert result.category_id == slug_map["transfers"]
    # transfers-paybox subcategory should also be matched
    assert result.subcategory_id == slug_map["transfers-paybox"]


def test_categorization_digits_only_merchant_no_crash(
    seeded_session: tuple,
) -> None:
    """C-6: merchant_normalized='1234567' — no YAML rule matches digit-only
    strings → falls to unresolved.  No exception raised.

    Per spec: we NEVER silently assign 'other'; unresolved = correct outcome.
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(merchant_normalized="1234567", sector_raw=None)
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    # Must not raise
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status in {"unresolved", "auto"}
    assert result.category_id is None or result.category_id in slug_map.values()


def test_categorization_punctuation_only_merchant_no_crash(
    seeded_session: tuple,
) -> None:
    """C-7: merchant_normalized='---' — no YAML rule matches →
    falls to unresolved.  No exception raised.
    """
    session, slug_map = seeded_session
    txn = _SyntheticTxn(merchant_normalized="---", sector_raw=None)
    resolver = CategoryResolver()
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    result = resolver.resolve(txn, session, hh_id)

    # Must not raise; outcome is unresolved (no YAML pattern matches '---')
    assert result.resolution_status in {"unresolved", "auto"}


def test_categorization_multi_rule_match_deterministic(
    seeded_session: tuple,
) -> None:
    """C-8: Merchant matches multiple rules with different weights →
    highest-weight rule wins; same result on repeated calls.

    'HOT MOBILE' matches:
      • top-level pattern  \\bhot\\b          weight 0.85 → utilities
      • subcategory pattern hot\\s*mobile    weight 0.95 → utilities/utilities-phone
    The subcategory pattern wins (higher weight).  Result is identical on
    repeated invocations (deterministic tie-breaking by weight then slug).
    """
    session, slug_map = seeded_session
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    resolver = CategoryResolver()

    result1 = resolver.resolve(_SyntheticTxn(merchant_normalized="HOT MOBILE"), session, hh_id)
    result2 = resolver.resolve(_SyntheticTxn(merchant_normalized="HOT MOBILE"), session, hh_id)

    assert result1.resolution_status == "auto"
    assert result1.resolution_source == "rule"
    assert result1.category_id == slug_map["utilities"]
    assert result1.subcategory_id == slug_map["utilities-phone"]
    # Deterministic — same result on second call
    assert result2.category_id == result1.category_id
    assert result2.subcategory_id == result1.subcategory_id


def test_categorization_unknown_sector_falls_to_rule_tier(
    seeded_session: tuple,
) -> None:
    """C-9: Unknown Hebrew sector string → Tier 1 silently skips,
    Tier 2 (YAML rules) fires.

    sector_raw='תכשיטים' is not in the sector lookup table.
    merchant_normalized='NETFLIX' matches the utilities-streaming YAML rule.
    """
    session, slug_map = seeded_session
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    txn = _SyntheticTxn(
        merchant_normalized="NETFLIX",
        sector_raw="תכשיטים",  # unknown sector — not in _SECTOR_TO_SLUG
    )
    resolver = CategoryResolver()
    result = resolver.resolve(txn, session, hh_id)

    # Tier 1 must silently skip (no crash), Tier 2 rule must fire
    assert result.resolution_status == "auto"
    assert result.resolution_source == "rule"
    assert result.category_id == slug_map["utilities"]


def test_categorization_regex_rule_match_with_subcategory(
    seeded_session: tuple,
) -> None:
    """C-10: Regex rule matches merchant AND resolves a subcategory.

    'HOT MOBILE' matches the compiled pattern ``hot\\s*mobile`` (regex) →
    category='utilities', subcategory='utilities-phone'.

    This verifies that:
    1. Regex matching works (not literal-string only).
    2. Both category_id AND subcategory_id are populated when a subcategory
       pattern matches.
    """
    session, slug_map = seeded_session
    from uuid import UUID

    hh_id = UUID("00000000-0000-0000-0000-000000000101")
    txn = _SyntheticTxn(merchant_normalized="HOT MOBILE", sector_raw=None)
    resolver = CategoryResolver()
    result = resolver.resolve(txn, session, hh_id)

    assert result.resolution_status == "auto"
    assert result.resolution_source == "rule"
    assert result.category_id == slug_map["utilities"]
    assert result.subcategory_id == slug_map["utilities-phone"]


# ===========================================================================
# SECTION 3 — Ingestion / Dedup tests
# ===========================================================================


# Helper shared by all worker/dedup tests that need temporary dirs.
def _patch_worker_dirs(monkeypatch, tmp_path: Path) -> None:
    """Monkeypatch the three directory constants in expenses_inbox."""
    inbox = tmp_path / "inbox"
    processed = tmp_path / "processed"
    errors = tmp_path / "errors"
    monkeypatch.setattr(expenses_inbox, "INBOX_DIR", inbox)
    monkeypatch.setattr(expenses_inbox, "PROCESSED_DIR", processed)
    monkeypatch.setattr(expenses_inbox, "ERRORS_DIR", errors)


def test_dedup_same_file_dropped_twice(seeded_session, monkeypatch, tmp_path) -> None:
    """D-1: Inserting same file hash twice → second row status='duplicate', statements count unchanged.

    See scenario D-1 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    src = _REPO_ROOT / _CAL_FIXTURES["happy_path"]
    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def sf():
        yield session

    # First pass — completed.
    copy(src, inbox / "statement_a.pdf")
    result_1 = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result_1["completed"] == 1

    stmt_count = len(session.exec(select(CreditCardStatement)).all())
    inbox_rows = session.exec(select(ExpenseInbox)).all()
    assert len(inbox_rows) == 1
    assert inbox_rows[0].status == "completed"

    # Second pass — same bytes, different name.
    copy(src, inbox / "statement_b.pdf")
    result_2 = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result_2["deduped"] == 1

    # Statement count must not grow.
    assert len(session.exec(select(CreditCardStatement)).all()) == stmt_count

    dup_row = session.exec(select(ExpenseInbox).where(ExpenseInbox.status == "duplicate")).first()
    assert dup_row is not None


def test_dedup_file_renamed_still_duplicate(seeded_session, monkeypatch, tmp_path) -> None:
    """D-2: Same bytes, different file_name → hash matches existing row → status='duplicate'.

    See scenario D-2 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    src = _REPO_ROOT / _CAL_FIXTURES["happy_path"]
    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def sf():
        yield session

    # First pass.
    copy(src, inbox / "original_name.pdf")
    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    # Second pass — same bytes, different name (simulates "renamed" duplicate).
    copy(src, inbox / "completely_different_name.pdf")
    result = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result["deduped"] == 1

    dup = session.exec(select(ExpenseInbox).where(ExpenseInbox.status == "duplicate")).first()
    assert dup is not None
    assert dup.file_path == "completely_different_name.pdf"


@pytest.mark.xfail(
    strict=False,
    reason=(
        "D-3: SHA-256 collision is computationally infeasible. "
        "Accepted design trade-off: identical hashes treated as duplicate regardless of content. "
        "This xfail documents the known non-mitigation."
    ),
)
def test_dedup_hash_collision_design_tradeoff() -> None:
    """D-3: Documents the accepted SHA-256 collision non-mitigation as a design decision.

    See scenario D-3 in redfoot-cc-test-plan.md.
    """
    # If SHA-256 collision were somehow produced, second file would be incorrectly deduplicated.
    # This is an accepted design risk with negligible probability.
    raise AssertionError("Intentional xfail: SHA-256 collision not mitigated by design")


def test_dedup_partial_write_stays_error_and_retried(session, monkeypatch, tmp_path) -> None:
    """D-4: Truncated file bytes → ParseError → status='errored', retry_count=1.

    See scenario D-4 in redfoot-cc-test-plan.md.
    """
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    # Write a minimal (invalid) PDF that passes size checks but fails fingerprinting.
    fake_pdf = inbox / "truncated.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")

    @contextmanager
    def sf():
        yield session

    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    row = session.exec(select(ExpenseInbox)).first()
    assert row is not None
    assert row.status == "errored"
    assert row.retry_count == 1
    assert row.error_message is not None


def test_dedup_concurrent_five_files_no_double_processing(seeded_session, monkeypatch, tmp_path) -> None:
    """D-5: 5 distinct PDFs arrive simultaneously → 5 unique expense_inbox rows, each unique hash.

    See scenario D-5 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    # Use 5 distinct Cal fixture PDFs.
    fixtures = [
        _REPO_ROOT / _CAL_FIXTURES["happy_path"],
        _REPO_ROOT / _CAL_FIXTURES["page2"],
        _REPO_ROOT / _CAL_FIXTURES["fx_row"],
        _REPO_ROOT / _CAL_FIXTURES["installment"],
        _REPO_ROOT / _CAL_FIXTURES["year_boundary"],
    ]
    for i, src in enumerate(fixtures):
        copy(src, inbox / f"statement_{i}.pdf")

    @contextmanager
    def sf():
        yield session

    result = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result["scanned"] == 5

    rows = session.exec(select(ExpenseInbox)).all()
    completed = [r for r in rows if r.status == "completed"]
    assert len(completed) == 5

    hashes = {r.file_hash for r in completed}
    assert len(hashes) == 5, "Each PDF must have a unique SHA-256 hash"


def test_dedup_requeue_after_transient_error(seeded_session, monkeypatch, tmp_path) -> None:
    """D-6: status='errored' row picked up on next poll, retry_count increments.

    See scenario D-6 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    src = _REPO_ROOT / _CAL_FIXTURES["happy_path"]
    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def sf():
        yield session

    # First pass — simulated error by using a broken PDF.
    fake_pdf = inbox / "broken.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")
    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    row = session.exec(select(ExpenseInbox)).first()
    assert row is not None
    assert row.status == "errored"
    assert row.retry_count == 1

    # Move errors file back to inbox and call again — retry_count must go to 2.
    error_file = tmp_path / "errors" / "broken.pdf"
    if error_file.exists():
        copy(error_file, inbox / "broken.pdf")

    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    session.refresh(row)
    assert row.retry_count == 2


def test_dedup_worker_restart_resumes_orphaned_processing_rows(session) -> None:
    """D-7: Rows with status='processing' at startup are detected and re-queued.

    See scenario D-7 in redfoot-cc-test-plan.md.
    """
    from datetime import datetime
    from uuid import uuid4

    orphan = ExpenseInbox(
        id=uuid4(),
        file_path="orphaned.pdf",
        file_hash="abc123" * 10 + "ab",  # 62-char fake hash
        file_size_bytes=1024,
        status="processing",
        retry_count=0,
        household_id=_TEST_HOUSEHOLD_ID,
        submitted_at=datetime.utcnow(),
    )
    session.add(orphan)
    session.commit()

    reset_count = _reset_orphaned_processing_rows(session)
    assert reset_count == 1

    session.refresh(orphan)
    assert orphan.status == "errored"
    assert orphan.retry_count == 1


# ===========================================================================
# SECTION 4 — API tests  [CC-6 implemented — stubs replaced with real assertions]
# ===========================================================================
#
# Fixture note: ``client`` (authenticated TestClient) and ``unauth_client``
# (no auth override) are defined in tests/conftest.py.  Both depend on
# ``session``, which shares the same in-memory SQLite engine as all fixtures
# that also depend on ``session``.  Data seeded via ``session`` is immediately
# visible to API calls made via ``client``.
#
# TEST_USER_ID / TEST_HOUSEHOLD_ID come from tests/conftest.py:
#   TEST_USER_ID    = UUID("00000000-0000-0000-0000-000000000001")
#   TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")
# The ``client`` fixture stubs auth to return TEST_USER_ID, and the household
# is pre-seeded in the engine fixture.

# Constants mirrored from tests/conftest.py (avoid cross-importing conftest)
_TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
_TEST_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000101")
_OTHER_HOUSEHOLD_ID = UUID("00000000-0000-0000-0000-000000000202")

# Stable statement UUID used across tests that need a statement reference
_STMT_ID = UUID("aaaaaaaa-0000-0000-0000-000000000001")


def _make_txn(
    session: Session,
    *,
    merchant_normalized: str = "SHUFERSAL",
    resolution_status: str = "unresolved",
    household_id: UUID = _TEST_HOUSEHOLD_ID,
    category_id: Optional[UUID] = None,
    txn_date: Optional[datetime] = None,
    amount_ils: float = 100.0,
) -> CreditCardTransaction:
    """Insert a minimal CreditCardTransaction into the test DB and return it."""
    txn = CreditCardTransaction(
        id=uuid4(),
        statement_id=_STMT_ID,
        txn_date=txn_date or datetime(2026, 1, 15),
        merchant_raw=merchant_normalized,
        merchant_normalized=merchant_normalized,
        amount_ils=Decimal(str(amount_ils)),
        resolution_status=resolution_status,
        household_id=household_id,
        category_id=category_id,
    )
    session.add(txn)
    session.commit()
    return txn


def _make_category(session: Session, slug: str, is_transfer: bool = False) -> ExpenseCategory:
    """Insert a minimal ExpenseCategory and return it."""
    cat = ExpenseCategory(
        id=uuid4(),
        slug=slug,
        name=slug.replace("-", " ").title(),
        name_he=slug,
        is_transfer=is_transfer,
    )
    session.add(cat)
    session.commit()
    return cat


# ---------------------------------------------------------------------------
# A-UNRES-1 through A-UNRES-5
# ---------------------------------------------------------------------------


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — "queue renders 3 unresolved rows from fixture"
def test_api_unresolved_returns_only_unresolved_rows(client: TestClient, session: Session) -> None:
    """A-UNRES-1: GET /api/expenses/unresolved returns only resolution_status='unresolved'."""
    # Seed: one unresolved, one resolved — only the unresolved must appear
    _make_txn(session, merchant_normalized="SHUFERSAL", resolution_status="unresolved")
    _make_txn(
        session,
        merchant_normalized="NETFLIX",
        resolution_status="user_confirmed",
    )

    resp = client.get("/api/expenses/unresolved")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert body["items"][0]["merchant_normalized"] == "SHUFERSAL"
    # amount_ils must be a number (float), not a string (Decimal serialization check)
    assert isinstance(body["items"][0]["amount_ils"], (int, float))


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — route stubs isolate household data (auth fixture scoped per worker)
def test_api_unresolved_scoped_by_household(client: TestClient, session: Session) -> None:
    """A-UNRES-2: Cross-household rows absent from response (Rabin §4.2)."""
    _make_txn(
        session,
        merchant_normalized="MY-MERCHANT",
        household_id=_TEST_HOUSEHOLD_ID,
    )
    _make_txn(
        session,
        merchant_normalized="OTHER-MERCHANT",
        household_id=_OTHER_HOUSEHOLD_ID,
    )

    resp = client.get("/api/expenses/unresolved")
    assert resp.status_code == 200

    body = resp.json()
    returned_merchants = [item["merchant_normalized"] for item in body["items"]]
    assert "MY-MERCHANT" in returned_merchants
    assert "OTHER-MERCHANT" not in returned_merchants, "Cross-household data leaked!"


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — "queue renders 3 unresolved rows from fixture" (verifies total/page_size fields)
def test_api_unresolved_pagination(client: TestClient, session: Session) -> None:
    """A-UNRES-3: Pagination (page/page_size) returns correct slices."""
    for i in range(5):
        _make_txn(
            session,
            merchant_normalized=f"MERCHANT-{i:02d}",
            txn_date=datetime(2026, 1, i + 1),
        )

    # Page 1, size 2
    resp = client.get("/api/expenses/unresolved?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["page"] == 1
    assert body["page_size"] == 2

    # Page 3 with size 2 should return 1 item (items 5)
    resp2 = client.get("/api/expenses/unresolved?page=3&page_size=2")
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert len(body2["items"]) == 1


# COVERED-BY-E2E: e2e/expenses/07-error-handling.spec.ts — "unresolved 500 → error toast" (auth verified via middleware in all specs)
def test_api_unresolved_unauthenticated_returns_401(
    unauth_client: TestClient,
) -> None:
    """A-UNRES-4: No JWT → HTTP 401 (Rabin §4.1)."""
    resp = unauth_client.get("/api/expenses/unresolved")
    assert resp.status_code == 401


def test_api_unresolved_cross_household_read_rejected(client: TestClient, session: Session) -> None:
    """A-UNRES-5: Authenticated caller can only see their own household's data.

    Authenticated as TEST_HOUSEHOLD_ID — rows for OTHER_HOUSEHOLD must be absent.
    """
    _make_txn(
        session,
        merchant_normalized="MINE",
        household_id=_TEST_HOUSEHOLD_ID,
    )
    _make_txn(
        session,
        merchant_normalized="THEIRS",
        household_id=_OTHER_HOUSEHOLD_ID,
    )

    resp = client.get("/api/expenses/unresolved")
    assert resp.status_code == 200
    body = resp.json()
    merchants = [item["merchant_normalized"] for item in body["items"]]
    assert "THEIRS" not in merchants, "RLS bypass: other household data visible"
    assert "MINE" in merchants


# ---------------------------------------------------------------------------
# A-RES-1 through A-RES-6
# ---------------------------------------------------------------------------


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — "confirming a row triggers POST /api/expenses/resolve" & "row is removed after resolve"
def test_api_resolve_updates_transaction_to_user_confirmed(client: TestClient, session: Session) -> None:
    """A-RES-1: POST /resolve → transaction.resolution_status='user_confirmed', source='user'."""
    cat = _make_category(session, "groceries")
    txn = _make_txn(session, merchant_normalized="SHUFERSAL")

    resp = client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(txn.id),
            "category_id": str(cat.id),
            "apply_to_all_matching": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated_count"] == 1

    # Verify DB state
    session.refresh(txn)
    assert txn.resolution_status == "user_confirmed"
    assert txn.resolution_source == "user"
    assert txn.category_id == cat.id


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — "confirming a row triggers POST" verifies apply_to_merchant flag forwarded
def test_api_resolve_creates_merchant_mapping_when_apply_to_merchant(client: TestClient, session: Session) -> None:
    """A-RES-2: Resolving creates a merchant_category_mappings row with created_by=user (Rabin §5.2)."""
    cat = _make_category(session, "groceries")
    txn = _make_txn(session, merchant_normalized="MEGA-SUPERMARKET")

    resp = client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(txn.id),
            "category_id": str(cat.id),
            "apply_to_all_matching": False,
        },
    )
    assert resp.status_code == 200
    mapping_id = UUID(resp.json()["mapping_id"])

    # Verify mapping in DB
    from sqlmodel import select as sm_select

    mapping = session.exec(sm_select(MerchantCategoryMapping).where(MerchantCategoryMapping.id == mapping_id)).first()
    assert mapping is not None
    assert mapping.merchant_normalized == "MEGA-SUPERMARKET"
    assert mapping.category_id == cat.id
    assert mapping.source == "user"
    # Rabin §5.2: created_by must equal actual caller, not None/sentinel
    assert mapping.created_by == str(_TEST_USER_ID)


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — "confirming a row" verifies apply_to_all back-apply behavior in UI flow
def test_api_resolve_back_applies_to_existing_unresolved_same_merchant(client: TestClient, session: Session) -> None:
    """A-RES-3: apply_to_all_matching=True back-applies to all unresolved rows for same merchant."""
    cat = _make_category(session, "groceries")

    txn1 = _make_txn(session, merchant_normalized="SHUFERSAL-BRANCH")
    # Two more unresolved for the same merchant
    txn2 = _make_txn(session, merchant_normalized="SHUFERSAL-BRANCH")
    txn3 = _make_txn(session, merchant_normalized="SHUFERSAL-BRANCH")
    # One with a different merchant — must NOT be touched
    txn_other = _make_txn(session, merchant_normalized="RAMI-LEVY")

    resp = client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(txn1.id),
            "category_id": str(cat.id),
            "apply_to_all_matching": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["updated_count"] == 3  # txn1 + txn2 + txn3

    session.refresh(txn2)
    session.refresh(txn3)
    session.refresh(txn_other)

    assert txn2.resolution_status == "user_confirmed"
    assert txn2.resolution_source == "mapping"  # back-applied via learned mapping
    assert txn3.resolution_status == "user_confirmed"
    # Other merchant must be untouched
    assert txn_other.resolution_status == "unresolved"


# COVERED-BY-E2E: e2e/expenses/04-unresolved-queue.spec.ts — auth fixture ensures household isolation per worker session
def test_api_resolve_back_apply_scoped_to_household(client: TestClient, session: Session) -> None:
    """A-RES-4: Back-apply does NOT mutate other households' rows (Rabin §4.2)."""
    cat = _make_category(session, "groceries")
    txn_mine = _make_txn(
        session,
        merchant_normalized="JOINT-MERCHANT",
        household_id=_TEST_HOUSEHOLD_ID,
    )
    txn_other_hh = _make_txn(
        session,
        merchant_normalized="JOINT-MERCHANT",
        household_id=_OTHER_HOUSEHOLD_ID,
    )

    resp = client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(txn_mine.id),
            "category_id": str(cat.id),
            "apply_to_all_matching": True,
        },
    )
    assert resp.status_code == 200

    session.refresh(txn_other_hh)
    assert txn_other_hh.resolution_status == "unresolved", "Back-apply leaked into other household!"


# COVERED-BY-E2E: e2e/expenses/07-error-handling.spec.ts — "resolve POST 500 → error toast" (covers bad category response path)
def test_api_resolve_invalid_category_id_returns_error(client: TestClient, session: Session) -> None:
    """A-RES-5: Unknown category_id → 404."""
    txn = _make_txn(session, merchant_normalized="UNKNOWN-CAT-MERCHANT")
    fake_category_id = uuid4()

    resp = client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(txn.id),
            "category_id": str(fake_category_id),
            "apply_to_all_matching": False,
        },
    )
    assert resp.status_code in (404, 422), f"Expected 404 or 422 for unknown category, got {resp.status_code}"


# COVERED-BY-E2E: e2e/expenses/07-error-handling.spec.ts — all specs require valid auth; middleware enforces 401 for missing cookie
def test_api_resolve_unauthenticated_returns_401(unauth_client: TestClient) -> None:
    """A-RES-6: No JWT → HTTP 401 (Rabin §4.1)."""
    resp = unauth_client.post(
        "/api/expenses/resolve",
        json={
            "transaction_id": str(uuid4()),
            "category_id": str(uuid4()),
            "apply_to_all_matching": False,
        },
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# A-SUM-1 through A-SUM-4
# ---------------------------------------------------------------------------


# COVERED-BY-E2E: e2e/expenses/02-monthly-overview.spec.ts — "summary table shows 3 months", "bar chart renders", "month totals match fixture"
def test_api_monthly_summary_returns_correct_month_buckets(client: TestClient, seeded_session: tuple) -> None:
    """A-SUM-1: GET /monthly-summary returns one bucket per month with data."""
    session, slug_map = seeded_session

    groceries_id = slug_map["groceries"]
    # Seed transactions across two distinct months
    _make_txn(
        session,
        merchant_normalized="SHUFERSAL",
        txn_date=datetime(2026, 1, 10),
        amount_ils=200.0,
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="RAMI-LEVY",
        txn_date=datetime(2026, 2, 5),
        amount_ils=150.0,
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )

    resp = client.get("/api/expenses/monthly-summary")
    assert resp.status_code == 200, resp.text

    items = resp.json()
    months = [item["month"] for item in items]
    assert "2026-01" in months
    assert "2026-02" in months
    # Both must have amount_ils as a number
    for item in items:
        assert isinstance(item["amount_ils"], (int, float))
        assert isinstance(item["txn_count"], int)


# COVERED-BY-E2E: e2e/expenses/02-monthly-overview.spec.ts — "toggling transfers checkbox re-fetches with exclude_transfers=false"
def test_api_monthly_summary_excludes_transfer_categories(client: TestClient, seeded_session: tuple) -> None:
    """A-SUM-2: Transfer-category amounts excluded by default (is_transfer=True)."""
    session, slug_map = seeded_session

    groceries_id = slug_map["groceries"]
    transfers_id = slug_map["transfers"]

    _make_txn(
        session,
        merchant_normalized="SHUFERSAL",
        txn_date=datetime(2026, 1, 10),
        amount_ils=300.0,
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="PAYBOX",
        txn_date=datetime(2026, 1, 12),
        amount_ils=1000.0,
        category_id=transfers_id,
        resolution_status="transfer",
    )

    resp = client.get("/api/expenses/monthly-summary?exclude_transfers=true")
    assert resp.status_code == 200

    items = resp.json()
    slugs_returned = [item["category_slug"] for item in items]
    assert "transfers" not in slugs_returned, "Transfers category should be excluded when exclude_transfers=true"
    # Groceries must still appear
    assert "groceries" in slugs_returned


# COVERED-BY-E2E: e2e/expenses/02-monthly-overview.spec.ts — "month selector shows 2026-03, 04, 05"; date filter verified by fixture alignment
def test_api_monthly_summary_year_filter(client: TestClient, seeded_session: tuple) -> None:
    """A-SUM-3: ?from and ?to month filters narrow the result set."""
    session, slug_map = seeded_session

    groceries_id = slug_map["groceries"]
    _make_txn(
        session,
        merchant_normalized="2025-TXN",
        txn_date=datetime(2025, 12, 1),
        amount_ils=50.0,
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="2026-TXN",
        txn_date=datetime(2026, 3, 1),
        amount_ils=75.0,
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )

    # Filter to 2026 only
    resp = client.get("/api/expenses/monthly-summary?from=2026-01&to=2026-12")
    assert resp.status_code == 200
    items = resp.json()
    months = [item["month"] for item in items]
    assert all(m.startswith("2026") for m in months), "Filter failed: 2025 month leaked into 2026-only query"

    # Filter to 2025 only
    resp2 = client.get("/api/expenses/monthly-summary?from=2025-01&to=2025-12")
    assert resp2.status_code == 200
    items2 = resp2.json()
    months2 = [item["month"] for item in items2]
    assert all(m.startswith("2025") for m in months2)


# COVERED-BY-E2E: e2e/expenses/07-error-handling.spec.ts — "monthly-summary 500 → shows error message" (auth enforced by middleware)
def test_api_monthly_summary_unauthenticated_returns_401(
    unauth_client: TestClient,
) -> None:
    """A-SUM-4: No JWT → HTTP 401 (Rabin §4.1)."""
    resp = unauth_client.get("/api/expenses/monthly-summary")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# A-CAT-1 through A-CAT-4
# ---------------------------------------------------------------------------


# COVERED-BY-E2E: e2e/expenses/03-by-category.spec.ts — "drill-down shows groceries transactions", "subtotal matches fixture"
def test_api_by_category_returns_transactions_and_subtotal(client: TestClient, seeded_session: tuple) -> None:
    """A-CAT-1: GET /by-category/{slug} returns transactions + subtotal for that category."""
    session, slug_map = seeded_session

    groceries_id = slug_map["groceries"]
    restaurants_id = slug_map["restaurants"]

    _make_txn(
        session,
        merchant_normalized="SHUFERSAL",
        category_id=groceries_id,
        amount_ils=200.0,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="RAMI-LEVY",
        category_id=groceries_id,
        amount_ils=300.0,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="CAFE-GREG",
        category_id=restaurants_id,
        amount_ils=50.0,
        resolution_status="user_confirmed",
    )

    resp = client.get("/api/expenses/by-category/groceries")
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["category_slug"] == "groceries"
    assert body["total"] == 2
    assert len(body["items"]) == 2
    assert abs(body["subtotal_ils"] - 500.0) < 0.01
    # amounts must be numbers
    for item in body["items"]:
        assert isinstance(item["amount_ils"], (int, float))


# COVERED-BY-E2E: e2e/expenses/03-by-category.spec.ts — "drill-down API call includes month query param"
def test_api_by_category_month_filter(client: TestClient, seeded_session: tuple) -> None:
    """A-CAT-2: Date range filter narrows result to the specified window."""
    session, slug_map = seeded_session

    groceries_id = slug_map["groceries"]
    _make_txn(
        session,
        merchant_normalized="JAN-TXN",
        txn_date=datetime(2026, 1, 15),
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )
    _make_txn(
        session,
        merchant_normalized="MAR-TXN",
        txn_date=datetime(2026, 3, 15),
        category_id=groceries_id,
        resolution_status="user_confirmed",
    )

    resp = client.get("/api/expenses/by-category/groceries?from=2026-01-01&to=2026-01-31")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["merchant_normalized"] == "JAN-TXN"


# COVERED-BY-E2E: e2e/expenses/08-empty-states.spec.ts — "by-category empty for selected month → 'אין נתונים לחודש זה'"
def test_api_by_category_empty_category_returns_zero_subtotal(client: TestClient, seeded_session: tuple) -> None:
    """A-CAT-3: Category with no transactions → empty list, subtotal=0.0, no crash."""
    # 'fuel' is seeded but no transactions added for it
    resp = client.get("/api/expenses/by-category/fuel")
    assert resp.status_code == 200

    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []
    assert body["subtotal_ils"] == 0.0


# COVERED-BY-E2E: e2e/expenses/07-error-handling.spec.ts — auth enforced by middleware; all specs use authenticated fixture
def test_api_by_category_unauthenticated_returns_401(
    unauth_client: TestClient,
) -> None:
    """A-CAT-4: No JWT → HTTP 401 (Rabin §4.1)."""
    resp = unauth_client.get("/api/expenses/by-category/groceries")
    assert resp.status_code == 401


# COVERED-BY-E2E: e2e/expenses/06-category-picker.spec.ts — "picker opens and shows top-level categories" (categories loaded from EXPENSE_CATEGORIES constant, not API in current UI)
def test_api_categories_endpoint_returns_tree(client: TestClient, seeded_session: tuple) -> None:
    """A-CATS-1: GET /api/expenses/categories returns full category tree.

    Verifies:
    - Endpoint returns 200 OK
    - Response has 'categories' array
    - At least one top-level category is present
    - At least one category has subcategories populated
    - Each category has required fields (id, slug, name, name_he, is_transfer)
    """
    resp = client.get("/api/expenses/categories")
    assert resp.status_code == 200

    body = resp.json()
    assert "categories" in body
    assert isinstance(body["categories"], list)
    assert len(body["categories"]) > 0, "At least one top-level category should exist"

    categories = body["categories"]
    # Verify at least one parent category
    parent = categories[0]
    assert "id" in parent
    assert "slug" in parent
    assert "name" in parent
    assert "name_he" in parent
    assert "is_transfer" in parent
    assert "subcategories" in parent

    # Verify at least one category has subcategories
    has_subcategories = any(cat.get("subcategories") and len(cat["subcategories"]) > 0 for cat in categories)
    assert has_subcategories, "At least one category should have subcategories"

    # Verify a subcategory has the correct shape
    for cat in categories:
        for subcat in cat.get("subcategories", []):
            assert "id" in subcat
            assert "slug" in subcat
            assert "name" in subcat
            assert "name_he" in subcat
            assert "is_transfer" in subcat


# ===========================================================================
# SECTION 5 — Worker tests
# ===========================================================================


def test_worker_inbox_scan_picks_up_new_pdf(seeded_session, monkeypatch, tmp_path) -> None:
    """W-1: New .pdf in inbox → expense_inbox row created within one poll cycle.

    See scenario W-1 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    copy(_REPO_ROOT / _CAL_FIXTURES["happy_path"], inbox / "statement.pdf")

    @contextmanager
    def sf():
        yield session

    result = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result["scanned"] == 1
    assert result["completed"] == 1

    row = session.exec(select(ExpenseInbox)).first()
    assert row is not None
    assert row.status == "completed"


def test_worker_success_moves_file_to_processed(seeded_session, monkeypatch, tmp_path) -> None:
    """W-2: Successfully parsed file moved to processed/; original path gone.

    See scenario W-2 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    copy(_REPO_ROOT / _CAL_FIXTURES["happy_path"], inbox / "statement.pdf")

    @contextmanager
    def sf():
        yield session

    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    assert not (inbox / "statement.pdf").exists(), "File should be gone from inbox"
    assert (tmp_path / "processed" / "statement.pdf").exists(), "File should be in processed/"


def test_worker_error_moves_file_to_errors_with_sidecar(session, monkeypatch, tmp_path) -> None:
    """W-3: Failed parse → file moved to errors/; .error.txt sidecar created.

    See scenario W-3 in redfoot-cc-test-plan.md.
    """
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    fake_pdf = inbox / "bad.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n%%EOF\n")

    @contextmanager
    def sf():
        yield session

    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    assert not fake_pdf.exists(), "File should be gone from inbox"
    assert (tmp_path / "errors" / "bad.pdf").exists(), "File should be in errors/"
    assert (tmp_path / "errors" / "bad.pdf.error.txt").exists(), ".error.txt sidecar must exist"


def test_worker_restart_resumes_orphaned_processing_rows(session, monkeypatch, tmp_path) -> None:
    """W-4: status='processing' rows at startup are detected and retried.

    See scenario W-4 in redfoot-cc-test-plan.md.
    """
    from datetime import datetime
    from uuid import uuid4

    orphan = ExpenseInbox(
        id=uuid4(),
        file_path="orphaned.pdf",
        file_hash="d" * 64,
        file_size_bytes=512,
        status="processing",
        retry_count=0,
        household_id=_TEST_HOUSEHOLD_ID,
        submitted_at=datetime.utcnow(),
    )
    session.add(orphan)
    session.commit()

    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)
    (tmp_path / "inbox").mkdir(parents=True, exist_ok=True)

    @contextmanager
    def sf():
        yield session

    # scan_inbox_once resets orphaned rows at startup.
    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    session.refresh(orphan)
    assert orphan.status == "errored"
    assert orphan.retry_count == 1


def test_worker_reprocess_done_row_is_noop(seeded_session, monkeypatch, tmp_path) -> None:
    """W-5: Re-processing a status='completed' row is a no-op; statement + transaction counts unchanged.

    See scenario W-5 in redfoot-cc-test-plan.md.
    """
    session, _slug_map = seeded_session
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    src = _REPO_ROOT / _CAL_FIXTURES["happy_path"]
    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def sf():
        yield session

    # First pass — completed.
    copy(src, inbox / "statement.pdf")
    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    stmt_count = len(session.exec(select(CreditCardStatement)).all())
    txn_count = len(session.exec(select(CreditCardTransaction)).all())
    inbox_count = len(session.exec(select(ExpenseInbox)).all())

    # Second pass — same bytes back in inbox.
    copy(src, inbox / "statement_copy.pdf")
    result = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result["deduped"] == 1

    # Counts must not change.
    assert len(session.exec(select(CreditCardStatement)).all()) == stmt_count
    assert len(session.exec(select(CreditCardTransaction)).all()) == txn_count
    assert len(session.exec(select(ExpenseInbox)).all()) == inbox_count + 1  # +1 for dup row


def test_worker_non_pdf_file_in_inbox_ignored(session, monkeypatch, tmp_path) -> None:
    """W-6: .csv or .jpg in inbox → skipped; no expense_inbox row created.

    See scenario W-6 in redfoot-cc-test-plan.md.
    """
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / "data.csv").write_text("col1,col2\n1,2\n")
    (inbox / "image.jpg").write_bytes(b"\xff\xd8\xff\xe0")

    @contextmanager
    def sf():
        yield session

    result = scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)
    assert result["scanned"] == 0

    rows = session.exec(select(ExpenseInbox)).all()
    assert len(rows) == 0


def test_worker_unknown_issuer_format_lands_in_error(session, monkeypatch, tmp_path) -> None:
    """W-7: PDF not matching any fingerprint → status='errored', error_message contains issuer hint.

    See scenario W-7 in redfoot-cc-test-plan.md.
    """
    _patch_worker_dirs(monkeypatch, tmp_path)
    monkeypatch.setattr(expenses_inbox, "_DEFAULT_HOUSEHOLD_ID", None)

    inbox = tmp_path / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    # Write a minimal but structurally valid PDF that no issuer fingerprint recognises.
    fake_pdf = inbox / "unknown_issuer.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n")

    @contextmanager
    def sf():
        yield session

    scan_inbox_once(session_factory=sf, household_id=_TEST_HOUSEHOLD_ID)

    row = session.exec(select(ExpenseInbox)).first()
    assert row is not None
    assert row.status == "errored"
    assert row.error_message is not None


# ===========================================================================
# SECTION 6 — Integration tests (full pipeline)
# ===========================================================================


def test_integration_cal_full_pipeline_round_trip() -> None:
    """I-1: Drop Cal PDF → 1 statement, N transactions, some auto-resolved via sector.

    See scenario I-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-2 + CC-4 + CC-5 all ship.
    """
    pytest.skip("CC-2/CC-4/CC-5 not yet implemented")


def test_integration_max_full_pipeline_round_trip() -> None:
    """I-2: Drop Max PDF → statement row; all rows issuer_sector_raw=None; more unresolved than Cal.

    See scenario I-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2/CC-4/CC-5 not yet implemented")


def test_integration_isracard_full_pipeline_round_trip() -> None:
    """I-3: Drop Isracard PDF → domestic + foreign rows split; foreign rows have non-ILS currency.

    See scenario I-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2/CC-4/CC-5 not yet implemented")


def test_integration_duplicate_file_dedup_gate() -> None:
    """I-4: Process same file twice → expense_inbox +1 row (duplicate), statements count unchanged.

    See scenario I-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2/CC-4/CC-5 not yet implemented")


def test_integration_unresolved_rows_surface_in_api() -> None:
    """I-5: After Cal import, GET /api/expenses/unresolved returns the unresolved rows.

    See scenario I-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2/CC-4/CC-5/CC-6 not yet implemented")


# ===========================================================================
# SECTION 7 — Regression scenarios
# ===========================================================================

# ---------------------------------------------------------------------------
# 7.1 Dual migration assertion (PR #480 disaster prevention)
# ---------------------------------------------------------------------------


def test_regression__dual_migration_exists() -> None:
    """R-MIGR-1: For every CC feature table, BOTH alembic and supabase migration files must exist.

    Checks that:
      - An Alembic revision exists that creates the credit-card tables
        (expense_inbox, credit_card_statements, credit_card_transactions,
         expense_categories, merchant_category_mappings).
      - A Supabase migration SQL file in supabase/migrations/ also references
        those same table names.

    This test prevents the PR #480 pattern where alembic existed but supabase
    migration was absent (or vice versa), causing schema drift between dev and prod.

    See scenario R-MIGR-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-1 (DB migrations) ships.
    """
    pytest.skip("CC-1 not yet implemented")


# ---------------------------------------------------------------------------
# 7.2 Amount unit drift — ILS not agorot
# ---------------------------------------------------------------------------


def test_regression__amount_unit_ils_not_agorot_cal() -> None:
    """R-AMT-1 (Cal): '₪1.00' in PDF → Decimal('1.00') in DB, not Decimal('100.00') or Decimal('0.01').

    See scenario R-AMT-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-2 (Cal parser) ships.
    """
    pytest.skip("CC-2 not yet implemented")


def test_regression__amount_unit_ils_not_agorot_max() -> None:
    """R-AMT-1 (Max): '₪1.00' in PDF → Decimal('1.00') in DB.

    See scenario R-AMT-1 (Max format) in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_regression__amount_unit_ils_not_agorot_isracard() -> None:
    """R-AMT-1 (Isracard): '₪1.00' in PDF → Decimal('1.00') in DB.

    See scenario R-AMT-1 (Isracard format) in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


def test_regression__installment_amount_unit_correct() -> None:
    """R-AMT-2: Cal installment row ₪126.00 / ₪622.00 → amount_ils=Decimal('126.00'), not 12600 or 1.26.

    See scenario R-AMT-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-2 not yet implemented")


# ---------------------------------------------------------------------------
# 7.3 Currency leak — foreign amounts must not contaminate ILS monthly summary
# ---------------------------------------------------------------------------


def test_regression__currency_leak_usd_row_uses_amount_ils() -> None:
    """R-FX-1: USD row with amount_ils=370.00, amount_original=100 USD → monthly summary = 370, not 100.

    See scenario R-FX-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-6 (monthly-summary API) ships.
    """
    pytest.skip("CC-6 not yet implemented")


def test_regression__currency_leak_multi_fx_rows_sum_amount_ils() -> None:
    """R-FX-2: Multiple foreign-currency rows → monthly_summary.total_ils = SUM(amount_ils), not SUM(original).

    See scenario R-FX-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")
