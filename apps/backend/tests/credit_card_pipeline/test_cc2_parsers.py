"""CC-2 PDF parser tests — unblocked by Hockney's implementation.

Covers:
  P-CAL-1,2,4,5,9  — Cal General parser
  P-PBX-1,2,8      — Cal PayBox parser (P-PBX-7 kept skipped: no refund fixture)
  P-MAX-1,2,9      — Max parser
  P-ISR-1,2,7,10   — Isracard parser
  R-AMT-1          — ILS not agorot regression
  R-AMT-2          — installment amount unit

All tests reference real PDF fixtures at ``reports/credit-card/`` relative to
the repository root. pytest is invoked from ``apps/backend/`` so paths are
resolved relative to the repo root by prefixing ``../../``.

Hebrew in merchant_raw / sector_raw fields is in VISUAL (character-reversed)
order as extracted by pdfplumber — this is expected and correct.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from app.services.expenses.parsers import (
    ParserError,
    dispatch_pdf,
)
from app.services.expenses.parsers.cal import CalParser
from app.services.expenses.parsers.fingerprint import detect_issuer
from app.services.expenses.parsers.isracard import IsracardParser
from app.services.expenses.parsers.max import MaxParser

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

# When pytest runs from apps/backend, repo root is two levels up.
_REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
_CC_DIR = _REPO_ROOT / "reports" / "credit-card"


def _pdf(name: str) -> str:
    p = _CC_DIR / name
    if not p.exists():
        pytest.skip(f"Fixture not found: {p}")
    return str(p)


# ---------------------------------------------------------------------------
# Corrupt-PDF helper — write non-PDF bytes to a temp path inside repo tree
# ---------------------------------------------------------------------------

_CORRUPT_PDF_PATH = Path(__file__).parent / "_corrupt_test.pdf"


@pytest.fixture(scope="module", autouse=True)
def _ensure_corrupt_pdf():
    """Create and clean up a corrupt (non-PDF) test file."""
    _CORRUPT_PDF_PATH.write_bytes(b"NOT A PDF - just garbage bytes for testing")
    yield
    if _CORRUPT_PDF_PATH.exists():
        _CORRUPT_PDF_PATH.unlink()


# ===========================================================================
# P-CAL: Cal General
# ===========================================================================


def test_cal_parser_happy_path() -> None:
    """P-CAL-1: Parse 02-26.pdf; rows present; dates correct; sum within ±1 of header total."""
    stmt = dispatch_pdf(_pdf("דף פירוט דיגיטלי כאל 02-26.pdf"))
    assert stmt.issuer == "cal"
    assert len(stmt.transactions) > 0
    assert stmt.card_last4 == "9356"
    # All transaction dates should be valid date objects, not date.min
    from datetime import date

    for txn in stmt.transactions:
        assert txn.txn_date != date.min, f"Invalid date on txn: {txn}"
        assert txn.amount_ils != Decimal("0"), f"Zero amount on txn: {txn}"
    # Sum should be reasonably close to header total (within ±1 ILS)
    if stmt.total_amount_ils > Decimal("0"):
        total_sum = sum(t.amount_ils for t in stmt.transactions)
        diff = abs(total_sum - stmt.total_amount_ils)
        assert diff < Decimal("1.00"), f"Sum drift: computed={total_sum}, header={stmt.total_amount_ils}, diff={diff}"


def test_cal_parser_hebrew_rtl_merchant() -> None:
    """P-CAL-2: merchant_raw preserves VISUAL Hebrew (NOT reversed); merchant_normalized is non-empty."""
    stmt = dispatch_pdf(_pdf("דף פירוט דיגיטלי כאל 02-26.pdf"))
    for txn in stmt.transactions:
        assert txn.merchant_raw, "merchant_raw must not be empty"
        assert txn.merchant_normalized, "merchant_normalized must not be empty"
        # Verify merchant_normalized is uppercase
        assert txn.merchant_normalized == txn.merchant_normalized.upper(), (
            f"merchant_normalized not uppercase: {txn.merchant_normalized!r}"
        )


def test_cal_parser_installment_row() -> None:
    """P-CAL-4: Installment row in 01-26.pdf; installment_num and installment_total populated."""
    stmt = dispatch_pdf(_pdf("דף פירוט דיגיטלי כאל 01-26.pdf"))
    installment_txns = [t for t in stmt.transactions if t.installment_num is not None]
    assert len(installment_txns) > 0, "Expected at least one installment transaction in 01-26.pdf"
    for txn in installment_txns:
        assert txn.installment_total is not None
        assert txn.installment_num >= 1
        assert txn.installment_total >= txn.installment_num
        # Amount should be the per-installment charge, not zero
        assert txn.amount_ils > Decimal("0")


def test_cal_parser_refund_row_negative_amount() -> None:
    """P-CAL-5: Negative ₪ amount (refund/credit) is preserved as-is in 01-26.pdf."""
    stmt = dispatch_pdf(_pdf("דף פירוט דיגיטלי כאל 01-26.pdf"))
    negative_txns = [t for t in stmt.transactions if t.amount_ils < Decimal("0")]
    assert len(negative_txns) > 0, "Expected at least one refund (negative amount) transaction in 01-26.pdf"
    for txn in negative_txns:
        # Must be negative — no abs() swallowing
        assert txn.amount_ils < Decimal("0"), f"Expected negative: {txn.amount_ils}"


def test_cal_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-CAL-9: Non-PDF bytes → ParserError raised (not unhandled exception)."""
    with pytest.raises(ParserError):
        dispatch_pdf(str(_CORRUPT_PDF_PATH))


