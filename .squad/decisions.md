# Shared Decisions & Directives

**Older entries archived to `.squad/decisions-archive/`.**

## Active Architectural Directives

### 2026-05-27: RSU Automation & Dividend Handling (consolidated)

**By:** Keaton (Lead), Hockney (Backend), McManus (Engine), Fenster (Frontend), Redfoot (Tester), via Copilot directive

**What:**

RSU accounts (Wix RSU, MSFT RSU) require special handling across the entire system:

1. **Pricing & Dividend Data**
   - Extended `price_cache` table with `dividend_yield NUMERIC(18,8)` column (migration `e5f6a7b8c9d0`)
   - New worker `rsu_plan_hydration` (cron `5 22 * * MON-FRI`) scans all plans for RSU items and patches JSON with current price, yield, fixed 25% tax rate, and Payout policy
   - New API endpoint `GET /api/finances/price-data/{symbol}` returns cached price + yield
   - Yahoo Finance resolution: MSFT and WIX are NASDAQ-listed; resolved as-is. Zero-yield tickers (WIX) store `null`.
   - **Dividend yield convention: percentage form** throughout `price_cache` and plan/snapshot JSON (`0.87` means 0.87%). yfinance returns decimal fraction (`0.0087`) — normalized exactly once at the boundary by `_yfinance_yield_to_percent()` in `price_cache.py`. `plan_components.py` divides by 100 to get the multiplication fraction; UI `<input>` shows the percentage value next to a `%` label. NOTE: `public.stock_positions.dividend_yield` (separate, older table owned by `yahoo_refresh.py`) remains decimal-fraction — do not change. Data migration `f2a3b4c5d6e7` backfills existing `price_cache` rows where `0 < dividend_yield < 1` by multiplying by 100 (idempotent).

2. **Tax & Policy Enforcement**
   - **Dividend tax rate = 25% fixed** (not plan-level `incomeTaxRate`). Applied via `applyRsuDividendOverrides()` in both `PlanEngine.ts` and `simulation.ts`
   - **Dividend policy = Payout mandatory** — RSU dividends cannot be reinvested; they flow to income pool as ordinary income
   - User can explicitly override tax rate to non-zero value; 25% is only applied when current rate is zero
   - `gross.gt(0)` guard prevents spurious zero-value dividend lines for zero-yield accounts (e.g., Wix)

3. **Frontend UI**
   - Dividend Policy section entirely hidden (not disabled) for RSU accounts — RSU Configuration block is the single authoritative surface
   - `dividendYieldOverride` flag does not reset on ticker change (preserves user intent)
   - RSU Config block visible only in planning mode (snapshots are read-only)
   - `stock_symbol` is the canonical field name in `account_settings` (not `ticker`)
   - Defensive integration: RSU code casts `data as typeof data & { dividend_yield?: number }` for forward compatibility with Hockney's endpoint extension

4. **Acceptance Criteria** (10 criteria + edge cases; all pass: 21 backend + 12 component + 13 engine tests = 46 new tests passing)
   - AC1–AC4: Price refresh, zero-yield handling, tax rate, payout policy
   - AC5–AC9: UI rendering, ticker lookup, error handling, currency conversion
   - AC10: Edge cases (zero yield, user override, multiple RSU accounts, zero shares)

**Why:**

- User-stated business rules for employer RSU grants: fixed 25% withholding tax, mandatory payout (no reinvestment), live price/yield updates
- RSU dividends are taxed as ordinary income in Israel, not capital gains
- Broker doesn't allow DRIP on RSU dividends → must route to income pool
- Extending `price_cache` is simpler than syncing RSU → `stock_positions`
- Unified rule enforcement across backend, frontend engine, and UI prevents divergent behavior

**Implementation Status:**

| Component | Status | Notes |
|-----------|--------|-------|
| Backend: `price_cache` migration | ✅ Done | Column added, `PriceQuote.dividend_yield` defined |
| Backend: `rsu_plan_hydration` worker | ✅ Done | Cron registered, JSON patching implemented |
| Backend: `/price-data/{symbol}` endpoint | ✅ Done | Returns cached price + yield |
| Backend tests | 71 passed, 3 skipped | — |
| Frontend: Engine (`PlanEngine.ts` + `simulation.ts`) | ✅ Done | RSU overrides + 25% tax + Payout enforcement |
| Frontend: Engine tests | 42/42 pass | — |
| Frontend: UI (`PlanAccountDetails.tsx` + yield banner) | ✅ Done | Hidden Dividend Policy, override toggle, readonly yield display |
| Frontend: UI tests | 23/23 pass | 13 pre-existing failing tests repaired |
| Acceptance tests | 46 new tests: 21 backend, 12 component, 13 engine | All pass ✅ |

