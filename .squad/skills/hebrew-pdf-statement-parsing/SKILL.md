# Skill: Hebrew PDF Statement Parsing (Israeli Credit Cards)

## Summary

Pattern for parsing Hebrew RTL credit-card PDF statements from Israeli issuers (Cal, Max, Isracard) using pdfplumber. Covers issuer detection, column reconstruction for RTL layouts, date normalization, FX row handling, and installment extraction.

---

## Supported Formats

| Format ID | Issuer | Distinguishing text in page-1 | Language |
|-----------|--------|-------------------------------|----------|
| `cal-general` | Cal Credit Cards | `335399999` + `cal-online.co.il` | Hebrew RTL |
| `cal-paybox` | Cal (PayBox Visa variant) | `228899999` + `cal-online.co.il` | Hebrew RTL |
| `max` | Max Financial Services | `max.co.il` or `max-ב` | Hebrew RTL |
| `isracard` | Isracard Group | `isracard.co.il` | Hebrew RTL |

---

## Key Insights

### 1 — pdfplumber works for all Israeli CC formats

`pdfplumber>=0.11.9` (already in `pyproject.toml`) successfully extracts Hebrew UTF-8 text from all four formats. No fallback to `pdfminer.six` or `pymupdf` required.

```python
import pdfplumber

with pdfplumber.open(path) as pdf:
    text = pdf.pages[0].extract_text()   # Hebrew text, RTL visual order
    words = pdf.pages[0].extract_words() # [{text, x0, x1, top, bottom}]
```

### 2 — RTL column reconstruction with word positions

pdfplumber returns words in positional order. For RTL PDFs, columns run **right-to-left** (high x0 = rightmost = first logical column). Sort words by descending `x0` to get logical reading order.

```python
# Reconstruct a row from words at the same vertical position
def group_words_into_rows(words: list[dict], y_tolerance: float = 3.0) -> list[list[dict]]:
    rows: dict[float, list] = {}
    for w in words:
        key = round(w["top"] / y_tolerance) * y_tolerance
        rows.setdefault(key, []).append(w)
    # Sort each row by x0 descending (RTL: rightmost = first)
    return [sorted(row, key=lambda w: -w["x0"]) for row in sorted(rows.values(), key=lambda r: r[0]["top"])]
```

### 3 — Cal/Isracard sector field (ףנע) is a free categorization signal

Cal and Isracard PDFs include an issuer-provided sector column (`ףנע` = "branch/sector"). This maps to expense categories with ~85% confidence.

```python
ISSUER_SECTOR_MAP: dict[str, str] = {
    "ניפו חוטיב": "financial.insurance",
    "אקשמו ןוזמ": "groceries",
    "האופר": "health.medical",
    "הנפוא": "shopping.clothing",
    "תוריית": "travel",
    "רובחתו בכרכר": "fuel",
    "תרושקת": "utilities.phone",
    "תודעסמ/הפק": "restaurants",
    "תוינדעמ": "restaurants",
    "קלד": "fuel",
    "רויתו שפונ": "travel",
    "בכר יתוריש": "fuel",
    "תונוש": "other",
}
```

Max PDFs have **no sector column** — categorization must rely entirely on merchant name rules.

### 4 — Date format and Max year-suffix artifact

All formats use `DD/MM/YY` or `DD/MM/YYYY`. Max PDFs have a Hebrew-calendar year artifact that appends `7` to dates (e.g., `05/04/267` = 05/04/2026). Strip with:

```python
import re

def normalize_date(raw: str) -> str:
    """Normalize Israeli CC date strings to DD/MM/YYYY."""
    m = re.search(r"(\d{2}/\d{2}/\d{2,4})", raw)
    if not m:
        raise ValueError(f"Cannot parse date: {raw!r}")
    date_str = m.group(1)
    # Handle 2-digit year
    parts = date_str.split("/")
    if len(parts[2]) == 2:
        year = int(parts[2])
        parts[2] = str(2000 + year)
    return "/".join(parts)
```

### 5 — Amount format

All amounts use `₪ N,NNN.NN` format. Foreign amounts use currency symbol (€, $) with amount following.

