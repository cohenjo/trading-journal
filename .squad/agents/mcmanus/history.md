### Open Questions Documented

For user/squad review:
1. Account mapping: explicit `dividendAccountId` field vs name/type heuristics?
2. Unmapped sources: synthetic entry vs skip vs aggregate "Other"?
3. Tax rate: per-account vs single plan-level?
4. Feature flag: explicit boolean vs implicit field presence?
5. Growth field: add `growth_includes_dividends` flag vs documentation only?
6. Dividend growth: escalate amounts over projection years using `dividend_growth_rate`?

### Handoff to Redfoot

**Implementation checklist** (4 phases):
- Phase 1: Core dividend replacement (input contract, account mapping, per-account income, tax, currency)
- Phase 2: Reinvestment logic (surplus/deficit calc, proportional split, account.value update, savings_details)
- Phase 3: Backward compatibility (legacy path preservation, feature detection)
- Phase 4: Testing (10 unit + 1 integration + 3 edge cases)

**Test requirements specified:**
- Mass conservation: `sum(dividend income) === sum(reinvestment) + used_for_spending`
- Proportional distribution formula validation
- Currency conversion (USD→ILS when mainCurrency='ILS')
- Account mapping (case-insensitive, type fallback for IRA)
- Unmapped source handling (synthetic entry)
- Tax application (gross → net, per-account rate)
- Legacy fallback (single aggregate dividend when dividendByAccount undefined)

### Learnings

**Mass conservation patterns for cash-flow simulations:**
- Surplus year: income source exactly matches reinvestment sink (dividends are internal transfers)
- Deficit year: income partially consumed for spending, only residual reinvests
- Dividends offset deficit **before** account withdrawals (preserves balances)

**Account mapping heuristics for external data sources:**
- Primary: exact name match (case-insensitive)
- Secondary: type-based (retirement → ira)
- Tertiary: fuzzy substring ("Interactive Brokers" contains "ibkr")
- Fallback: synthetic entry for unmapped (visibility > silence)

**Currency conversion in multi-currency simulations:**
- External sources (getDividendSummary) return USD
- Internal calculations use mainCurrency (ILS for Jony)
- Single convert() point at income ingestion prevents drift
- Reinvestment uses converted amounts (no double conversion)

**Tax semantics for reinvestment:**
- Reinvest from **net** dividends (post-tax), not gross
- Per-account tax rates allow modeling of different account types (taxable vs IRA)
- Proportional distribution uses net amounts (avoid reinvesting taxes)

**Growth vs yield interaction:**
- Total return = price growth + dividend yield
- When modeling real dividends separately, growth field must represent price-only
- Risk of double-counting if user doesn't adjust growth assumption
- Need user guidance: tooltip/warning when dividendByAccount present AND dividend_yield > 0

**First-year special handling:**
- Current system uses `currentDividendPayouts()` for currentYear (yield-based)
- When real dividends available, apply uniformly to all years including current
- Simplifies logic, ensures consistency, matches getDividendSummary semantics

**Pydantic field shadowing (reminder from 2026-05-11):**
- Naming field same as imported stdlib type causes TypeError during class construction
- Example: `date: date | None` fails; use `accrual_date: date | None`
- Applies to all Pydantic models binding datetime/date/time types

### Files Modified

**Created:**
- `.squad/decisions/inbox/mcmanus-dividend-reinvest-simulation.md` (22KB design doc)

**Not modified (implementation pending):**
- `apps/frontend/src/app/plan/simulation.ts` (target for Redfoot changes)
- `apps/frontend/src/app/dividends/actions.ts` (getDividendSummary data source)
- `apps/frontend/src/app/cash-flow/page.tsx` (caller passing dividendByAccount)

### References

**Related work:**
- Dividend data inventory (2026-05-11, 2026-05-13): established getDividendSummary as canonical source
- Flex pipeline validation (2026-05-10): dividend_accruals.gross_rate ingestion
- Options income projection (2026-05-12): parallel alternative income stream with similar projection needs

**Next sprint:**
- Redfoot implements Phases 1-4 from checklist
- McManus validates mass conservation in PR review
- Keaton integrates into Sankey visualization (cash-flow page)