**Known Issues & Follow-ups:**

1. ⚠️ **Yield units convention mismatch** — `plan_components.py:278` divides by 100, assuming percentage form; `price_cache` stores decimal fraction. A follow-up Hockney spawn is normalizing units (pending: `hockney-rsu-yield-units.md`)

2. User override of `dividend_tax_rate` to non-zero value wins over 25% default — this is intentional (AC10b covers this)

3. If user switches account type Broker → RSU → Broker, previous Dividend Policy settings are lost (acceptable trade-off; RSU Config block is authoritative while type=RSU)

**Branch:** `squad/rsu-ui-wiring`

**Design Memo:** `.squad/log/2026-05-27-rsu-automation-design.md`

**Related Decisions Merged from Inbox:**
- `copilot-rsu-rules.md` (user directive)
- `keaton-rsu-design.md` (architecture)
- `hockney-rsu-pricing.md` (backend pricing pipeline)
- `mcmanus-rsu-tax-model.md` (engine tax rules)
- `fenster-rsu-ui.md` (UI decisions)
- `redfoot-rsu-acceptance.md` (acceptance criteria)
# Credit-Card Expense Analysis Pipeline — Architecture Proposal

**Author:** Keaton (Lead)
**Date:** 2026-05-29
**Status:** Proposal — awaiting Jony sign-off on Section 8 open questions before implementation begins

---

## 1. PDF Format Survey

pdfplumber 0.11.9 is already installed in `apps/backend`. All PDFs extract successfully with text. No format required a fallback parser. Key finding: **all PDFs are Hebrew RTL** — including files named `statement__*.pdf` (a Max naming convention, not English content).

### Format A — Cal General (`דף פירוט דיגיטלי כאל NN-NN.pdf`)