```python
import re
from decimal import Decimal

def parse_ils_amount(raw: str) -> Decimal:
    """Parse ₪ NNN,NNN.NN → Decimal."""
    m = re.search(r"[\d,]+\.?\d*", raw.replace("₪", "").strip())
    if not m:
        raise ValueError(f"Cannot parse amount: {raw!r}")
    return Decimal(m.group().replace(",", ""))
```

### 6 — Installment detection (Cal)

Cal statements show installment purchases in the format `N - מ M םולשת` = "payment N of M". The `amount_ils` field is this month's charge; `installment_total_amount_ils` holds the full purchase amount.

```python
import re

def parse_installment(text: str) -> tuple[int, int] | None:
    """Return (installment_num, installment_total) or None."""
    m = re.search(r"(\d+)\s*-\s*מ\s*(\d+)\s*םולשת", text)
    if m:
        return int(m.group(2)), int(m.group(1))  # num, total
    return None
```

### 7 — FX row handling (Cal & Isracard)

FX transactions appear as multi-line entries. Isracard has a dedicated foreign section (`ל"וחב תושיכר`) with structured columns: original amount, original currency, exchange rate, conversion date, ILS charge, fee.

Cal FX rows: the transaction amount cell contains the foreign amount (e.g., `EU 103.09`), and the charge amount cell contains ILS. Exchange rate and fee appear as inline text on the same or next line.

Recommended approach: when parsing an amount cell, detect foreign currency patterns first:

```python
FOREIGN_CURRENCY_PATTERN = re.compile(r"(USD|EUR|GBP|EU|\$|€|£)\s*([\d,]+\.?\d*)")

def parse_amount_cell(raw: str) -> tuple[Decimal | None, str | None, Decimal | None]:
    """Returns (ils_amount, foreign_currency, foreign_amount)."""
    m = FOREIGN_CURRENCY_PATTERN.search(raw)
    if m:
        currency = m.group(1).replace("EU", "EUR").replace("$", "USD").replace("€", "EUR")
        foreign = Decimal(m.group(2).replace(",", ""))
        return None, currency, foreign
    return parse_ils_amount(raw), None, None
```

### 8 — Issuer detection fingerprints

Detect issuer from page-1 text before attempting format-specific parsing:

```python
def detect_issuer(page_text: str) -> str:
    """Return issuer format slug from page text fingerprints."""
    if "335399999" in page_text and "cal-online" in page_text:
        return "cal-general"
    if "228899999" in page_text and "cal-online" in page_text:
        return "cal-paybox"
    if "max.co.il" in page_text or "max-ב" in page_text:
        return "max"
    if "isracard.co.il" in page_text:
        return "isracard"
    raise ValueError("Unknown PDF issuer — add fingerprint to detect_issuer()")
```

### 9 — Isracard dual-section parsing

Isracard PDFs have two sections separated by section headers. Split on sentinel tokens:

```python
ISRACARD_FOREIGN_SENTINEL = "ל\"וחב תושיכר"     # foreign purchases
ISRACARD_DOMESTIC_SENTINEL = "ץראב"              # domestic section
```

Parse each section with its own column schema. Foreign section includes FX metadata; domestic section includes sector field.

---

## Gotchas

- **Never log raw PDF text** — it contains names, account numbers, merchant details. Log only parsed structured fields.
- **Retry on pdfplumber `PdfReadError`** — some PDFs are password-protected or corrupted. Catch and move to `errors/` folder.
- **Test all 4 formats** in unit tests with real (or anonymized) fixture PDFs. Store fixtures in `tests/fixtures/credit-card/`.
- **pdfplumber tables**: `extract_tables()` works poorly on these PDFs — the layouts use absolute positioning, not HTML-like table structures. Prefer `extract_words()` + positional reconstruction.
- **Page count varies**: Cal = 2 pages, Max = 1, Isracard = 3. Always loop `for page in pdf.pages`.

---

## Reference Files (when implemented)

- `apps/backend/app/services/expenses/parsers/cal_parser.py`
- `apps/backend/app/services/expenses/parsers/max_parser.py`
- `apps/backend/app/services/expenses/parsers/isracard_parser.py`
- `apps/backend/app/services/expenses/parsers/base_parser.py`
- `apps/backend/app/services/expenses/category_rules.yaml`
- `apps/backend/app/worker/credit_card_inbox.py`
- Architecture proposal: `.squad/decisions/inbox/keaton-credit-card-architecture.md`