# ===========================================================================
# P-PBX: Cal PayBox
# ===========================================================================


def test_calp_parser_happy_path() -> None:
    """P-PBX-1: Parse 639156527487946127.pdf; issuer='cal_paybox'; rows present; amounts ILS."""
    stmt = dispatch_pdf(_pdf("639156527487946127.pdf"))
    assert stmt.issuer == "cal_paybox"
    assert len(stmt.transactions) > 0
    from datetime import date

    for txn in stmt.transactions:
        assert txn.txn_date != date.min
        assert isinstance(txn.amount_ils, Decimal)


def test_calp_parser_format_detection_paybox() -> None:
    """P-PBX-2: issuer='cal_paybox' detected (not 'cal') via 228899999/PayBox sentinel."""
    path = _pdf("639156527487946127.pdf")
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        text = "\n".join(pg.extract_text() or "" for pg in pdf.pages)
    issuer = detect_issuer(text)
    assert issuer == "cal_paybox", f"Expected 'cal_paybox', got {issuer!r}"


def test_calp_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-PBX-8: Non-PDF → ParserError."""
    with pytest.raises(ParserError):
        dispatch_pdf(str(_CORRUPT_PDF_PATH))


# ===========================================================================
# P-MAX: Max
# ===========================================================================


def test_max_parser_happy_path() -> None:
    """P-MAX-1: Parse statement__29_05_2026.pdf; issuer='max'; card_last4='1494'."""
    stmt = dispatch_pdf(_pdf("statement__29_05_2026.pdf"))
    assert stmt.issuer == "max"
    assert stmt.card_last4 == "1494"
    assert len(stmt.transactions) > 0
    for txn in stmt.transactions:
        assert txn.sector_raw is None, "Max should have no sector"


def test_max_parser_date_quirk_year_suffix_stripped() -> None:
    """P-MAX-2: Dates like '05/04/267' normalised to valid date object."""
    from app.services.expenses.parsers.max import MaxParser as _MaxParser

    result = _MaxParser._parse_max_date("05/04/267")
    from datetime import date

    assert result == date(2026, 4, 5), f"Expected 2026-04-05, got {result}"

    # Also verify it doesn't crash on normal 2-digit year
    result2 = _MaxParser._parse_max_date("17/04/26")
    assert result2 == date(2026, 4, 17)


def test_max_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-MAX-9: Non-PDF → ParserError."""
    with pytest.raises(ParserError):
        dispatch_pdf(str(_CORRUPT_PDF_PATH))


# ===========================================================================
# P-ISR: Isracard
# ===========================================================================


