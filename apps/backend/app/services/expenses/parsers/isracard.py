"""Isracard credit-card PDF parser.

Isracard statements contain two sections:
1. **Foreign (ל"וחב תושיכר)**: foreign-currency FX rows + ILS-billed foreign rows.
2. **Domestic (ץראב וכוז/וביוחש תוקסע)**: ILS rows with sector + card-type.

Foreign FX row layout (left-to-right VISUAL order):
    charge | commission | rate | posting_date | original_amount | currency |
    merchant (with split-letter artefact) | [type][txn_date]

Refund FX rows omit the commission column:
    charge | rate | posting_date | original_amount | currency | merchant |
    type txn_date

Foreign ILS row:
    charge ₪ charge merchant type txn_date

Domestic row:
    [additional_details] charge txn_amount sector merchant card_type date

Dates in Isracard are DD/MM/YY (2-digit year, always 20xx).
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
# Section boundary markers (VISUAL Hebrew)
# ---------------------------------------------------------------------------
_FOREIGN_HEADER = 'ל"וחב תושיכר'
_DOMESTIC_HEADER_RE = re.compile(r"ץראב\s+-?\s+וכוז\s*/\s*וביוחש\s+תוקסע")

# ---------------------------------------------------------------------------
# Isracard domestic sector vocabulary (longest-first)
# ---------------------------------------------------------------------------
_ISR_SECTORS: list[str] = sorted(
    [
        "ניפו חוטיב",  # finance & insurance
        "אקשמו ןוזמ",  # food & beverages
        "רובחתו בכר",  # transport & vehicles
        "ץופיש/הינב",  # renovation / construction
        "יוליב יאנפ",  # leisure
        "רפוס/תלוכמ",  # grocery
        "בכר יתוריש",  # car services
        "הפק/תודעסמ",  # cafe / restaurants
        "טרופס/יאנפ",  # sport & leisure
        "רויתו שפונ",  # tourism & recreation
        "תיב ילכ",  # household items
        "תרושקת",  # communications
        "תוריית",  # tourism
        "תונוש",  # miscellaneous
        "תויושר",  # authorities
        "תולתשמ",  # nurseries
        "תוינדעמ",  # eateries
        "האופר",  # health
        "הנפוא",  # fashion
        "קלד",  # fuel
        "השבלה",  # clothing
        "המראפ",  # pharmacy
        "תודסומ",  # institutions
    ],
    key=len,
    reverse=True,
)

# Domestic card-type tokens (VISUAL Hebrew), sorted longest-first
_CARD_TYPES = sorted(
    ["דיינ.שת", "גצוה אל", "עבק.ה", "ריהמ.שת", "ריהמ"],
    key=len,
    reverse=True,
)

# ---------------------------------------------------------------------------
# Header regexes
# ---------------------------------------------------------------------------
_CARD_LAST4_RE = re.compile(r"(\d{4})\s*:תורפסב\s+םייתסמש\s+סיטרכ")
_BILLING_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{2})\s*:ךיראתל\s+ךיתולועפ\s+טורפ")

# Total line (appears in both foreign + domestic sections):
#   ``N,NNN.NN DD/MM/YY ךיראתל בויח כ"הס``
_SECTION_TOTAL_RE = re.compile(r"^([-]?[\d,]+\.?\d*)\s+(\d{2}/\d{2}/\d{2})\s+ךיראתל.*כ\"הס")
# Domestic total after discount:
#   ``N,NNN.NN DD/MM/YY ךיראתל החנהה יוכינב בויח כ"הס``
_DOMESTIC_TOTAL_RE = re.compile(r"([\d,]+\.?\d*)\s+\d{2}/\d{2}/\d{2}\s+ךיראתל.*כ\"הס")

# ---------------------------------------------------------------------------
# Foreign section row regexes
# ---------------------------------------------------------------------------

# Normal FX row (positive charge, has commission=0.00):
#   charge 0.00 rate posting_date original_amount currency merchant [type]date
_FX_FULL_RE = re.compile(
    r"^([-]?[\d,]+\.?\d*)"  # charge
    r"\s+([\d.]+)"  # commission
    r"\s+([\d.]+)"  # rate
    r"\s+(\d{2}/\d{2}/\d{2})"  # posting_date
    r"\s+([-]?[\d,]+\.?\d*)"  # original_amount
    r"\s+([€$£])"  # currency symbol
    r"\s+(.+?)"  # merchant (may have split-letter artefact)
    r"\s*([לא]?)(\d{2}/\d{2}/\d{2})$"  # [type]txn_date
)

# Refund FX row (negative charge, no commission):
#   charge rate posting_date original_amount currency merchant type txn_date
_FX_REFUND_RE = re.compile(
    r"^(-[\d,]+\.?\d*)"  # negative charge
    r"\s+([\d.]+)"  # rate (no commission)
    r"\s+(\d{2}/\d{2}/\d{2})"  # posting_date
    r"\s+(-[\d,]+\.?\d*)"  # negative original_amount
    r"\s+([€$£])"  # currency
    r"\s+(.+?)"  # merchant
    r"\s+([לא])\s+(\d{2}/\d{2}/\d{2})$"  # type  txn_date
)

# Foreign ILS row: charge ₪ charge merchant type date
_FX_ILS_RE = re.compile(
    r"^([\d,]+\.?\d*)"  # charge
    r"\s+₪\s+([\d,]+\.?\d*)"  # ₪ marker + same amount
    r"\s+(.+?)"  # merchant
    r"\s+([לא])\s+(\d{2}/\d{2}/\d{2})$"  # type  txn_date
)

# ---------------------------------------------------------------------------
# Domestic section row regexes
# ---------------------------------------------------------------------------
_DOM_LEADING_AMOUNTS_RE = re.compile(r"^([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+")
_DOM_DATE_RE = re.compile(r"(\d{2}/\d{2}/\d{2})$")
# Additional detail prefix: ``₪ N.NN החנה``
_ADDITIONAL_DETAIL_RE = re.compile(r"^₪\s+[\d,]+\.?\d*\s+החנה\s+")

# Lines to skip in domestic section
_DOM_SKIP_RE = re.compile(
    r"ח\"שב$"  # "in NIS" label at line end
    r"|ךיראתל.*כ\"הס"  # total line
    r"|ףסונ\s+טוריפ"  # header row
    r"|בויחה\s+הקסע"  # header row
    r"|יארשאה\s+יאנתו"  # credit terms header
    r"|₪\s+0\.00\s+םומינימ"  # zero minimum interest
)


class IsracardParser(BaseParser):
    """Parse Isracard credit-card PDF statements."""

    ISSUER = "isracard"

    def parse(self, path: str) -> ParsedStatement:
        """Parse *path* and return a :class:`ParsedStatement`."""
        try:
            pdf = pdfplumber.open(path)
        except Exception as exc:
            raise ParserError(f"Cannot open PDF: {path!r}") from exc

        with pdf:
            pages_text = [pg.extract_text() or "" for pg in pdf.pages]

        full_text = "\n".join(pages_text)
        self._reject_card_numbers(full_text)

        warnings: list[str] = []

        cardholder_name = self._parse_cardholder(full_text, warnings)
        card_last4 = self._parse_card_last4(full_text, warnings)
        billing_date = self._parse_billing_date(full_text, warnings)
        period_from = self._derive_period_from(billing_date)
        total_amount_ils = self._parse_total(full_text, warnings)

        transactions: list[ParsedTransaction] = []
        for page_text in pages_text:
            lines = page_text.split("\n")
            txns = self._parse_page(lines, warnings)
            transactions.extend(txns)

        return ParsedStatement(
            issuer=self.ISSUER,
            cardholder_name=cardholder_name,
            card_last4=card_last4,
            period_from=period_from,
            period_to=billing_date,
            total_amount_ils=total_amount_ils,
            transactions=transactions,
            parse_warnings=warnings,
        )

    # ------------------------------------------------------------------
    # Header helpers
    # ------------------------------------------------------------------

    def _parse_cardholder(self, text: str, warnings: list) -> str:
        """Extract cardholder name (line immediately before isracard.co.il)."""
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if "isracard.co.il" in line or "www.isracard.co.il" in line:
                # Name is usually a few lines above the URL line
                for j in range(i - 1, max(i - 6, -1), -1):
                    candidate = lines[j].strip()
                    if candidate and not any(
                        x in candidate for x in ["www.", "http", "15/4", "7572215", "*3557*", "ןלהל", "רושיקל", "אבה"]
                    ):
                        return candidate
        warnings.append("Could not extract Isracard cardholder name")
        return ""

    def _parse_card_last4(self, text: str, warnings: list) -> str:
        m = _CARD_LAST4_RE.search(text)
        if m:
            return m.group(1)
        warnings.append("Could not extract Isracard card_last4")
        return ""

    def _parse_billing_date(self, text: str, warnings: list) -> date:
        m = _BILLING_DATE_RE.search(text)
        if m:
            try:
                return self._parse_date_ddmmyy(m.group(1))
            except ValueError:
                pass
        warnings.append("Could not parse Isracard billing date")
        return date.min

    @staticmethod
    def _derive_period_from(billing_date: date) -> date:
        from datetime import timedelta

        if billing_date == date.min:
            return date.min
        return billing_date - timedelta(days=30)

    def _parse_total(self, text: str, warnings: list) -> Decimal:
        """Sum all section totals as the statement total."""
        total = Decimal("0")
        for m in _DOMESTIC_TOTAL_RE.finditer(text):
            try:
                val = self._parse_amount(m.group(1))
                if val > Decimal("0"):
                    total = max(total, val)
            except ParserError:
                pass
        return total

    # ------------------------------------------------------------------
    # Page-level parser — splits foreign / domestic sections
    # ------------------------------------------------------------------

    def _parse_page(self, lines: list[str], warnings: list) -> list[ParsedTransaction]:
        """Parse one page; auto-detects and switches between sections."""
        txns: list[ParsedTransaction] = []
        section = "none"  # 'foreign' | 'domestic' | 'none'

        i = 0
        while i < len(lines):
            line = lines[i].strip()

            # Section boundary detection
            if _FOREIGN_HEADER in line:
                section = "foreign"
                i += 1
                continue
            if _DOMESTIC_HEADER_RE.search(line):
                section = "domestic"
                i += 1
                continue

            if section == "foreign":
                # City continuation follows main FX row — skip alone (handled
                # by the row parser consuming lookahead)
                lookahead = lines[i + 1 : i + 3]
                txn = self._parse_foreign_row(line, lookahead, warnings)
                if txn is not None:
                    txns.append(txn)
            elif section == "domestic":
                txn = self._parse_domestic_row(line, warnings)
                if txn is not None:
                    txns.append(txn)

            i += 1

        return txns

    # ------------------------------------------------------------------
    # Foreign row parsers
    # ------------------------------------------------------------------

    def _parse_foreign_row(self, line: str, lookahead: list[str], warnings: list) -> Optional[ParsedTransaction]:
        """Attempt to parse *line* as a foreign-section transaction."""
        if not line:
            return None
        # Skip column headers, totals, continuation lines, discount lines
        if any(
            x in line for x in ["בויחה\nמוכס", 'כ"הס', "₪-ב", "**₪-ב", "הלמע.פ**", "החנה", "ריע\n גוס", "ח.לט", "וניגב"]
        ):
            return None
        if re.match(r"^[A-Z][A-Z\s]+$", line):
            # City-continuation line — not a transaction row
            return None

        # Normal FX row (commission present)
        m = _FX_FULL_RE.match(line)
        if m:
            return self._build_fx_txn(
                charge_str=m.group(1),
                commission_str=m.group(2),
                rate_str=m.group(3),
                posting_str=m.group(4),
                original_str=m.group(5),
                currency_sym=m.group(6),
                merchant_raw=m.group(7),
                txn_date_str=m.group(9),
                lookahead=lookahead,
                warnings=warnings,
            )

        # Refund FX row (no commission, negative amounts)
        m = _FX_REFUND_RE.match(line)
        if m:
            return self._build_fx_txn(
                charge_str=m.group(1),
                commission_str=None,
                rate_str=m.group(2),
                posting_str=m.group(3),
                original_str=m.group(4),
                currency_sym=m.group(5),
                merchant_raw=m.group(6),
                txn_date_str=m.group(8),
                lookahead=lookahead,
                warnings=warnings,
            )

        # ILS-billed foreign row
        m = _FX_ILS_RE.match(line)
        if m:
            return self._build_ils_foreign_txn(m, warnings)

        return None

    def _build_fx_txn(
        self,
        charge_str: str,
        commission_str: Optional[str],
        rate_str: str,
        posting_str: str,
        original_str: str,
        currency_sym: str,
        merchant_raw: str,
        txn_date_str: str,
        lookahead: list[str],
        warnings: list,
    ) -> Optional[ParsedTransaction]:
        """Construct a :class:`ParsedTransaction` from FX row components."""
        try:
            amount_ils = self._parse_amount(charge_str)
            amount_original = self._parse_amount(original_str)
            fx_rate = Decimal(rate_str)
            posting_date = self._parse_date_ddmmyy(posting_str)
            txn_date = self._parse_date_ddmmyy(txn_date_str)
        except Exception as exc:
            warnings.append(f"Skipped Isracard FX row: {exc!s}")
            return None

        currency_map = {"€": "EUR", "$": "USD", "£": "GBP"}
        currency = currency_map.get(currency_sym, currency_sym)

        # Repair pdfplumber's split-letter artefact in Latin merchant names
        merchant = self._fix_split_latin_merchant(merchant_raw.strip())
        # Append city continuation line if present
        for la in lookahead:
            la = la.strip()
            if la and re.match(r"^[A-Z][A-Z\s\-]+$", la):
                merchant = f"{merchant} {la}"
                break

        return ParsedTransaction(
            txn_date=txn_date,
            posting_date=posting_date,
            merchant_raw=merchant,
            merchant_normalized=self._normalize_merchant(merchant),
            amount_ils=amount_ils,
            amount_original=amount_original,
            original_currency=currency,
            fx_rate=fx_rate,
            sector_raw=None,
        )

    def _build_ils_foreign_txn(self, m: re.Match, warnings: list) -> Optional[ParsedTransaction]:
        """Construct a :class:`ParsedTransaction` from a foreign ILS row."""
        charge_str = m.group(1)
        merchant_raw = self._fix_split_latin_merchant(m.group(3).strip())
        txn_date_str = m.group(5)
        try:
            amount_ils = self._parse_amount(charge_str)
            txn_date = self._parse_date_ddmmyy(txn_date_str)
        except Exception as exc:
            warnings.append(f"Skipped Isracard ILS-foreign row: {exc!s}")
            return None
        return ParsedTransaction(
            txn_date=txn_date,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            sector_raw=None,
        )

    # ------------------------------------------------------------------
    # Domestic row parser
    # ------------------------------------------------------------------

    def _parse_domestic_row(self, line: str, warnings: list) -> Optional[ParsedTransaction]:
        """Parse a domestic-section transaction row."""
        if not line:
            return None
        if _DOM_SKIP_RE.search(line):
            return None
        # Skip pure column-header lines
        if re.match(r"^[^\d₪]{20,}$", line):
            return None

        # Strip optional additional-detail prefix: ``₪ N.NN החנה``
        clean = _ADDITIONAL_DETAIL_RE.sub("", line)

        # Two leading amounts
        am = _DOM_LEADING_AMOUNTS_RE.match(clean)
        if not am:
            return None
        charge_str = am.group(1)
        rest = clean[am.end() :]

        # Date at end
        date_m = _DOM_DATE_RE.search(rest)
        if not date_m:
            return None
        txn_date_str = date_m.group(1)
        before_date = rest[: date_m.start()].strip()

        # Card type just before the date
        for ct in _CARD_TYPES:
            if before_date.endswith(ct):
                before_date = before_date[: -len(ct)].strip()
                break

        # Sector + merchant from remainder
        sector_raw, merchant_raw = self._extract_sector_merchant(before_date)

        try:
            amount_ils = self._parse_amount(charge_str)
            txn_date = self._parse_date_ddmmyy(txn_date_str)
        except Exception as exc:
            warnings.append(f"Skipped Isracard domestic row: {exc!s} | {line!r}")
            return None

        return ParsedTransaction(
            txn_date=txn_date,
            merchant_raw=merchant_raw,
            merchant_normalized=self._normalize_merchant(merchant_raw),
            amount_ils=amount_ils,
            sector_raw=sector_raw,
        )

    # ------------------------------------------------------------------
    # Sector / merchant split
    # ------------------------------------------------------------------

    def _extract_sector_merchant(self, middle: str) -> tuple[Optional[str], str]:
        """Split *middle* into (sector_raw, merchant_raw) for domestic rows."""
        for sector in _ISR_SECTORS:
            idx = middle.find(sector)
            if idx >= 0:
                merchant = middle[idx + len(sector) :].strip()
                return sector, merchant
        return None, middle.strip()
