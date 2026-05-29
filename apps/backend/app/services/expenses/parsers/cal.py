"""Cal General credit-card PDF parser.

Statement layout (left-to-right extracted order, Hebrew in VISUAL/reversed):
    charge_ils | txn_amount | card_shown | [installment] | sector | merchant | date

Installment marker (VISUAL order):  ``N - מ M םולשת``
  where N = installment_total (appears FIRST in visual order),
        M = installment_num (appears SECOND).
  e.g. ``5 - מ 2 םולשת``  →  installment 2 of 5.

Refund rows contain ``יוכיז`` in the middle field and negative amounts.
Standing-order rows contain ``עבק תארוה``.
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
# Known Cal sector tokens (reversed VISUAL Hebrew, longest-first for greedy
# matching). Keep sorted by descending length.
# ---------------------------------------------------------------------------
_CAL_SECTORS: list[str] = sorted(
    [
        "ניפו חוטיב",  # finance & insurance
        "אקשמו ןוזמ",  # food & beverages
        "רובחתו בכר",  # transport & vehicles
        "ץופיש/הינב",  # renovation / construction
        "יוליב יאנפ",  # leisure & entertainment
        "רפוס/תלוכמ",  # grocery / supermarket
        "בכר יתוריש",  # car services
        "הפק/תודעסמ",  # cafe / restaurants
        "טרופס/יאנפ",  # sport & leisure
        "רויתו שפונ",  # tourism & recreation
        "תיב ילכ",  # household items
        "תודסומ",  # institutions / government
        "תרושקת",  # communications
        "תוריית",  # tourism
        "תונוש",  # miscellaneous
        "תויושר",  # authorities
        "תולתשמ",  # plant nurseries
        "האופר",  # health
        "הנפוא",  # fashion
        "קלד",  # fuel
        "ריבד",  # office / stationery
        "המראפ",  # pharmacy
        "השבלה",  # clothing
        "תוינדעמ",  # eateries
        "םיסנניפ",  # finances (PayBox transfers)
    ],
    key=len,
    reverse=True,
)

# Installment pattern: ``N - מ M םולשת``  (N=total, M=num)
_INSTALLMENT_RE = re.compile(r"(\d+)\s*-\s*מ\s*(\d+)\s*םולשת")

# Normal transaction row: starts with ₪, ends with DD/MM/YYYY
_ROW_START_RE = re.compile(r"^₪\s*([-]?[\d,]+\.?\d{0,2})\s+")
_DATE_DDMMYYYY_RE = re.compile(r"(\d{2}/\d{2}/\d{4})$")
_DATE_DDMMYY_RE = re.compile(r"(\d{2}/\d{2}/\d{2})$")

# FX row: ₪ CHARGE  CURRENCY  ORIGINAL_AMT  ...  DATE
_FX_ROW_RE = re.compile(
    r"^₪\s*([\d,]+\.?\d{0,2})\s+"  # ILS charge
    r"([A-Z]{2,3})\s+"  # currency code (EU, USD, etc.)
    r"([\d,]+\.?\d{0,4})\s+"  # original amount
)
# FX rate on continuation line: ``3.5105 גיצי רעשב``
_FX_RATE_RE = re.compile(r"([\d]+\.\d{2,8})\s+גיצי\s+רעשב")
# FX posting date on main line: ``DD/MM/YY -ב``
_FX_POSTING_RE = re.compile(r"(\d{2}/\d{2}/\d{2})\s+-ב")

# Second amount in normal row: ``₪ AMOUNT``
_SECOND_AMOUNT_RE = re.compile(r"₪\s*([-]?[\d,]+\.?\d{0,2})\s+")

# Card/header totals line — NOT a transaction
_TOTAL_RE = re.compile(r"^₪\s*([\d,]+\.?\d{0,2})\s+\d{2}/\d{2}/\d{2}\s+ךיראתל\s+כ\"הס")

# Cardholder + card_last4: ``NAME ש"ע LAST4-ב םייתסמה``
_CARDHOLDER_RE = re.compile(r"(.+?)\s+ש\"ע\s+(\d{4})-ב\s+םייתסמה")

# Period from/to: appears in the expected-charges summary line
_PERIOD_FROM_RE = re.compile(r"(\d{2}/\d{2}/\d{2})-מ")
_PERIOD_TO_RE = re.compile(r"(\d{2}/\d{2}/\d{2})\s+דע")


class CalParser(BaseParser):
    """Parse Cal General credit-card PDF statements.

    The same logic (with identical column layout) is reused by
    :class:`~app.services.expenses.parsers.cal_paybox.CalPayBoxParser`.
    """

    #: Issuer slug written into ParsedStatement.issuer
    ISSUER = "cal"

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
        # Rabin security condition #1
        self._reject_card_numbers(full_text)

        warnings: list[str] = []
        transactions: list[ParsedTransaction] = []

        cardholder_name, card_last4 = self._parse_header_identity(full_text, warnings)
        period_from, period_to = self._parse_period(full_text, warnings)
        total_amount_ils = self._parse_total(full_text, warnings)

        # Parse transactions page by page, passing subsequent lines for FX rate
        for page_text in pages_text:
            lines = page_text.split("\n")
            for idx, line in enumerate(lines):
                lookahead = lines[idx + 1 : idx + 4]
                txn = self._parse_row(line, lookahead, warnings)
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

    def _parse_header_identity(self, text: str, warnings: list) -> tuple[str, str]:
        """Extract cardholder name and card last-4 digits."""
        m = _CARDHOLDER_RE.search(text)
        if m:
            return m.group(1).strip(), m.group(2)
        warnings.append("Could not extract cardholder name / card_last4")
        return "", ""

    def _parse_period(self, text: str, warnings: list) -> tuple[date, date]:
        """Extract billing period from/to dates."""
        from_match = _PERIOD_FROM_RE.search(text)
        to_match = _PERIOD_TO_RE.search(text)
        try:
            period_from = self._parse_date_ddmmyy(from_match.group(1)) if from_match else date.min
            period_to = self._parse_date_ddmmyy(to_match.group(1)) if to_match else date.min
        except Exception:
            warnings.append("Could not parse billing period dates")
            return date.min, date.min
        return period_from, period_to

    def _parse_total(self, text: str, warnings: list) -> Decimal:
        """Extract header-reported total (last occurrence of כ"הס line)."""
        total = Decimal("0")
        for m in _TOTAL_RE.finditer(text, re.MULTILINE):
            try:
                total = self._parse_amount(m.group(1))
            except ParserError:
                pass
        return total

    # ------------------------------------------------------------------
    # Transaction row parser
    # ------------------------------------------------------------------

    def _parse_row(self, line: str, lookahead: list[str], warnings: list) -> Optional[ParsedTransaction]:
        """Parse one line and return a :class:`ParsedTransaction` or ``None``."""
        line = line.strip()
        if not line.startswith("₪"):
            return None

        # Skip totals lines
        if _TOTAL_RE.match(line):
            return None

        # Detect FX row (₪ CHARGE  CURRENCY_CODE  AMOUNT)
        fx_m = _FX_ROW_RE.match(line)
        if fx_m:
            return self._parse_fx_row(line, fx_m, lookahead, warnings)

        # Normal row: ₪ CHARGE  ₪ TXN_AMT  ... DATE
        return self._parse_normal_row(line, warnings)

    def _parse_normal_row(self, line: str, warnings: list) -> Optional[ParsedTransaction]:
        """Parse a standard ILS transaction row."""
        # Extract charge (first ₪ amount)
        m1 = _ROW_START_RE.match(line)
        if not m1:
            return None
        charge_str = m1.group(1)
        rest = line[m1.end() :]

        # Second amount (txn_amount, also ₪-prefixed)
        m2 = _SECOND_AMOUNT_RE.match(rest)
        if not m2:
            return None
        middle = rest[m2.end() :]

        # Date at the end: DD/MM/YYYY
        date_m = _DATE_DDMMYYYY_RE.search(middle)
        if not date_m:
            return None
        txn_date_str = date_m.group(1)
        middle = middle[: date_m.start()].strip()

        try:
            txn_date = self._parse_date_ddmmyyyy(txn_date_str)
            amount_ils = self._parse_amount(charge_str)
        except (ParserError, ValueError) as exc:
            warnings.append(f"Skipped row (parse error): {exc!s} | line={line!r}")
            return None

        # Installment
        installment_num = installment_total = None
        inst_m = _INSTALLMENT_RE.search(middle)
        if inst_m:
            installment_total = int(inst_m.group(1))
            installment_num = int(inst_m.group(2))
            # Remove installment token from middle so sector search is clean
            middle = middle[: inst_m.start()] + middle[inst_m.end() :]
            middle = middle.strip()

        # Sector: find longest known sector string in middle
        sector_raw, merchant_raw = self._extract_sector_merchant(middle)

        return ParsedTransaction(
            txn_date=txn_date,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            installment_num=installment_num,
            installment_total=installment_total,
            sector_raw=sector_raw,
        )

    def _parse_fx_row(
        self,
        line: str,
        fx_m: re.Match,
        lookahead: list[str],
        warnings: list,
    ) -> Optional[ParsedTransaction]:
        """Parse a foreign-currency transaction row."""
        charge_str = fx_m.group(1)
        currency_raw = fx_m.group(2)
        original_str = fx_m.group(3)
        rest = line[fx_m.end() :]

        # txn_date at end (DD/MM/YYYY)
        date_m = _DATE_DDMMYYYY_RE.search(rest)
        if not date_m:
            warnings.append(f"FX row missing txn_date: {line!r}")
            return None
        txn_date_str = date_m.group(1)
        before_date = rest[: date_m.start()]

        # Posting date: DD/MM/YY -ב
        posting: Optional[date] = None
        posting_m = _FX_POSTING_RE.search(before_date)
        if posting_m:
            try:
                posting = self._parse_date_ddmmyy(posting_m.group(1))
            except ValueError:
                pass

        # Sector + merchant from the portion after the posting date context
        # Strip the ``ח"של רמוה  DD/MM/YY -ב .LOCATION`` fragment
        # by searching for known sectors
        middle = before_date
        if posting_m:
            middle = before_date[posting_m.end() :].strip()
        # Drop leading location fragment (starts with `.`)
        middle = re.sub(r"^\.[\u0600-\u06FF\s]+", "", middle).strip()
        sector_raw, merchant_raw = self._extract_sector_merchant(middle)

        # FX rate from lookahead lines
        fx_rate: Optional[Decimal] = None
        for la_line in lookahead:
            rate_m = _FX_RATE_RE.search(la_line)
            if rate_m:
                try:
                    fx_rate = Decimal(rate_m.group(1))
                except Exception:
                    pass
                break

        try:
            amount_ils = self._parse_amount(charge_str)
            amount_original = self._parse_amount(original_str)
            txn_date = self._parse_date_ddmmyyyy(txn_date_str)
        except (ParserError, ValueError) as exc:
            warnings.append(f"Skipped FX row: {exc!s} | line={line!r}")
            return None

        return ParsedTransaction(
            txn_date=txn_date,
            posting_date=posting,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            amount_original=amount_original,
            original_currency=self._normalize_currency(currency_raw),
            fx_rate=fx_rate,
            sector_raw=sector_raw,
        )

    # ------------------------------------------------------------------
    # Sector / merchant split
    # ------------------------------------------------------------------

    def _extract_sector_merchant(self, middle: str) -> tuple[Optional[str], str]:
        """Split *middle* text into (sector_raw, merchant_raw).

        Searches for the longest known sector token.  Everything to the right
        of the sector token is the merchant.  If no sector is found the whole
        *middle* is returned as merchant with ``sector_raw=None``.
        """
        for sector in _CAL_SECTORS:
            idx = middle.find(sector)
            if idx >= 0:
                merchant = middle[idx + len(sector) :].strip()
                return sector, merchant
        return None, middle.strip()
