"""Max credit-card PDF parser.

Statement layout (left-to-right extracted order, Hebrew in VISUAL/reversed):
    [עבק תארוה] | charge | txn_amount | type | merchant+date

Notable quirks:
- **Date artefact**: pdfplumber occasionally extracts a 3-digit year, e.g.
  ``05/04/267``.  Normalisation: take first 2 year digits → ``26`` → 2026.
- **Date concatenation**: the date is often directly appended to the merchant
  with no space separator, e.g. ``UPAPP05/04/267``.
- **No sector column**: all Max transactions have ``sector_raw=None``.
- **Multi-section**: deferred-month transactions live under a separate section
  header but are parsed with the same row format.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from decimal import Decimal
from typing import Optional

import pdfplumber

from .base import BaseParser, ParsedStatement, ParsedTransaction, ParserError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------

# Header total + period_to:
#   ``₪ 1,146 סיטרכב תויובייחתה 02/05/26-ה דע``
_TOTAL_RE = re.compile(r"₪\s*([\d,]+\.?\d*)\s+סיטרכב\s+תויובייחתה\s+(\d{2}/\d{2}/\d{2})-ה\s+דע")

# Card last-4:  ``1494-ב םייתסמש סיטרכל``
_CARD_RE = re.compile(r"(\d{4})-ב\s+םייתסמש\s+סיטרכל")

# Cardholder name: line ending with ``ש"ע``
_CARDHOLDER_RE = re.compile(r"^(.+?)\s+ש\"ע\s*$", re.MULTILINE)

# Transaction row.  Known type tokens (VISUAL Hebrew):
#   ``הליגר`` = regular
#   ``שדוח יוחד`` = deferred month
_TYPE_RE = re.compile(r"(שדוח\s+יוחד|הליגר)")

# Date: DD/MM/YY[Y]  (2 or 3 digit year) – may be concatenated with merchant
_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{2,3})$")

# Optional standing-order prefix at line start
_STANDING_RE = re.compile(r"^עבק\s+תארוה\s+")

# Two leading amounts (charge and txn_amount are always equal in Max)
_LEADING_AMOUNTS_RE = re.compile(r"^([-]?[\d,]+\.?\d{0,2})\s+([-]?[\d,]+\.?\d{0,2})\s+")

# Foreign section: rows sometimes start with ₪ AMOUNT ₪ AMOUNT (ILS-billed)
_FX_ILS_RE = re.compile(r"^₪\s*([\d,]+\.?\d{0,2})\s+₪\s*([\d,]+\.?\d{0,2})\s+(.+?)\s+(\d{2}/\d{2}/\d{2,4})$")

# Skip lines: section headers, notes, total lines, blank
_SKIP_PATTERNS = [
    re.compile(p)
    for p in [
        r"^ח\"שב\s*/\s*ץראב\s+תוקסע",  # domestic section header
        r"^בויחה\s+םויב\s+ןוערפל\s+תוקסע",  # deferred section header
        r"(ידיתע\s+בויח|ל\"וחב\s+תוקסע)",  # future/foreign header
        r"^₪\s+[\d,]+\.?\d*\s+כ\"הס",  # sub-section total
        r"^תורעה\s+םוכס",  # column header
        r"^בויחה\s+הקסעה\s+הקסעה",  # column sub-header
        r"^:הרעה",  # deferred note
    ]
]


class MaxParser(BaseParser):
    """Parse Max credit-card PDF statements.

    Max statements have no sector column; ``sector_raw`` is always ``None``.
    """

    ISSUER = "max"

    def parse(self, path: str) -> ParsedStatement:
        """Parse *path* and return a :class:`ParsedStatement`.

        Raises :class:`~.base.ParserError` on any unrecoverable error.
        """
        try:
            pdf = pdfplumber.open(path)
        except Exception as exc:
            raise ParserError(f"Cannot open PDF: {path!r}") from exc

        with pdf:
            pages_text = [pg.extract_text() or "" for pg in pdf.pages]

        full_text = "\n".join(pages_text)
        self._reject_card_numbers(full_text)

        warnings: list[str] = []
        transactions: list[ParsedTransaction] = []

        cardholder_name = self._parse_cardholder(full_text, warnings)
        card_last4 = self._parse_card_last4(full_text, warnings)
        period_to, total_amount_ils = self._parse_total_and_period(full_text, warnings)
        period_from = self._derive_period_from(period_to)

        for page_text in pages_text:
            for line in page_text.split("\n"):
                txn = self._parse_row(line.strip(), warnings)
                if txn is not None:
                    transactions.append(txn)

        return ParsedStatement(
            issuer=self.ISSUER,
            cardholder_name=cardholder_name,
            card_last4=card_last4,
            period_from=period_from,
            period_to=period_to,
            total_amount_ils=total_amount_ils,
            transactions=transactions,
            parse_warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Header helpers
    # ------------------------------------------------------------------

    def _parse_cardholder(self, text: str, warnings: list) -> str:
        m = _CARDHOLDER_RE.search(text)
        if m:
            return m.group(1).strip()
        warnings.append("Could not extract Max cardholder name")
        return ""

    def _parse_card_last4(self, text: str, warnings: list) -> str:
        m = _CARD_RE.search(text)
        if m:
            return m.group(1)
        warnings.append("Could not extract Max card_last4")
        return ""

    def _parse_total_and_period(self, text: str, warnings: list) -> tuple[date, Decimal]:
        """Return (period_to, total_amount_ils) from the header total line."""
        m = _TOTAL_RE.search(text)
        if m:
            try:
                total = self._parse_amount(m.group(1))
                period_to = self._parse_date_ddmmyy(m.group(2))
                return period_to, total
            except Exception:
                pass
        warnings.append("Could not parse Max total / period_to from header")
        return date.min, Decimal("0")

    @staticmethod
    def _derive_period_from(period_to: date) -> date:
        """Approximate period_from as billing-date minus ~30 days."""
        from datetime import timedelta

        if period_to == date.min:
            return date.min
        return period_to - timedelta(days=30)

    # ------------------------------------------------------------------
    # Transaction row parser
    # ------------------------------------------------------------------

    def _parse_row(self, line: str, warnings: list) -> Optional[ParsedTransaction]:
        """Parse one line and return a :class:`ParsedTransaction` or ``None``."""
        if not line:
            return None
        if any(p.search(line) for p in _SKIP_PATTERNS):
            return None

        # Foreign ILS row:  ``₪ AMT ₪ AMT MERCHANT DATE``
        fx_ils = _FX_ILS_RE.match(line)
        if fx_ils:
            return self._parse_fx_ils_row(fx_ils, warnings)

        # Strip optional standing-order prefix
        so_present = bool(_STANDING_RE.match(line))
        row_body = _STANDING_RE.sub("", line)

        # Two leading amounts
        am = _LEADING_AMOUNTS_RE.match(row_body)
        if not am:
            return None
        charge_str = am.group(1)
        rest = row_body[am.end() :]

        # Transaction type token
        type_m = _TYPE_RE.match(rest)
        if not type_m:
            return None
        rest = rest[type_m.end() :].strip()

        # Date at the very end (possibly concatenated with merchant)
        date_m = _DATE_RE.search(rest)
        if not date_m:
            return None
        raw_date = date_m.group(1)
        merchant_raw = rest[: date_m.start()].strip()

        try:
            amount_ils = self._parse_amount(charge_str)
            txn_date = self._parse_max_date(raw_date)
        except (ParserError, ValueError) as exc:
            warnings.append(f"Skipped Max row: {exc!s} | line={line!r}")
            return None

        if so_present and not merchant_raw:
            merchant_raw = "עבק תארוה"

        return ParsedTransaction(
            txn_date=txn_date,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            sector_raw=None,  # Max has no sector column
        )

    def _parse_fx_ils_row(self, m: re.Match, warnings: list) -> Optional[ParsedTransaction]:
        """Parse an ILS-billed foreign transaction from the foreign section."""
        charge_str = m.group(1)
        merchant_raw = m.group(3).strip()
        raw_date = m.group(4)
        try:
            amount_ils = self._parse_amount(charge_str)
            txn_date = self._parse_max_date(raw_date)
        except (ParserError, ValueError) as exc:
            warnings.append(f"Skipped Max FX-ILS row: {exc!s}")
            return None
        return ParsedTransaction(
            txn_date=txn_date,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            sector_raw=None,
        )

    # ------------------------------------------------------------------
    # Date normalisation
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_max_date(raw: str) -> date:
        """Parse ``DD/MM/YY[Y]`` normalising pdfplumber's 3-digit year artefact.

        ``'05/04/267'`` → ``date(2026, 4, 5)``
        ``'17/04/26'``  → ``date(2026, 4, 17)``
        """
        parts = raw.split("/")
        if len(parts) != 3:
            raise ValueError(f"Unexpected Max date format: {raw!r}")
        dd, mm, yy_raw = parts
        year = 2000 + int(yy_raw[:2])  # first 2 digits of year field
        return date(year, int(mm), int(dd))