| Field | Value |
|-------|-------|
| Issuer | Cal (Credit Cards for Israel — מ"עב לארשיל יארשא יסיטרכ) |
| Network | Mastercard (דראקרטסמ) |
| Cardholder | Jony Vesterman Cohen — card ending **9356** (Business Gold) |
| Period | Monthly; header e.g. `02/01/26-ל ישדוח בויח ףד` = "monthly charge sheet for 02/01/26" |
| Account | 04-136-0000146368 |
| Language | Hebrew RTL |
| Pages | 2 (main ledger + continuation) |

**Column layout (RTL, left-to-right in extracted text order):**
```
בויח םוכס | הקסעה םוכס | סיטרכ גצוה | ףנע | קסעה תיב םש | ךיראת
 (charge)    (txn amt)   (card+method)  (sector) (merchant)    (date)
```

Sample data row:
```
₪ 126.00 | ₪ 622.00 | אל | 5-מ 1 םולשת | ניפו חוטיב | טיבל תונכוס חוטיב ליבומלכ | 24/12/2025
```
→ Date: 24/12/2025, Merchant: "ליבומלכ" insurance agency, Sector: "ניפו חוטיב" (finance & insurance), installment 1 of 5, txn amount ₪622, this month's charge ₪126.

**Sector values observed in Cal:**
- `ניפו חוטיב` → finance & insurance
- `אקשמו ןוזמ` → food & beverages
- `האופר` → health/medicine
- `הנפוא` → fashion/clothing
- `תוריית` → tourism
- `רובחתו בכרכר` → vehicles & transportation
- `תרושקת` → communications/telecom

**Installment format:** `5 - מ 1 םולשת` = payment 1 of 5. Fields: installment_num=1, installment_total=5.

**FX rows:** Present. Example: `₪ 391.21 | EU 103.09` with exchange rate `3.7573` and fee noted inline.

**Parse strategy:** Line-by-line text scan. Skip header/footer sentinel rows. Regex: date=`\d{2}/\d{2}/\d{4}`, amount=`₪\s*[\d,]+\.?\d*`, sector=known Hebrew token list. Installment detected by "מ N םולשת" pattern.

---

### Format B — Cal PayBox (`639156527*.pdf`)

| Field | Value |
|-------|-------|
| Issuer | Cal (same company, PayBox Visa product variant) |
| Network | Visa |
| Cardholder | **Rita** Vesterman Cohen — card ending **4654** |
| Period | Monthly |
| Account | 10-944-0001415557 |

**Format is structurally identical to Cal General.** Distinguishing markers: page header shows `סקובייפ סיטרכ` (PayBox card) and code prefix `228899999` vs `335399999` for the general card. Column order, date format, amount format, and sector field are the same.

**Parse strategy:** Reuse Cal General parser; detect variant by header marker.

---

### Format C — Max (`statement__29_05_2026-N.pdf`)

| Field | Value |
|-------|-------|
| Issuer | Max Financial Services (max.co.il) |
| Network | Mastercard |
| Cardholder | **Rita** Vesterman Cohen — card ending **1494** |
| Period | Monthly; `02/05/26 ךיראתל ןובשחב םיבויחה טורפ` |
| Account | 10-944-01415557 |

**Column layout (RTL):**
```
תורעה | בויחה םוכס | הקסעה םוכס | גוס הקסעה | קסעה/קסעה תיב םש | ךיראת
(notes)  (charge)    (txn amt)    (type)       (merchant)           (date)
```

**Type values:** `הליגר` (regular), `עבק תארוה` (standing order).

**Date quirk:** Dates sometimes have "7" suffix (e.g., `05/04/267`). This is a Hebrew year suffix (5787) bleeding into extracted text due to PDF layout. Strip trailing non-date characters.

**No sector column in Max** — categorization must be inferred entirely from merchant name.

**Parse strategy:** detect "max.co.il" or "max-ב" in page text as issuer marker.

---

### Format D — Isracard (`Unknown-N.pdf`)

| Field | Value |
|-------|-------|
| Issuer | Isracard Group (isracard.co.il) |
| Network | Mastercard Corporate Gold (בהז טירופרוק) |
| Cardholder | **Jony** Vesterman Cohen — card ending **3557** |
| Period | Monthly; `02/05/26 :ךיראתל ךיתולועפ טורפ` |
| Account | 04-136-0146368 |

**Two distinct sections per statement:**

1. **Foreign purchases** (`ל"וחב תושיכר`):
   ```
   בויחה םוכס | הלמע | רעש | הרמה ךיראת | $-ב םוכס | ירוקמ םוכס | קסעה תיב | ךיראת
   (charge ILS)  (fee)  (rate) (conv date)  ($ amt)   (orig amt)    (merchant)  (date)
   ```
   Example: `7,582.51 | 0.00 | 3.6360 | 03/04/26 | 2,085.40 € | EUROPAPARK HOTELBE | 02/04/26`

2. **Domestic transactions** (`ץראב ...תוקסע`):
   ```
   ח"שב ףסונ טוריפ | בויחה | הקסעה | ףנע | קסע תיב םש | סיטרכ | ךיראת
   (extra detail)   (charge) (txn)  (sector) (merchant)    (card)   (date)
   ```

**Sector values observed in Isracard:**
- `תוינדעמ` → gourmet/delicatessen
- `הפק/תודעסמ` → café/restaurant
- `בכר יתוריש` → car services
- `קלד` → fuel
- `רויתו שפונ` → travel & recreation
- `תונוש` → miscellaneous

**"Unknown" naming:** These files are from Isracard's email delivery system. The file name in the user's download folder is auto-generated without issuer context. Recommend renaming logic at inbox ingestion time.

**Parse strategy:** Detect `isracard.co.il` or `*3557*` header sentinel. Split into two sections at `ל"וחב תושיכר` and `ץראב` section headers.

---

### Parsing Risks

| Risk | Format | Mitigation |
|------|--------|------------|
| RTL text order — pdfplumber extracts visually, not logically | All | Use word-level extraction with x0 positions; sort columns by x-coordinate (RTL: right-to-left) |
| Date suffix noise ("267") | Max | Strip trailing non-numeric chars from date field; validate with `DD/MM/YY` regex |
| FX rows span multiple text fragments | Cal, Isracard | Multi-line merge: when amount contains foreign currency symbol, attach next line |
| Installment rows reference original total | Cal | Store `installment_num` + `installment_total`; use `amount_ils` = this-month charge |
| Hebrew encoding | All | pdfplumber handles UTF-8 Hebrew natively — confirmed working |

---

## 2. Data Model

### Amount Convention

**Recommendation: `NUMERIC(12,2)` in ILS (shekels).**

Rationale: Israeli credit card statements present amounts in shekels with 2 decimal places (agorot precision). NUMERIC(12,2) gives up to ₪9,999,999,999.99 — sufficient for any household credit card. This matches the `price_cache` / RSU precedent using NUMERIC for financial values. Agorot-as-integer would be `BIGINT` storing `12600` for ₪126.00; this is technically more precise but adds cognitive overhead when reading queries. Since the source documents are always 2dp, NUMERIC(12,2) is the right level.

For foreign currency amounts: stored in `amount_original_currency NUMERIC(14,4)` to handle currencies like JPY (0 dp) or currencies with 4dp precision.

### Dedup Strategy

**SHA-256 of raw file bytes.** Rationale: file content is immutable (downloaded from bank), and byte-level identity is sufficient. Content-hash would require parsing first — circular for dedup-before-parse. Store as `CHAR(64)` hex digest.

---

### Tables

#### `expense_inbox`
Queue of files pending ingestion.

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
household_id    UUID NOT NULL REFERENCES households(id)
file_path       TEXT NOT NULL          -- absolute or repo-relative path
file_name       TEXT NOT NULL          -- original filename
file_hash       CHAR(64) NOT NULL      -- SHA-256 hex
file_size_bytes BIGINT
status          TEXT NOT NULL DEFAULT 'pending'
                  -- pending | processing | done | error | duplicate
error_message   TEXT
retry_count     INT NOT NULL DEFAULT 0
queued_at       TIMESTAMPTZ NOT NULL DEFAULT now()
processed_at    TIMESTAMPTZ
UNIQUE (file_hash)                     -- dedup gate
```

RLS: household_id = auth.uid() household.

---

#### `credit_card_statements`
One row per successfully parsed PDF.

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
household_id        UUID NOT NULL REFERENCES households(id)
inbox_id            UUID REFERENCES expense_inbox(id)
file_hash           CHAR(64) NOT NULL UNIQUE
source_file_path    TEXT NOT NULL
source_file_name    TEXT NOT NULL
issuer              TEXT NOT NULL        -- 'cal' | 'max' | 'isracard'
issuer_format       TEXT NOT NULL        -- 'cal-general' | 'cal-paybox' | 'max' | 'isracard'
cardholder_name     TEXT NOT NULL        -- as extracted from PDF
cardholder_id       UUID REFERENCES household_members(id)
card_last4          TEXT NOT NULL        -- last 4 digits
card_network        TEXT                 -- 'visa' | 'mastercard'
account_number      TEXT                 -- bank account reference from PDF
period_from         DATE NOT NULL
period_to           DATE NOT NULL
total_amount_ils    NUMERIC(12,2)        -- total charge for period
currency            TEXT NOT NULL DEFAULT 'ILS'
parse_status        TEXT NOT NULL DEFAULT 'ok'
                      -- ok | partial | failed
parse_warnings      JSONB                -- array of parser warning strings
ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now()
```

RLS: household_id policy.

---

#### `credit_card_transactions`
One row per line-item (transaction) extracted from a statement.

```sql
id                          UUID PRIMARY KEY DEFAULT gen_random_uuid()
household_id                UUID NOT NULL REFERENCES households(id)
statement_id                UUID NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE
txn_date                    DATE NOT NULL         -- date of purchase
posting_date                DATE                  -- date charged (may differ)
merchant_raw                TEXT NOT NULL         -- verbatim from PDF
merchant_normalized         TEXT                  -- cleaned (uppercase, trimmed)
amount_ils                  NUMERIC(12,2) NOT NULL  -- charge in ILS (this-month for installments)
amount_original_currency    NUMERIC(14,4)         -- original amount if FX
original_currency           CHAR(3)               -- ISO 4217 e.g. 'USD', 'EUR'
fx_rate                     NUMERIC(10,6)         -- ILS per original currency unit
fx_fee_ils                  NUMERIC(12,2)         -- FX conversion fee
installment_num             SMALLINT              -- 1-based, NULL if not installment
installment_total           SMALLINT              -- total installments, NULL if not
installment_total_amount_ils NUMERIC(12,2)        -- full purchase amount if installment
issuer_sector_raw           TEXT                  -- ףנע field verbatim (Cal/Isracard only)
txn_type                    TEXT                  -- 'regular' | 'standing_order' | 'installment' | 'credit' | 'fx'
category_id                 UUID REFERENCES expense_categories(id)
subcategory_id              UUID REFERENCES expense_categories(id)
resolution_status           TEXT NOT NULL DEFAULT 'unresolved'
                              -- unresolved | auto | user_confirmed
resolution_source           TEXT                  -- 'rule' | 'issuer_sector' | 'learned' | 'user'
resolved_at                 TIMESTAMPTZ
resolved_by                 UUID                  -- user_id if user_confirmed
created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
```

Index: `(household_id, txn_date)`, `(statement_id)`, `(merchant_normalized)`, `(category_id)`, `(resolution_status)`.

RLS: household_id policy.

---

#### `expense_categories`
Hierarchical taxonomy (top-level + subcategories).

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
parent_id       UUID REFERENCES expense_categories(id)  -- NULL = top-level
slug            TEXT NOT NULL UNIQUE     -- machine key e.g. 'travel.flights'
name            TEXT NOT NULL            -- English display
name_he         TEXT NOT NULL            -- Hebrew display
display_order   SMALLINT NOT NULL DEFAULT 0
is_leaf         BOOLEAN NOT NULL DEFAULT false  -- true = subcategory
icon            TEXT                     -- emoji or icon name
```

**Seed taxonomy:**

| Slug | Name (EN) | Name (HE) | Parent |
|------|-----------|-----------|--------|
| groceries | Groceries | מזון וסופרמרקט | — |
| restaurants | Restaurants & Cafés | מסעדות | — |
| food | Food & Drink | אוכל ושתייה | — |
| travel | Travel | נסיעות ותיירות | — |
| travel.flights | Flights | טיסות | travel |
| travel.hotels | Hotels | מלונות | travel |
| travel.car_rental | Car Rental | השכרת רכב | travel |
| travel.transit | Public Transit | תחבורה ציבורית | travel |
| shopping | Shopping | קניות | — |
| shopping.clothing | Clothing & Fashion | ביגוד ואופנה | shopping |
| shopping.electronics | Electronics | אלקטרוניקה | shopping |
| shopping.home | Home & Living | בית וריהוט | shopping |
| health | Health | בריאות | — |
| health.pharmacy | Pharmacy | בית מרקחת | health |
| health.medical | Medical Services | שירותים רפואיים | health |
| sports | Sports & Fitness | ספורט וכושר | — |
| utilities | Utilities | שירותים | — |
| utilities.phone | Phone & Mobile | טלפון | utilities |
| utilities.internet | Internet | אינטרנט | utilities |
| utilities.electricity | Electricity & Gas | חשמל וגז | utilities |
| entertainment | Entertainment | בידור | — |
| fuel | Fuel | דלק | — |
| kids | Kids & Education | ילדים וחינוך | — |
| financial | Financial Fees | עמלות ופיננסים | — |
| financial.insurance | Insurance | ביטוח | financial |
| financial.fees | Bank Fees | עמלות בנק | financial |
| transfers | Transfers (PayBox etc.) | העברות | — |
| other | Other | אחר | — |

---

#### `merchant_category_mappings`
Learned + rule-based merchant → category mapping.

```sql
id                  UUID PRIMARY KEY DEFAULT gen_random_uuid()
household_id        UUID REFERENCES households(id)  -- NULL = global rule
merchant_pattern    TEXT NOT NULL       -- normalized merchant name or regex
is_regex            BOOLEAN NOT NULL DEFAULT false
category_id         UUID NOT NULL REFERENCES expense_categories(id)
subcategory_id      UUID REFERENCES expense_categories(id)
confidence          NUMERIC(3,2) NOT NULL DEFAULT 1.0  -- 0.0–1.0
source              TEXT NOT NULL       -- 'rule' | 'user' | 'inferred'
created_by          UUID                -- user_id for 'user' source
occurrence_count    INT NOT NULL DEFAULT 1
last_used_at        TIMESTAMPTZ
created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
```

Index: `(merchant_pattern)`, `(household_id, merchant_pattern)`.

---

### Migration Files

Per project convention, two files required per schema change:
- `supabase/migrations/YYYYMMDDHHMMSS_add_credit_card_tables.sql` — production (Supabase apply)
- `apps/backend/alembic/versions/XXXXXX_add_credit_card_tables.py` — parity

Migration timestamp recommendation: `20260530120000` (next available after current latest `20260527204500`).

---

## 3. Ingestion Flow

### Inbox Folder Layout

```
reports/credit-card/
  inbox/          ← user drops files here (watched by worker)
  processed/      ← successful parses moved here
  errors/         ← failed parses moved here with .error.txt sidecar
```

The existing `reports/credit-card/` folder becomes the staging area. Files already in root are treated as historical — run a one-shot backfill job.

### Worker Strategy

**Polled interval job** (consistent with existing APScheduler pattern). Register as `credit_card_inbox_poll` with `interval: 60 seconds`. No file-system watcher needed — simpler, testable, and Docker-friendly.

### Per-File Lifecycle

```
1. SCAN      — list files in reports/credit-card/inbox/ (*.pdf)
2. HASH      — SHA-256 of file bytes
3. DEDUP     — SELECT id FROM expense_inbox WHERE file_hash = $hash
               → if found AND status='done': skip, log "already processed"
               → if found AND status='error': increment retry_count, re-queue
4. QUEUE     — INSERT INTO expense_inbox (status='processing', ...)
5. DETECT    — identify issuer by page-1 text fingerprint:
               "לאכ-ב ...335399999" → cal-general
               "לאכ-ב ...228899999" → cal-paybox
               "max.co.il" → max
               "isracard.co.il" → isracard
               else → error: unknown format
6. PARSE     — format-specific parser returns list[TransactionRow]
7. CATEGORIZE— for each transaction: rules engine → learned mappings → unresolved queue
8. PERSIST   — INSERT credit_card_statements + credit_card_transactions (transaction)
9. MOVE      — mv inbox/{file} processed/{YYYY-MM}/{file}
10. UPDATE   — expense_inbox status='done', processed_at=now()
    ERROR    — status='error', error_message=str(exc), move to errors/
```

**Idempotency:** UNIQUE constraint on `file_hash` in both `expense_inbox` and `credit_card_statements` guarantees re-ingest = no-op. Step 3 check prevents re-processing.

---

## 4. Categorization Engine

### Architecture

Three-tier priority chain (each tier only runs if previous yields no match):

```
Tier 1: Issuer sector mapping
         Cal/Isracard PDFs include "ףנע" (sector) field.
         Hebrew sector → category slug mapping table (hardcoded, ~20 entries).
         resolution_source = 'issuer_sector', confidence = 0.85

Tier 2: Deterministic rules
         Load apps/backend/app/services/expenses/category_rules.yaml
         Each rule: {pattern: str, is_regex: bool, category: slug, subcategory: slug}
         Match against merchant_normalized (normalized = uppercase, strip punctuation/ltd suffixes).
         resolution_source = 'rule', confidence = 1.0

Tier 3: Learned mappings
         SELECT * FROM merchant_category_mappings
         WHERE merchant_pattern = $merchant_normalized
           AND (household_id = $household_id OR household_id IS NULL)
         ORDER BY source='user' DESC, occurrence_count DESC LIMIT 1
         resolution_source = 'learned', confidence = mapping.confidence

Fallback: resolution_status = 'unresolved' → added to resolution queue
```

### `category_rules.yaml` Format

```yaml
# apps/backend/app/services/expenses/category_rules.yaml
# Entries matched against merchant_normalized (uppercase, ASCII-folded)
# order matters — first match wins

rules:
  - pattern: "^GOOGLE"
    is_regex: true
    category: utilities
    subcategory: utilities.internet

  - pattern: "NETFLIX"
    category: entertainment

  - pattern: "SPOTIFY"
    category: entertainment

  - pattern: "WOLT"
    category: restaurants

  - pattern: "UBER EATS"
    category: restaurants

  - pattern: "MCDONALDS|MCDONALD"
    is_regex: true
    category: restaurants

  - pattern: "ELAL|EL AL"
    is_regex: true
    category: travel
    subcategory: travel.flights

  - pattern: "HOT MOBILE|HOT.MOBILE"
    is_regex: true
    category: utilities
    subcategory: utilities.phone

  - pattern: "PAYBOX"
    category: transfers

  - pattern: "UPAPP"
    category: transfers

  - pattern: "SUPER-PHARM|SUPERPHARM"
    is_regex: true
    category: health
    subcategory: health.pharmacy
```

### Issuer Sector Mapping (Hebrew → slug)

```python
ISSUER_SECTOR_MAP = {
    "ניפו חוטיב": "financial.insurance",
    "אקשמו ןוזמ": "groceries",
    "האופר": "health.medical",
    "הנפוא": "shopping.clothing",
    "תוריית": "travel",
    "רובחתו בכרכר": "fuel",       # vehicles — may refine
    "תרושקת": "utilities.phone",
    "תודעסמ/הפק": "restaurants",
    "תוינדעמ": "restaurants",
    "קלד": "fuel",
    "רויתו שפונ": "travel",
    "בכר יתוריש": "fuel",          # car services
    "תונוש": "other",
}
```

### User-Confirmed Mappings

**Auto-promote policy:** After a user confirms a mapping, it is stored in `merchant_category_mappings` with `source='user'` immediately. No waiting for N occurrences — user confirmation is authoritative. Global rules (household_id = NULL) may be seeded from high-confidence user mappings across households in a future batch (not now).

---

## 5. Resolution UI / API

### FastAPI Endpoints

```
GET  /api/expenses/unresolved
     Query params: limit=50, offset=0
     Returns: list of transactions with resolution_status='unresolved',
              grouped by merchant_normalized (show count + total),
              suggested categories (top 3 from rules + issuer sector)

POST /api/expenses/resolve
     Body: { transaction_ids: UUID[], category_id: UUID, subcategory_id?: UUID,
             apply_to_merchant: bool }
     - Updates resolution_status='user_confirmed', resolution_source='user'
     - If apply_to_merchant=true: upsert merchant_category_mappings
     - If apply_to_merchant=true: back-applies to all 'unresolved' transactions
       with same merchant_normalized in this household

GET  /api/expenses/monthly-summary
     Query params: year=2026, household_id (from auth)
     Returns: month buckets with total per top-level category

GET  /api/expenses/by-category
     Query params: year=2026, month=5 (optional), category_slug
     Returns: transactions list + subtotal

GET  /api/expenses/statements
     Returns: list of ingested statements (issuer, cardholder, period, total)

POST /api/expenses/ingest
     Body: { file_path: str }   -- manual trigger (Jony can drop + trigger)
     Enqueues a file for processing without waiting for the poll cycle
```

### Frontend Page: `/finances/expenses`

**Layout (single page, three panels):**

1. **Monthly Overview** (top half)
   - Bar chart (lightweight-charts): 12 months × stacked bars by top-level category
   - Toggle: show by person (Jony / Rita / combined)
   - Month selector → drills into category breakdown

2. **Category Breakdown** (middle)
   - Pie/donut chart for selected month
   - Click category → transaction list drawer

3. **Resolution Queue** (bottom, collapsible badge shows count)
   - Table: merchant_raw | issuer_sector_raw | amount | suggested_category | action
   - Batch-select + "Categorize as..." dropdown
   - "Apply to all future [merchant]" toggle
   - Empty state: "All transactions categorized 🎉"

**Route files (Next.js App Router):**
```
apps/frontend/src/app/finances/expenses/
  page.tsx                    -- layout + data fetching
  components/
    expense-monthly-chart.tsx
    expense-category-pie.tsx
    resolution-queue.tsx
    resolution-row.tsx
```

---

## 6. Plan Engine Integration (Future Sketch)

**Do not implement now.** Contract for when McManus wires credit expenses into `plan_components.py`:

```python
# Monthly expense totals by category — output shape
ExpenseMonthSummary = TypedDict("ExpenseMonthSummary", {
    "year": int,
    "month": int,           # 1–12
    "household_id": str,
    "totals_by_category": dict[str, float],  # slug → ILS float
    "total_ils": float,
    "transaction_count": int,
})

# plan_components.py consumes:
# SELECT category_slug, SUM(amount_ils) FROM credit_card_transactions
#   WHERE household_id=$id AND txn_date BETWEEN $period_start AND $period_end
#   GROUP BY category_slug
# → maps to cash_outflows[category_slug] in plan projection
```

No plan_components.py changes required now. Future PR: add `get_monthly_expense_totals(household_id, year, month)` helper and wire into income/expense statement section.

---

## 7. Work Decomposition

### Critical Path

```
[DB migration] → [Parser + Ingestion worker] → [Categorization engine]
                                             ↓
[Resolution API] ←→ [Resolution UI] ←─────────
                                             ↓
[Monthly Summary API] → [Expenses page UI]
```

Items in the same tier can be parallelized.

### Work Items

| ID | Title | Agent | Size | Depends on | Notes |
|----|-------|-------|------|------------|-------|
| CC-1 | DB migrations (all 5 tables) | Hockney | S | — | Supabase + Alembic both |
| CC-2 | PDF parsers for 4 formats (Cal/PayBox/Max/Isracard) | Hockney | L | CC-1 | RTL risk item |
| CC-3 | Category rules YAML + issuer sector mapping | McManus | S | — | Parallelizable with CC-1 |
| CC-4 | Categorization engine service | Hockney | M | CC-1, CC-3 | Rules + learned + fallback |
| CC-5 | Inbox poll worker job (register in registry.py) | Hockney | M | CC-2, CC-4 | Triggers worker redeploy gate |
| CC-6 | FastAPI endpoints (5 routes) | Hockney | M | CC-1, CC-4 | |
| CC-7 | Resolution UI page + components | Fenster | M | CC-6 | |
| CC-8 | Expense monthly chart + category breakdown UI | Fenster | M | CC-6 | |
| CC-9 | Backend tests (parsers + categorization + API) | Redfoot | M | CC-2, CC-4, CC-6 | |
| CC-10 | Frontend tests (resolution queue + chart) | Redfoot | S | CC-7, CC-8 | |
| CC-11 | Docker / worker rebuild verification | Kujan | S | CC-5 | Mandatory per charter |
| CC-12 | Security review (PDF path traversal, upload limits) | Rabin | S | CC-5, CC-6 | Inbox folder perms |
| CC-13 | Category taxonomy review + plan engine contract | McManus | S | CC-3 | Sketch only for now |
| CC-14 | Historical backfill (run parsers on existing 30 PDFs) | Hockney | S | CC-5 | One-shot script |

**Suggested fan-out:**
- Sprint A (parallel): CC-1 (Hockney), CC-3 (McManus)
- Sprint B (after CC-1): CC-2, CC-4, CC-6 (Hockney); CC-12 (Rabin)
- Sprint C (after CC-2+CC-6): CC-5 (Hockney), CC-7 + CC-8 (Fenster)
- Sprint D (after CC-5+CC-7+CC-8): CC-9, CC-10 (Redfoot), CC-11 (Kujan), CC-14 (Hockney)

---

## 8. Open Questions — Decisions Needed Before Build Starts

These are blockers. Jony must answer all before CC-1 begins.

1. **Cardholder mapping** — Confirm the following card-to-person assignment:
   - Cal card 9356 → **Jony** (Business Gold Mastercard)
   - Isracard card 3557 → **Jony** (Corporate Gold Mastercard)
   - Cal PayBox card 4654 → **Rita** (Visa Platinum PayBox)
   - Max card 1494 → **Rita** (Mastercard)
   - Are there additional cards not yet in the sample set?

2. **Category taxonomy** — Review the seed list in Section 2 + Section 4 above. Anything to add, remove, or rename? Particularly: should PayBox/Paybox transfers (to Daniella Azav, Zev etc.) be categorized as "Transfers" (separate from household expenses) or as the underlying expense type?

3. **Multi-currency storage** — Confirmed plan: store original foreign currency + FX rate per transaction (already in the proposed schema). Any objection?

4. **Inbox folder location** — Proposed: `reports/credit-card/inbox/`. Does this work with how you currently organize downloads? Alternatively, should this be a Supabase Storage bucket (matching the pension-uploads pattern) rather than a local folder?

5. **Issue tracking** — One GitHub "epic" issue + per-work-item sub-issues (CC-1 through CC-14), or a single issue listing all items?

6. **Branch strategy** — Single feature branch `squad/credit-card-expense-pipeline` or per-PR branches (one per work item)? Recommendation: per-PR branches for cleaner review history.

7. **PayBox transfers** — Many PayBox transactions are household cash transfers (Daniella, Zev, etc.), not vendor expenses. Should these be tagged as `transfers` and excluded from household expense totals, or included?

8. **Historical backfill** — The 30 sample PDFs in `reports/credit-card/` root: run backfill immediately after worker goes live, or defer?

9. **Cardholder names stored how** — Should `credit_card_statements.cardholder_name` be a free-text string extracted from the PDF, or a FK to a `household_members` table? If FK, do household members exist as a table in the current schema?

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Hebrew RTL column misalignment** — pdfplumber extracts words positionally; column order in RTL text can shift across PDF versions | Medium | High | Use word-level extraction with `x0` column positions; write positional column detector that validates expected column header tokens before parsing body rows |
| **Wrong category at scale** — with ~300 transactions/month, 10% miscategorization = 30 wrong rows visible to user | Medium | Medium | Every transaction stores `resolution_status` and `resolution_source`. Resolution queue surfaces all unresolved. `issuer_sector` provides a 2nd signal. |
| **New PDF format / bank** — banks update PDF layouts without notice | Low | High | Parser detection is fingerprint-based; unknown formats raise `ParseError` and land in `errors/` folder with full file. User sees error in UI. Add format version tracking. |
| **PII in PDFs** — names, account numbers, transfer recipients | Certainty | High | Never log raw PDF text. Store only parsed fields. `reports/` folder is gitignored. Inbox files stay local (not uploaded to cloud unless user opts into Supabase Storage). Rabin review mandatory (CC-12). |
| **Worker redeploy gate** ⚠️ | Certainty | High | CC-5 modifies `apps/backend/app/worker/`. Per Keaton charter: merge is INCOMPLETE until `./scripts/rebuild-worker.sh` runs and post-rebuild verification passes. CC-11 (Kujan) verifies. |
| **Date parsing errors** — Max format has Hebrew year suffix in dates | Medium | Medium | Regex `(\d{2}/\d{2}/\d{2,4})` with post-process strip of trailing non-digits |
| **Installment double-counting** — same purchase appears as 5 separate charges across 5 months | Low | Medium | `installment_total_amount_ils` stored separately. Monthly summary uses `amount_ils` (this month's charge only). Summary tooltip can show installment context. |

---

## 10. Constraint Budget

Implementation agents may ask Jony **up to 2 clarifying questions per work item** before proceeding. Beyond 2, they must make the best reasonable decision and note it as an assumption in the PR description for Jony to review.

Keaton will review all PRs for CC-2 (parsers), CC-4 (categorization engine), CC-5 (worker job), and CC-6 (API endpoints) before merge. CC-7/CC-8 frontend PRs may be approved by Fenster self-review unless Jony wants a look.

---

*Decision file authored 2026-05-29. Awaiting Jony sign-off on Section 8 before work item issues are created.*