---

## 2026-05-18 — ✅ dividendByAccount Simulation Implementation (branch: squad/cashflow-dividend-redesign)

**Commit:** `6f5fd5d` | **File:** `apps/frontend/src/app/plan/simulation.ts` (+137 LOC, -13 LOC)

Implemented all 9 spec steps from `mcmanus-dividend-reinvest-simulation.md` + consolidated approval defaults.

- Extended `PlanSimulationInput` with `dividendByAccount?: { ibkr, schwab, ira }` (USD forward annual, constant).
- Built `dividendAccountMap` (3-tier: exact name → type/pension → fuzzy substring) + `mappedAccountIds` Set before main loop.
- Added optional `skipAccountIds?: Set<string>` param to `Accounts.processGrowthAndIncome`; mapped accounts have yield-based dividend zeroed to prevent double-counting.
- Pre-computed `perAccountDividends` array (USD→mainCurrency converted, once outside loop) + `totalRealDividendsAnnual`.
- Inside main loop: conditional emit — 3 named `Dividend - {LABEL}` income lines when `dividendByAccount` provided, else legacy `Dividend Income` single entry.
- Reinvestment block: computes `reinvestable` from three cases (full surplus / partial cover / full deficit), distributes proportionally, pushes `Dividend Reinvest - {LABEL}` savings entries, updates `account.value`, subtracts from `adjustedNetFlow` before processSavings/processDeficit.
- Silent synthetic node (default #7): `d.account === null` path emits income without balance impact.

**All 14 existing tests pass (backward compat confirmed).**

### Learnings

- `adjustedNetFlow = netFlow - totalReinvested` is the key to mass conservation: reinvest outflows are subtracted from the flow passed to `processSavings`/`processDeficit` so money isn't counted twice.
- Pre-computing per-account USD→ILS conversion outside the projection loop is both correct (constant per spec) and efficient — avoids repeated Decimal allocation each year.
- Three-case reinvestment logic (full surplus / partial cover / full deficit) maps cleanly to a single `reinvestable` scalar then proportional distribution per account.

---

## 2026-05-28 — ✅ RSU Dividend Tax & Payout Rules Implemented

**Scope:** Plan simulation engine — RSU accounts must tax dividends at 25% flat rate and force Payout policy (never reinvested), routing to income pool.

**Files changed:**
- `apps/frontend/src/app/plan/simulation.ts` — authoritative engine
- `apps/frontend/src/components/Plan/PlanEngine.ts` — legacy engine
- `apps/frontend/src/app/plan/__tests__/simulate.test.ts` — tests (42 total, all passing)

**Design decisions:**
- `applyRsuDividendOverrides(account)` runs after account construction in both `loadAccounts()` loops: forces `dividend_policy = 'Payout'`, sets 25% tax only if `dividend_tax_rate` is currently zero (user's explicit non-zero rate wins).
- Added `gross.gt(0)` guard in `processGrowthAndIncome` Payout branch to suppress zero-value entries for zero-yield RSU accounts (Wix RSU).
- Same RSU forced-Payout and 25% tax override mirrored in `PlanEngine.ts`.

**Test learnings:**
- `toBeCloseTo(x, 1)` uses ±0.05 tolerance. When checking two rates 0.05 apart (25% vs 30%), use precision `2` (±0.005) to avoid boundary ambiguity.
- Year-0 (`currentDividendPayouts`) and Year-1+ (`processGrowthAndIncome`) paths are independent — both need RSU override applied consistently.
- `rsuAccount()` test helper defaults to `currency: 'USD'`, so plans with `settings: {}` get ILS conversion via `RATES.USD = 3`. Tests checking USD-magnitude values need `settings: { mainCurrency: 'USD' }`.

### Learnings

- `applyRsuDividendOverrides` pattern (modify account in-place after construction) is clean for account-type-specific invariants without polluting the main account factory.
- `toBeCloseTo` precision semantics: precision `n` means tolerance `10^-n / 2`. Always verify boundary cases when asserting two values are "different" at a specific precision.
- Pre-existing TDD tests written for a feature before implementation may have stale expectations (wrong currency, missing fields). Diagnose failures systematically: currency conversion, missing engine fields, and savings recirculation are the three main failure modes.

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.
📌 Team update (2026-05-29T122212Z): Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.

---

## 2026-05-29 — ✅ CC-3 + CC-13 — Category Taxonomy YAML & Plan Engine Contract (branch: squad/credit-cards)

**Commit:** `b2d3c51`

**Files created:**
- `apps/backend/app/services/expenses/__init__.py` — expenses package
- `apps/backend/app/services/expenses/category_rules.yaml` — taxonomy source of truth
- `supabase/migrations/20260529122501_seed_expense_categories.sql` — idempotent seed
- `apps/backend/alembic/versions/d1d2d3d4d5d6_seed_expense_categories.py` — Alembic mirror
- `.squad/decisions/inbox/mcmanus-cc-plan-integration.md` — CC-13 plan engine sketch

**Taxonomy:** 11 top-level categories + 24 subcategories = 35 total.
All 113 regex patterns compile clean. is_transfer=true on `transfers`, `transfers-paybox`, `transfers-family`.

### Learnings

**Hebrew RTL extraction — character reversal within words (most important finding):**
- pdfplumber extracts Hebrew PDFs character-by-character in VISUAL (left-to-right on page) order.
  For RTL-rendered Hebrew, this means each Hebrew WORD has its CHARACTERS REVERSED relative
  to the logical Unicode codepoint order. Word order within a merchant name is also reversed.
- Examples confirmed from actual Cal statements:
  - `שופרסל` (Shufersal) → extracted as `לסרפוש`
  - `פנגו` (Pango parking app) → extracted as `וגנפ`
  - `בזק` (Bezeq telecom) → extracted as `קזב`
  - `ביטוח` (insurance) → extracted as `חוטיב`
  - `שווארמה` (shawarma) → extracted as `המראווש`
  - `דומינוס` (Domino's) → extracted as `סונימוד`
  - `סופר-פארם` (Super-Pharm) → extracted as `מראפ-רפוס`
  - `נינה` (Nina, from Nina DEAR restaurant) → extracted as `הנינ`
  - `נספרסו` (Nespresso) → extracted as `וסרפסנ`
- Regex patterns in category_rules.yaml target the EXTRACTED (reversed) form.
  This is critical — rules written against the display form will never match.

**Isracard-specific: English word spacing:**
- Isracard's PDF renderer inserts spaces inside English merchant names:
  `ALIEXPRESS` → `A LIEXPRESS`, `WIZZ AIR` → `W IZZ AIRJJ1Z5C`, `HBO MAX` → `H ELP.HBOMAX.COM`
- Patterns must use `\s*` or `\s+` gaps: `a\s*liexpress`, `w\s*izz\s*air`, `h\s*elp\.hbomax`

**Merchant observations from actual PDFs:**
- `לסרפוש` (Shufersal) is the dominant grocery. Appears with branch suffixes:
  `ליד הנחת תיזכרמ` (Deal Central Station), `ינושאר ןוינק` (Rishon mall).
- `PAYBOX` is always uppercase English in merchant_normalized (not Hebrew).
  Rita's dedicated PayBox Visa card (4654) makes ALL its charges via PayBox —
  every charge is a transfer by definition. The is_transfer=true on the transfers
  category and its subcategories handles this automatically.
- Recurring family PayBox recipients: Daniella Azav (₪480/month × 2 cards),
  Lihil Rubin (₪350/month, treatment/childcare), Zev Cohen (family).
- HOT appears in two contexts: HOT cable/internet (Isracard, ₪84.90 standing order)
  and HOT MOBILE (Cal card, standing order + one-time). Patterns split: `\bhot\b` for
  internet/cable, `hot\s*mobile` for mobile — subcategory rule wins first.
- Insurance (sector `חוטיב` = reversed `ביטוח`) is heavy and recurring: Klemobil
  (`ליבומלכ`) 5-installment policies, Alon insurance (`ןולייא חוטיב`), mandatory vehicle
  (`הבוח בכר`), agricultural elementary (`ירטנמלא -יאלקח`). Worth own subcategory.
- `קלד` (reversed `דלק` = fuel) appears in sector AND in merchant names of fuel stations.
  Useful as a fuel-station marker, but must be bounded (`\b`) to avoid partial matches.
- Wolt appears in multiple forms: `Wolt`, `WOLT`, `WOLT` — all match `\bwolt\b` CI.

**Table design observations (Hockney's CC-1):**
- No `is_leaf` column in the actual schema (Keaton's decision doc mentioned it, Hockney
  dropped it — correct simplification; leaf status is implied by parent_id + query).
- No `rules` column — rules are YAML-only (correct: avoids DB–YAML drift).
- The `is_transfer` column is on expense_categories itself (not just a convention in YAML),
  which means the SQL exclusion rule `WHERE c.is_transfer = false` in plan_components
  is clean and type-safe. Good design.

**CC-13 plan engine contract decisions:**
- `compute_expense_cash_outflows(household_id, lookback_months=12)` proposed signature.
- 3-month trailing average for projection (not 12-month — preserves seasonality signal).
- Lumpy items stay lumpy (no auto-amortisation). UI offers optional smoothing toggle.
- Double-counting risk: plan may have manual `monthly_expenses` field. Must gate behind
  `use_cc_expense_actuals` feature flag and prompt Jony to migrate.
- `other` category slug should be excluded from projections until resolution rate > 80%.

**Taxonomy design choices:**
- Merged insurance into `financial.insurance` subcategory (not standalone top-level).
  Justified because insurance appears alongside taxes, fees, municipal in spending pattern.
- `fuel` kept as top-level (not under travel) — fuel is a regular recurring cost, not
  a travel event. Splitting it out gives cleaner trend analysis.
- `kids-education` top-level rather than `kids` + `education` sub — all observed spend
  was kids-related (Matific, Educative for kids, youth programme). Keep simple.
- `transfers` is_transfer=true propagated to both subcategories in the seed migration.
  The is_transfer flag on subcategories means the rule engine can stop at sub-level
  without needing to traverse to parent to determine exclusion.

---

📌 **Team update (2026-05-30T07:57:13Z):** Hockney established dynamic category fetching pattern for CategoryPicker to prevent UUID staleness after taxonomy changes. New pattern: All category pickers wire to `/api/expenses/categories` endpoint at runtime. Future taxonomy changes no longer require manual TypeScript constant updates. — decided by Hockney

---

## 2026-05-30 — ✅ Housing/Utilities Category Taxonomy (direct push to main)

**Commit:** `4d0e931` | **Workflow run:** `26685706819`

Closed taxonomy gap for housing-related utility bills. User reported "Meniv Rishon is the Water Utility company in Rishon LeZion. I didn't find a category that would fit utility bills related to housing (like water, electricity, home insurance etc)."

**Distinct from existing "Utilities & Communications" category (telecom, internet, streaming).**

### Taxonomy design

Top-level slug: `housing` (English: "Housing", Hebrew: "דיור", color: #795548, icon: home)

7 subcategories:
1. **housing-water** (מים) — Israeli water utilities: Meniv Rishon (Rishon LeZion), Hagihon (Jerusalem), Mei Avivim (Tel Aviv), Mey Galim (Haifa), Pelagei Sharon (Sharon region)
2. **housing-electricity** (חשמל) — Israel Electric Corporation (IEC / חברת החשמל)
3. **housing-gas** (גז) — Cooking gas providers: Pazgas, Supergas, Amisragas
4. **housing-home-insurance** (ביטוח דירה) — Home insurance from major Israeli providers (Harel, Migdal, Phoenix, Clal, Menorah) when context includes "דירה"
5. **housing-property-tax** (ארנונה) — Municipal property tax (arnona)
6. **housing-hoa** (ועד בית) — Building HOA fees (va'ad bayit)
7. **housing-home-maintenance** (תחזוקת הבית) — Home repairs, plumber, electrician, handyman

### Merchant patterns

**category_rules.yaml additions:**
- `meniv\s*rishon|בינמ.*ןושאר` → water (Meniv Rishon utility, weight 0.95)
- `hagihon|ןוחיגה` → water (Jerusalem water, weight 0.95)
- `mei\s*avivim|םיביבא\s*ימ` → water (Tel Aviv, weight 0.95)
- `\biec\b|למשחה\s*תרבח|israel\s*electric` → electricity (IEC, weight 0.95)
- `pazgas|supergas|amisragas` → gas (cooking gas, weight 0.95)
- `arnona|הנורא` → property-tax (arnona, weight 0.98)
- `va'?ad\s*ba?yit|תיב\s*דעו` → hoa (va'ad bayit, weight 0.95)
- `(harel|migdal|phoenix|clal|menorah).*הריד` → home-insurance (context-dependent, weight 0.9)
- `(plumb|electrician|handyman|םינוקית|היצלטסניא)` → home-maintenance (weight 0.8)

**Sector mappings (categorize.py):**
- `רוייד` (reversed דיור = housing) → `"housing"`
- `ינוריע` (reversed עירוני = municipal) → `("housing", "housing-property-tax")`

### Files changed

**Migration:**
- `supabase/migrations/20260530165734_add_housing_category.sql` — idempotent (INSERT ... ON CONFLICT, UPDATE with WHERE slug = ...)
- 1 top-level + 7 subcategories
- No reparenting (all new entities)

**Backend:**
- `apps/backend/app/services/expenses/category_rules.yaml` — added Housing block before "Other"
- `apps/backend/app/services/expenses/categorize.py` — added 2 sector mappings (רוייד, ינוריע)

**Frontend:**
- `apps/frontend/src/types/expenses.ts` — added Housing to EXPENSE_CATEGORIES array for chart color map

### Deployment

- Push to main with `[apply-migrations]` marker
- Workflow run 26685706819 succeeded in 13s
- Dynamic discovery applied 1 pending migration (20260530165734_add_housing_category.sql)
- Final `expense_categories` row count: **47** (was 39, added 8 = 1 parent + 7 subs)
- Migration idempotency verified: `INSERT 0 1`, `UPDATE 1`, `INSERT 0 7`, `UPDATE 7`, `COMMIT`

### Learnings

**Housing vs Utilities distinction:**
- Existing "Utilities & Communications" category covers **telecom/streaming** (internet, mobile, HBO Max, HOT cable).
- New "Housing" category covers **dwelling utilities** (water, electricity, gas, property tax, HOA, home insurance, home maintenance).
- These are separate spending categories with different budgeting needs — user correctly identified the gap.

**Arnona (ארנונה) — property tax:**
- Extracted as `הנורא` (reversed ארנונה).
- Very specific to Israeli context (municipal tax billed by the Iriya).
- Weight 0.98 (highest in housing subcategories) — extremely specific keyword.

**Va'ad Bayit (ועד בית) — building HOA:**
- Extracted as `תיב דעו` (reversed ועד בית).
- Israel-specific term for building committee / HOA.
- Regex pattern allows English variants: `va'?ad\s*ba?yit`.

**Home insurance context patterns:**
- Used conjunction pattern: `(provider).*הריד` (reversed דירה = dwelling).
- Ensures we don't capture vehicle/life insurance from the same providers.
- Weight 0.9 — high but below utilities (arnona/water) due to context ambiguity.

**Sector mapping for municipal:**
- `ינוריע` (reversed עירוני = municipal) maps to `("housing", "housing-property-tax")`.
- This is a two-tier tuple: top-level category + subcategory.
- Follows the Transportation pattern (sector directly maps to subcategory).

**Display order:**
- Housing given display_order 12 (between Transfers=10 and Other=99).
- Leaves room for future categories (e.g., Pets, Insurance as top-level).

**Migration idempotency verification:**
- `INSERT 0 1` = new parent already exists (ON CONFLICT DO NOTHING).
- `UPDATE 1` = updated parent metadata (display_order, color, icon).
- `INSERT 0 7` = 7 new subcategories already exist (ON CONFLICT DO NOTHING).
- `UPDATE 7` = updated all 7 subcategories (metadata refresh).
- Pattern allows re-running safely — no duplicate UUIDs, no lost data.