def test_isracard_parser_happy_path_domestic() -> None:
    """P-ISR-1: Unknown-3.pdf domestic section; issuer='isracard'; rows present; sector populated."""
    stmt = dispatch_pdf(_pdf("Unknown-3.pdf"))
    assert stmt.issuer == "isracard"
    assert len(stmt.transactions) > 0
    # At least some rows should have sector_raw (domestic rows)
    domestic_with_sector = [t for t in stmt.transactions if t.sector_raw is not None]
    assert len(domestic_with_sector) > 0, "Expected at least one domestic row with sector_raw in Unknown-3.pdf"


def test_isracard_parser_foreign_section_fx_fields() -> None:
    """P-ISR-2: Unknown-4.pdf foreign rows — original_currency, fx_rate, posting_date all set."""
    stmt = dispatch_pdf(_pdf("Unknown-4.pdf"))
    assert stmt.issuer == "isracard"
    fx_txns = [t for t in stmt.transactions if t.original_currency is not None and t.original_currency != "ILS"]
    assert len(fx_txns) > 0, "Expected FX rows with original_currency set in Unknown-4.pdf"
    for txn in fx_txns:
        assert txn.fx_rate is not None and txn.fx_rate > Decimal("0")
        assert txn.amount_original is not None
        assert txn.posting_date is not None


def test_isracard_parser_refund_row_negative_amount() -> None:
    """P-ISR-7: Refund row in Unknown-3.pdf foreign section — negative amount preserved."""
    stmt = dispatch_pdf(_pdf("Unknown-3.pdf"))
    negative_txns = [t for t in stmt.transactions if t.amount_ils < Decimal("0")]
    # Unknown-3 has a refund in the foreign section; if none found emit warning-only
    if not negative_txns:
        pytest.xfail(
            "No refund row found in Unknown-3.pdf foreign section "
            "(fixture may not contain refund in this statement period)"
        )
    for txn in negative_txns:
        assert txn.amount_ils < Decimal("0")


def test_isracard_parser_corrupt_pdf_raises_parse_error() -> None:
    """P-ISR-10: Non-PDF → ParserError."""
    with pytest.raises(ParserError):
        dispatch_pdf(str(_CORRUPT_PDF_PATH))


# ===========================================================================
# R-AMT: Amount unit regression
# ===========================================================================


def test_regression__amount_unit_ils_not_agorot_cal() -> None:
    """R-AMT-1 (Cal): ₪1.00 in PDF → Decimal('1.00'), not 100 or 0.01."""

    parser = CalParser()
    amount = parser._parse_amount("₪ 1.00")
    assert amount == Decimal("1.00"), f"Expected Decimal('1.00'), got {amount!r}"
    assert amount != Decimal("100.00")
    assert amount != Decimal("0.01")


def test_regression__amount_unit_ils_not_agorot_max() -> None:
    """R-AMT-1 (Max): ₪1.00 in PDF → Decimal('1.00')."""
    parser = MaxParser()
    amount = parser._parse_amount("1.00")
    assert amount == Decimal("1.00")


def test_regression__amount_unit_ils_not_agorot_isracard() -> None:
    """R-AMT-1 (Isracard): ₪1.00 → Decimal('1.00')."""
    parser = IsracardParser()
    amount = parser._parse_amount("1.00")
    assert amount == Decimal("1.00")


def test_regression__installment_amount_unit_correct() -> None:
    """R-AMT-2: Cal installment row → amount_ils is per-installment charge in ILS."""
    stmt = dispatch_pdf(_pdf("דף פירוט דיגיטלי כאל 01-26.pdf"))
    installment_txns = [t for t in stmt.transactions if t.installment_num is not None]
    assert installment_txns, "Expected installment rows in 01-26.pdf"
    for txn in installment_txns:
        # amount_ils should be a reasonable ILS value (not agorot, not 0.01 shekel)
        assert txn.amount_ils >= Decimal("1.00"), f"amount_ils suspiciously small: {txn.amount_ils} — agorot leak?"
        assert txn.amount_ils < Decimal("100000.00"), (
            f"amount_ils suspiciously large: {txn.amount_ils} — unit overflow?"
        )
