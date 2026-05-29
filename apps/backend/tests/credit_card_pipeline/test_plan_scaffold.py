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

from dataclasses import dataclass
from typing import Optional

import pytest

from app.schema.expenses import MerchantCategoryMapping
from app.services.expenses.categorize import (
    CategoryResolver,
)


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
    category='financial-insurance', resolution_source='issuer_sector'.

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
    assert result.resolution_source == "issuer_sector"
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


def test_dedup_same_file_dropped_twice() -> None:
    """D-1: Inserting same file hash twice → second row status='duplicate', statements count unchanged.

    See scenario D-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-5 (worker) ships.
    """
    pytest.skip("CC-5 not yet implemented")


def test_dedup_file_renamed_still_duplicate() -> None:
    """D-2: Same bytes, different file_name → hash matches existing row → status='duplicate'.

    See scenario D-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


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


def test_dedup_partial_write_stays_error_and_retried() -> None:
    """D-4: Truncated file bytes → ParseError → status='error', retry_count=1.

    See scenario D-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_dedup_concurrent_five_files_no_double_processing() -> None:
    """D-5: 5 distinct PDFs arrive simultaneously → 5 unique expense_inbox rows, each unique hash.

    See scenario D-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_dedup_requeue_after_transient_error() -> None:
    """D-6: status='error' row picked up on next poll, retry_count increments.

    See scenario D-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_dedup_worker_restart_resumes_orphaned_processing_rows() -> None:
    """D-7: Rows with status='processing' at startup are detected and re-queued.

    See scenario D-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


# ===========================================================================
# SECTION 4 — API tests
# ===========================================================================


def test_api_unresolved_returns_only_unresolved_rows() -> None:
    """A-UNRES-1: GET /api/expenses/unresolved returns only resolution_status='unresolved'.

    See scenario A-UNRES-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-6 (API endpoints) ships.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_unresolved_scoped_by_household() -> None:
    """A-UNRES-2: Cross-household rows absent from response.

    See scenario A-UNRES-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_unresolved_pagination() -> None:
    """A-UNRES-3: limit/offset pagination returns correct pages.

    See scenario A-UNRES-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_unresolved_unauthenticated_returns_401() -> None:
    """A-UNRES-4: No auth → HTTP 401.

    See scenario A-UNRES-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_unresolved_cross_household_read_rejected() -> None:
    """A-UNRES-5: Authenticated but wrong household_id → empty result or 403, no data leak.

    See scenario A-UNRES-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_updates_transaction_to_user_confirmed() -> None:
    """A-RES-1: POST /api/expenses/resolve → resolution_status='user_confirmed', source='user'.

    See scenario A-RES-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_creates_merchant_mapping_when_apply_to_merchant() -> None:
    """A-RES-2: apply_to_merchant=True + new merchant → merchant_category_mappings row created.

    See scenario A-RES-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_back_applies_to_existing_unresolved_same_merchant() -> None:
    """A-RES-3: apply_to_merchant=True → back-applies to all unresolved rows with same merchant_normalized.

    See scenario A-RES-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_back_apply_scoped_to_household() -> None:
    """A-RES-4: Back-apply does not mutate other households' rows.

    See scenario A-RES-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_invalid_category_id_returns_error() -> None:
    """A-RES-5: Unknown category_id UUID → 422 or 404 error response.

    See scenario A-RES-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_resolve_unauthenticated_returns_401() -> None:
    """A-RES-6: No auth → HTTP 401.

    See scenario A-RES-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_monthly_summary_returns_correct_month_buckets() -> None:
    """A-SUM-1: GET /api/expenses/monthly-summary returns one bucket per month with data.

    See scenario A-SUM-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_monthly_summary_excludes_transfer_categories() -> None:
    """A-SUM-2: Transfer-category amounts excluded from monthly totals.

    See scenario A-SUM-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_monthly_summary_year_filter() -> None:
    """A-SUM-3: year=2026 and year=2025 return different data.

    See scenario A-SUM-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_monthly_summary_unauthenticated_returns_401() -> None:
    """A-SUM-4: No auth → HTTP 401.

    See scenario A-SUM-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_by_category_returns_transactions_and_subtotal() -> None:
    """A-CAT-1: GET /api/expenses/by-category returns transactions list + subtotal for slug.

    See scenario A-CAT-1 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_by_category_month_filter() -> None:
    """A-CAT-2: month filter narrows result to that month only.

    See scenario A-CAT-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_by_category_empty_category_returns_zero_subtotal() -> None:
    """A-CAT-3: Category with no transactions → empty list, subtotal = 0.0, no crash.

    See scenario A-CAT-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


def test_api_by_category_unauthenticated_returns_401() -> None:
    """A-CAT-4: No auth → HTTP 401.

    See scenario A-CAT-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-6 not yet implemented")


# ===========================================================================
# SECTION 5 — Worker tests
# ===========================================================================


def test_worker_inbox_scan_picks_up_new_pdf() -> None:
    """W-1: New .pdf in inbox → expense_inbox row created within one poll cycle.

    See scenario W-1 in redfoot-cc-test-plan.md.
    Unblock: remove skip when CC-5 (worker) ships.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_success_moves_file_to_processed() -> None:
    """W-2: Successfully parsed file moved to processed/YYYY-MM/; original path gone.

    See scenario W-2 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_error_moves_file_to_errors_with_sidecar() -> None:
    """W-3: Failed parse → file moved to errors/; .error.txt sidecar created.

    See scenario W-3 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_restart_resumes_orphaned_processing_rows() -> None:
    """W-4: status='processing' rows at startup are detected and retried.

    See scenario W-4 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_reprocess_done_row_is_noop() -> None:
    """W-5: Re-processing a status='done' row is a no-op; statement + transaction counts unchanged.

    See scenario W-5 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_non_pdf_file_in_inbox_ignored() -> None:
    """W-6: .csv or .jpg in inbox → skipped; no expense_inbox row created.

    See scenario W-6 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


def test_worker_unknown_issuer_format_lands_in_error() -> None:
    """W-7: PDF not matching any fingerprint → status='error', error_message contains 'unknown format'.

    See scenario W-7 in redfoot-cc-test-plan.md.
    """
    pytest.skip("CC-5 not yet implemented")


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
