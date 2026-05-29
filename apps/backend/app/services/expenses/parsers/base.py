"""Base classes, shared dataclasses, and exception hierarchy for PDF parsers.

Amount conventions (matching expenses.py schema):
    amount_ils      — shekels (ILS), NOT agorot.  Decimal with 2 d.p.
    amount_original — foreign-currency units.  Decimal with up to 4 d.p.
    fx_rate         — ILS per 1 unit of original_currency.  Decimal with 8 d.p.

Hebrew RTL note:
    pdfplumber extracts Hebrew text in VISUAL (character-reversed) order.
    All ``merchant_raw`` and ``sector_raw`` values MUST be stored verbatim —
    do NOT attempt to reverse or re-order Hebrew codepoints.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

logger = logging.getLogger(__name__)

# Rabin security condition #1 — reject extracted text with full card numbers.
_CARD_NUMBER_RE = re.compile(r"\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}")


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class ParserError(Exception):
    """Base exception for all credit-card parser failures."""


class ParserTimeout(ParserError):
    """PDF parsing exceeded the 30-second per-file timeout."""


class PDFTooLarge(ParserError):
    """PDF file exceeds the 5 MB size cap."""


class SecurityError(ParserError):
    """Extracted PDF text contains a full 16-digit card number."""


class UnknownIssuer(ParserError):
    """Could not identify the issuer from the PDF contents."""


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class ParsedTransaction:
    """Single transaction line extracted from a credit-card statement.

    All monetary fields are :class:`decimal.Decimal`.  ``amount_ils`` is
    always in ILS shekels (positive = charge, negative = refund/credit).
    """

    txn_date: date
    merchant_raw: str  # verbatim, Hebrew in VISUAL order
    merchant_normalized: str  # uppercase, stripped suffixes/punctuation
    amount_ils: Decimal  # shekels, NOT agorot
    posting_date: Optional[date] = None
    amount_original: Optional[Decimal] = None
    original_currency: Optional[str] = None  # ISO 4217, e.g. 'EUR'
    fx_rate: Optional[Decimal] = None  # ILS per 1 unit
    installment_num: Optional[int] = None
    installment_total: Optional[int] = None
    sector_raw: Optional[str] = None  # Hebrew ענף, verbatim; None for Max


@dataclass
class ParsedStatement:
    """Full parsed credit-card statement.

    ``total_amount_ils`` is the header-reported total, used for validation.
    ``parse_warnings`` accumulates non-fatal anomalies (skipped rows, drift,
    totals mismatch, etc.).
    """

    issuer: str  # cal | cal_paybox | max | isracard
    cardholder_name: str
    card_last4: str
    period_from: date
    period_to: date
    total_amount_ils: Decimal
    transactions: list  # list[ParsedTransaction]
    parse_warnings: list = field(default_factory=list)  # list[str]


# ---------------------------------------------------------------------------
# Base parser helpers
# ---------------------------------------------------------------------------


class BaseParser:
    """Shared helpers for all issuer-specific parser implementations."""

    _CARD_NUMBER_RE = _CARD_NUMBER_RE

    # Currency-code normalisation for Cal's 2-letter visual codes.
    _CURRENCY_MAP: dict[str, str] = {
        "EU": "EUR",
        "US": "USD",
        "GB": "GBP",
        "JP": "JPY",
        "CA": "CAD",
        "AU": "AUD",
        "CH": "CHF",
    }

    def _reject_card_numbers(self, text: str) -> None:
        """Raise :class:`SecurityError` if text contains a full card number.

        Implements Rabin security condition #1.
        """
        if self._CARD_NUMBER_RE.search(text):
            raise SecurityError("Extracted PDF text contains a 16-digit card number; refusing to parse for security.")

    @staticmethod
    def _parse_amount(raw: str) -> Decimal:
        """Parse an amount string into :class:`~decimal.Decimal`.

        Handles:
        - ``₪ 1,234.56``   → ``Decimal('1234.56')``
        - ``-12.53``        → ``Decimal('-12.53')``
        - ``1,817.00``      → ``Decimal('1817.00')``
        """
        cleaned = raw.replace("₪", "").replace(",", "").strip()
        try:
            return Decimal(cleaned)
        except InvalidOperation as exc:
            raise ParserError(f"Cannot parse amount: {raw!r}") from exc

    @staticmethod
    def _parse_date_ddmmyyyy(raw: str) -> date:
        """Parse a ``DD/MM/YYYY`` date string."""
        from datetime import datetime

        return datetime.strptime(raw.strip(), "%d/%m/%Y").date()

    @staticmethod
    def _parse_date_ddmmyy(raw: str) -> date:
        """Parse a ``DD/MM/YY`` date string, assuming 20xx century."""
        from datetime import datetime

        return datetime.strptime(raw.strip(), "%d/%m/%y").date()

    @staticmethod
    def _normalize_max_year(year_str: str) -> int:
        """Normalize Max's occasional 3-digit year artifact.

        ``'267'`` → first 2 digits = ``'26'`` → ``2026``.
        ``'26'``  → ``2026``.
        """
        digits = year_str[:2]
        return 2000 + int(digits)

    @staticmethod
    def _normalize_merchant(raw: str) -> str:
        """Normalize merchant name: uppercase, strip legal suffixes & punctuation.

        Hebrew in VISUAL order is preserved verbatim (not reversed).
        """
        s = raw.strip()
        s = re.sub(r"\s*מ\"עב$", "", s)  # בע"מ reversed = מ"עב
        s = re.sub(r"\s*בע\"מ$", "", s)
        s = re.sub(r"\s*LTD\.?$", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*INC\.?$", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*LLC\.?$", "", s, flags=re.IGNORECASE)
        s = s.strip(" .,;:-'\"")
        return s.upper() if s else raw.strip().upper()

    def _normalize_currency(self, code: str) -> str:
        """Return ISO 4217 code, normalising Cal's 2-letter visual codes."""
        return self._CURRENCY_MAP.get(code.upper(), code.upper())

    @staticmethod
    def _fix_split_latin_merchant(s: str) -> str:
        """Repair pdfplumber's first-letter split in Isracard foreign merchants.

        pdfplumber sometimes inserts a space after the first letter of an
        all-caps word: ``'E UROPAPARK'`` → ``'EUROPAPARK'``.
        The fix only merges a single uppercase letter that is NOT preceded by
        another uppercase letter (i.e. it looks like a split, not two words).
        """
        result = re.sub(r"(?<![A-Z])([A-Z]) ([A-Z])", r"\1\2", s)
        # Apply twice to catch consecutive splits like 'A L IEXPRESS'
        return re.sub(r"(?<![A-Z])([A-Z]) ([A-Z])", r"\1\2", result)
