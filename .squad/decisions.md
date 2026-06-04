# Shared Decisions & Directives

**Older entries archived to `.squad/decisions-archive/`.**

## Active Architectural Directives

### 2026-06-01: CC-2 Parser Architecture Decisions

**By:** Hockney (Backend Dev)

**Scope:** Parser design trade-offs for 4 issuers (Cal, Isracard, Max, PayBox).

**Key Decisions:**

1. **Section-splitting (Isracard):** Per-page state machine (not full-text split) for handling `'none'` → `'foreign'` or `'domestic'` transitions. Israeli bank PDFs interleave sections across pages; full-text split fails on multi-page statements.

2. **Sector/merchant extraction:** Sorted-longest-first substring search on known sector vocabulary (not regex). Hebrew BiDi text interacts unpredictably with regex anchors in some Python versions.

3. **Hebrew RTL storage:** pdfplumber returns VISUAL (display/reversed) order. Store all Hebrew strings verbatim — category engine's `_SECTOR_TO_SLUG` map and YAML patterns are all written in visual order to match.

4. **Max date quirk:** Year field occasionally has 3 digits (`267`) due to rendering artefact. Normalize by taking first 2 digits: `int(year_str[:2])`.

5. **Per-PDF timeout:** Use `signal.SIGALRM` (30s) for timeout enforcement. Simpler than threading for single-threaded CPU-bound PDF parsing. Note: POSIX-only — Windows port would use `concurrent.futures.ThreadPoolExecutor`.

6. **Test fixtures:** Store corrupt-PDF fixture in `tests/credit_card_pipeline/_corrupt_test.pdf` (not `/tmp` — environment prohibits `/tmp` writes). Use `module`-scoped autouse pytest fixture to auto-create and teardown.

---

### 2026-05-29: CC-1 Data Model Trade-offs

**By:** Hockney (Backend Dev)

**Schema Decisions:**

1. **Table creation order:** Corrected from Keaton's spec-reading order. Actual dependency chain:
   `expense_inbox` → `expense_categories` → `credit_card_statements` → `credit_card_transactions` → `merchant_category_mappings`
   (Categories FK must exist before transactions.)

2. **`is_transfer` vs `is_leaf`:** Spec uses `is_transfer: bool` (not Keaton's `is_leaf`). `is_leaf` inferable from `parent_id IS NOT NULL` anyway.

3. **Partial unique indexes:** `merchant_category_mappings` uses two partial indexes (not composite) to handle nullable `household_id`:
   - `WHERE household_id IS NOT NULL` → one per merchant per household
   - `WHERE household_id IS NULL` → one global fallback per merchant
   (SQL treats `NULL != NULL`; composite unique would permit multiple global entries.)

4. **`expense_inbox.household_id` nullable:** Per spec (not Keaton's NOT NULL). Allows files queued before household assignment.

5. **`card_last4` as CHAR(4):** Fixed-width enforces constraint; exactly 4 digits always.

**Amount precision:** NUMERIC(12,2) for ILS, NUMERIC(14,4) for FX calculations, NUMERIC(12,8) as needed. RLS pattern uses existing `is_household_member()` helper. Category seeding deferred to McManus. Alembic revision chain: `c1c2c3c4c5c6 → f2a3b4c5d6e7`.

---

### 2026-05-29: CC-14 Backfill Report — 30 PDFs Ingested

**By:** Hockney (Backend Dev)

**Pipeline State:**

All 30 credit-card PDFs successfully parsed and ingested:

| Metric | Initial | Final | Δ |
|--------|---------|-------|---|
| PDFs in root | 30 | 0 | -30 |
| PDFs in `processed/` | 1 | 30 | +29 |
| `credit_card_statements` | 1 | 30 | +29 |
| `credit_card_transactions` | 3 | 407 | +404 |

**Processing:** 3 scan cycles over ~6 minutes (60s interval). Zero file errors; dedup crash fixed mid-run.

**Cardholder Verification:** All 4 expected cards present + 2 unexpected supplementary cards (Cal 5712 for Jony, PayBox 3060 for Jony).

**Categorization Quality:**
- 176 transactions (43%) auto-resolved via sector rules (`resolution_status='auto'`, `resolution_source='rule'`)
- 40 transactions (10%) tagged as transfers (PayBox transfers correctly excluded)
- 191 transactions (47%) unresolved, awaiting category mapping
- **Gap:** `expense_categories` table empty (seed not run). Categorization engine matched; FK linkage blocked. **Action:** McManus must seed categories before category_id populates.

**Edge Cases Handled:**
- Statement period dates: `date.min` for Cal 5712 + PayBox (parser variant issue, not blocker)
- FX transactions: 36 rows with `original_currency`, `amount_original`, `fx_rate` correctly populated
- Refunds: 4 negative-amount rows stored as-is
- Hebrew RTL merchants: Stored in visual order (as pdfplumber yields)
- Duplicate detection: Smoke-test PDF re-queued; dedup correctly flagged as duplicate

**Bug Found & Fixed:** Duplicate-file crash (`IntegrityError` on duplicate hash INSERT). Fix committed in `expenses_inbox.py` (moved duplicate to processed; no DB write).

**Verdict:** Pipeline ready for user. Prerequisites: `expense_categories` seed (McManus), Docker rebuild for dedup fix (Kujan).

---

### 2026-05-29: CC-11 Rebuild Verification v2 — All Fixes Validated

**By:** Kujan (QA/Integration)

**Rebuild Outcomes:** ✅ PASSED

| Phase | Status | Details |
|-------|--------|---------|
| Pre-flight | ✅ | Repo verified, Docker detected, no dirty tree |
| Build (--no-cache) | ✅ | 26s; Hockney's 2 commits included; all deps resolved |
| Deploy + healthcheck | ✅ | Container healthy at 35s; 13 scheduled jobs registered |
| Image SHA | ✅ | Changed: `d2e918be8d60` → `50e763bad0a1` |

**Fix Validations:**

1. **Hockney Commit 12aeb4b — Thread-Safe Timeout:**
   - Replaced `signal.SIGALRM` with `ThreadPoolExecutor(...).submit().result(timeout=...)`
   - Worker runs PDF parsing in separate executor thread (not main thread)
   - No "signal only works in main thread" exceptions
   - Test `test_dispatch_pdf_timeout_works_from_worker_thread` confirms fix

2. **Hockney Commit 462afc9 — Volume Mount & Config:**
   - Volume mount `./reports/credit-card:/app/reports/credit-card` confirmed live
   - Subdirectories auto-created with secure 0700 permissions
   - Env vars added to root `.env`: `CREDIT_CARD_INBOX_DIR`, `CREDIT_CARD_INBOX_ENABLED`
   - Smoke test PDF processed cleanly: `scanned=1 completed=1 deduped=0 errored=0`

**Smoke Test Results:**
- PDF: `דף פירוט דיגיטלי כאל 12-25-2.pdf` (90K, Cal format)
- Status: **completed** (no parse errors)
- DB rows: 1 statement ingested, 3 transactions extracted
- File movement: inbox → processed (0700 permissions preserved)

**TODOs:**
1. Update `.copilot/skills/worker-redeploy/SKILL.md` to document env var wiring (future friction prevention)
2. Document backfill operator guidance (monitoring, dedup logic, error handling)
3. Long-term: consolidate optional env vars into `.env.credit-card` file

**Verdict:** 🟢 READY FOR CC-14 BACKFILL. Worker rebuild complete; all fixes validated; no new bugs introduced.

---

### 2026-05-29: CC-11 Rebuild Verification v1 — Pre-existing Code Issue Identified

**By:** Kujan (QA/Integration)

**Earlier rebuild identified:** `signal.SIGALRM` mechanism fails in APScheduler thread pool executor. Error: `RuntimeError: signal only works in main thread of the main interpreter`. Fix implemented in v2 rebuild (above).

---

### 2026-05-29: CC-13 Plan Engine Integration Sketch

**By:** McManus (Data/Finance Dev)

**Status:** SKETCH — deferred sprint. No implementation; describes contract only.

**Purpose:** Define how credit-card expense pipeline feeds into `plan_components.py` as monthly `cash_outflows`.

**Function Signature:**
```python
def compute_expense_cash_outflows(
    household_id: str,
    lookback_months: int = 12,
) -> list[dict]:
    """Aggregate credit-card spend by (month, category_slug).

    Excludes transfers (is_transfer = true).
    Returns: [{ "month": "2026-04", "category_slug": "groceries", "amount_ils": 5234.50, "txn_count": 47 }]
    """
```

**Underlying SQL:** JOIN `credit_card_transactions` → `expense_categories`, filter `is_transfer = false`, group by month + category, order by month DESC + amount DESC.

**Plan Smoothing:** Recommended 3-month trailing average per category (balances recency + seasonality). One-off items (Europa Park ₪7,582, Wizz Air ₪6,387, Ministry of Transport ₪1,770) kept lumpy by default; UI offers optional "Smooth large items" toggle.

**Integration Point:** Called alongside `compute_cash_inflows()` in `build_plan_projection()` to populate the Expenses row in the cash-flow table. Behind feature flag `use_cc_expense_actuals` (default `false` until Jony confirms).

**Double-Counting Risk:** If Jony has manual `monthly_expenses` estimates in plan JSON, adding computed expense actuals would count twice. Mitigation: check plan field before enabling flag; prompt Jony to choose one source of truth.

**Open Questions for Jony / Keaton:**
1. **Installment handling:** Use this-month charge (current column) or full purchase price?
2. **Category granularity:** Category-level outflows or single aggregate?
3. **Projection model:** 3-month trailing mean, median, or linear trend?
4. **Uncategorised transactions:** Exclude `other` category until > 80% resolved to avoid downward bias?

**Next Steps:** Implement after Jony signs off on CC blockers. 5 unit tests needed: aggregation, transfer exclusion, smoothing, lumpy pass-through, household isolation.

---

### 2026-05-29: CC-12 Security Review — Credit-Card Expense Pipeline

**By:** Rabin (Security Engineer)

**Status:** ✅ APPROVED-WITH-CONDITIONS. Implementation may proceed on CC-1 through CC-14 conditional on code-review checklist items below.

**Threat Model:** 3 actors — legitimate user, compromised session, malicious local actor. Top 3 concrete threats mitigated via conditions below.

**Mandatory Conditions (PR Checklists):**

1. **CC-1 (Hockney) — RLS on all 5 new tables:**
   - [ ] `credit_card_statements`: RLS ENABLED, scoped by household_id
   - [ ] `credit_card_transactions`: RLS ENABLED, scoped via statement.household_id
   - [ ] `merchant_category_mappings`: RLS ENABLED, per-household only (no system-wide user writes)
   - [ ] `expense_categories`: RLS ENABLED (permissive SELECT for authenticated)
   - [ ] `expense_inbox`: RLS ENABLED, scoped by household_id

2. **CC-2 (Hockney) — Parser hardening:**
   - [ ] Card-number regex assertion: reject `\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}`
   - [ ] Extracted text size cap: `< 500 KB`
   - [ ] No pdfplumber.open() logging of PDF content
   - [ ] Unit test: confirm no hyperlink following in sample PDFs
   - [ ] `pdfplumber==0.11.9` pinned in pyproject.toml

3. **CC-5 (Hockney) — Worker per-PDF timeout + path safety:**
   - [ ] 30-second timeout per PDF (signal.alarm or concurrent.futures)
   - [ ] `os.path.basename()` on all filenames before filesystem ops
   - [ ] Permissions: `os.chmod(INBOX_DIR, 0o700)` on startup
   - [ ] Processed/error files: 0o600 permissions

4. **CC-6 (Hockney) — API authentication + household scoping:**
   - [ ] All `/api/expenses/*` endpoints require JWT auth
   - [ ] Every SELECT query: `WHERE household_id IN (SELECT household_id FROM household_members WHERE user_id = current_uid())`
   - [ ] `POST /api/expenses/resolve` rate-limited to 10 req/sec per user
   - [ ] No user-write endpoints for merchant_category_mappings
   - [ ] Error responses: NO `merchant_raw` or line content; only `{ error: code, statement_id: ... }`

5. **CC-3 (McManus) — YAML seed, no UI writes:**
   - [ ] All global categories from `apps/backend/config/merchant_categories.yaml` only
   - [ ] No UI endpoint allows category modification
   - [ ] Mapping audit columns: `created_by`, `created_at`, `modified_by`, `modified_at` in schema

6. **CC-7 (Fenster) — Frontend XSS hardening:**
   - [ ] Zero `dangerouslySetInnerHTML` on expenses/resolution page
   - [ ] All merchant/transaction data rendered as escaped React text
   - [ ] Auth check: component wrapped by existing auth context

7. **CC-11 (Kujan) — Docker/worker verification:**
   - [ ] Dockerfile: `USER appuser` (uid 1000)
   - [ ] `chmod 0700 /app/reports/credit-card/{inbox,processed,errors}`
   - [ ] `./scripts/rebuild-worker.sh` runs successfully; post-rebuild tests pass

**Approvals:** Rabin ✅ 2026-05-29 12:22 UTC+3. No blockers; conditions move to PR review.

---

### 2026-05-29: CC-10 Playwright E2E Tests for `/finances/expenses`

**By:** Redfoot (QA Lead)

**Coverage:** 8 spec files, 51 tests total, all pass on Chromium.

| Spec file | Tests | Coverage |
|-----------|-------|----------|
| `01-page-load-tabs.spec.ts` | 5 | Page load, all 4 tabs |
| `02-monthly-overview.spec.ts` | 6 | MonthlySummary table, bar chart, transfers toggle |
| `03-by-category.spec.ts` | 7 | Category drill-down, pagination, month filter |
| `04-unresolved-queue.spec.ts` | 9 | Queue render, resolve POST, auto-resolve, search |
| `05-statements.spec.ts` | 7 | Table columns, warning badge, totals |
| `06-category-picker.spec.ts` | 6 | Hierarchy, Hebrew search, Escape key |
| `07-error-handling.spec.ts` | 5 | 500s on all 3 data endpoints + resolve |
| `08-empty-states.spec.ts` | 5 | Empty states for all major panels |

**Key Technical Decisions:**

1. **Route registration order (reverse priority):** Playwright processes `page.route()` handlers in reverse order (last registered = first matched). Catch-all `**/api/expenses/**` must register FIRST so specific overrides (registered after) take precedence.

2. **Worker-scoped auth:** Changed `auth-cookie.ts` fixture from per-test user creation to `scope: 'worker'`. Reduces auth API calls from 51→4 per run.

3. **`waitForRequest()` for refetch:** For asserting re-fetch on checkbox toggle, `page.waitForRequest()` in `Promise.all` with click is reliable. `networkidle` + flag variables fail (async state update + early networkidle resolution).

4. **`{ exact: true }` for Hebrew text:** `getByText('משלוחים')` matches "מסעדות ומשלוחים" (substring). Always use `{ exact: true }` for Hebrew subcategories to avoid strict-mode violations.

5. **`SUPABASE_E2E_ALLOW_PROD=true` required:** Project ref "zvbwgxdgxwgduhhzdwjj" triggers safety guard in `auth-cookie.ts`. Production E2E requires this env var.

**Deferred / Not Covered:**
- Cross-household isolation (backend unit test only)
- Keyboard navigation beyond Escape
- File upload flow (Upload button in Statements tab)
- Pagination next/prev controls (first-page behavior stubbed)

---

### 2026-05-29: CC-9 Test Scenario Catalogue

**By:** Redfoot (Tester)

**Status:** Anticipatory. Parsers, worker, APIs not yet built. Spec scaffold ready; remove `skip` / `xfail` as each CC item ships.

**Parser Test Scenarios:** 39 tests covering 4 issuers (Cal, PayBox, Max, Isracard) — Hebrew RTL, multi-currency, installments, refunds, corrupt PDFs, empty statements, header drift.

**Categorization Tests:** 10 scenarios covering sector-based resolution, YAML rules, user mappings, transfer exclusion, edge cases (digits-only merchant, punctuation-only, sector mismatch).

**Ingestion / Dedup Tests:** 7 scenarios — duplicate detection by hash, file rename handling, concurrent drops, transient error retry, orphaned row recovery.

**API Tests:** 20+ scenarios for `GET /api/expenses/unresolved`, `POST /api/expenses/resolve`, `GET /api/expenses/monthly-summary`, `GET /api/expenses/by-category`.

**Worker Tests:** 7 scenarios — inbox scan, file movement, error handling, restart resume, idempotency, non-PDF skip, unknown issuer.

**Integration Tests:** 5 full-pipeline scenarios per issuer (round-trip parse + categorize + API surface).

**Regression Scenarios:** 3 — dual migration assertion (Alembic + Supabase both present), amount unit drift (ILS not agorot), currency leak (USD rows contaminate ILS summary).

---

## Summary of Merged Notes

**Hot-Fix Sweep (2026-05-29):**
- Expenses production error: frontend 404 (missing Route Handlers) + backend schema gap (missing Supabase migrations)
- Fixes: 6 Route Handlers (PR #487), `SUPABASE_PROD_DB_URL` fallback (PR #486, #488), Node 22 CI bump + E2E dedup (PR #484)
- Status: ✅ live and verified

**Credit-Card Expense Pipeline Backlog (PRs #480, #483, #484):**
- CC-1 through CC-14 decomposition: schema (Hockney), parsers (Hockney), worker rebuild (Kujan), API endpoints (Hockney), security review (Rabin), E2E tests (Redfoot), category integration (McManus)
- All decisions documented; implementation ready pending Jony's sign-off on open questions
- Backfill complete: 30 PDFs ingested, 407 transactions parsed, 176 auto-resolved via rules
- **Gap:** Category seed missing (McManus owns CC-3); Docker rebuild pending (Kujan owns CC-11 v2)

**Total Merged:** 15 decision notes

---

### 2026-05-30: Transportation Taxonomy Split

**By:** McManus (Frontend Lead)

**What:**

Split Transportation / תחבורה (daily commute and vehicle costs) from Travel (vacations, flights, hotels) as a top-level expense category.

Israeli household budgeting treats commute, fuel, car insurance, maintenance, vehicle registration, and public transport as recurring daily-life costs. Those planning signals are distinct from vacation/travel spend such as flights and hotels.

**Taxonomy Changes:**

- `fuel` → `transportation-fuel` (UUID preserved)
- `travel-transit` → `transportation-public-transit` (UUID preserved)
- Added: `transportation-insurance`, `transportation-maintenance`, `transportation-registration`

The migration updates existing rows instead of deleting/reinserting them, preserving category UUIDs for historical transactions and merchant mappings.

**Why:**

User-stated business rules: commute costs are recurring operational expenses; travel is discretionary spending. Distinct categorization enables household budget forecasting and merchant rule mapping without conflation.

**Deployment:**

PR #489 merged to main as commit `1355ef6` with `[apply-migrations]` tag. Supabase migration applied in 21s.

---

### 2026-05-30: Dynamic Category Fetching for Expense Classification

**By:** Hockney (Backend Lead)

**What:**

CategoryPicker now fetches expense categories dynamically from `/api/expenses/categories` on component mount, replacing hardcoded placeholder UUIDs.

**Problem:**

After PR #489 (Transportation taxonomy split), users saw "שגיאה בשמירת הסיווג" when saving expense classifications. Root cause: CategoryPicker used hardcoded fake UUIDs (`"cat-transportation"`, etc.) from `EXPENSE_CATEGORIES` array in `expenses.ts`, but the backend validated these against real database UUIDs from the `expense_categories` table. The mismatch became critical when PR #489 changed category UUIDs.

**Decision:**

CategoryPicker fetches real UUIDs at runtime with graceful fallback to hardcoded array for offline/test scenarios. No manual sync required when `expense_categories` schema changes.

**Why:**

1. **Schema changes break static data immediately** — fragile and easy to miss.
2. **The endpoint already existed** but was never wired to CategoryPicker (flagged by TODO).
3. **Matches Supabase single-source-of-truth pattern** — database is authoritative; frontend fetches at runtime.

**Pattern for Future Taxonomy Changes:**

1. Write SQL migration and apply to prod.
2. Frontend fetches dynamically (already handled via dynamic fetch).
3. Update hardcoded fallback IF needed for tests/offline.

**Team Impact:**

- **McManus (frontend lead):** No action. CategoryPicker now self-healing for future taxonomy changes.
- **Keaton (test lead):** CategoryPicker tests still pass with hardcoded fallback.
- **Rabin (security):** Reduced attack surface — UUIDs fetched fresh on each session, not bundled.

**Deployment:**

Fix pushed as commits `f270700` + `fedef20` directly to main. Vercel deploy succeeded.

---

### 2026-05-30: Dynamic Migration Discovery for CI Fallback Path

**By:** Kujan (DevOps/Platform)

**Context:** P1 bug — hardcoded migration allowlist in Supabase CI workflow silently skipped new migrations

**Problem**

The `.github/workflows/supabase-migrations.yml` db-url fallback path had a hardcoded array of 2 specific migration filenames:

```bash
expense_migrations=(
  20260529122500_add_credit_card_expense_pipeline.sql
  20260529122501_seed_expense_categories.sql
)
```

The `apply_expense_pipeline_directly()` function only applied migrations in this array. Any new migration added to `supabase/migrations/` was silently skipped, even when the workflow ran with `[apply-migrations]` in the commit message.

**Impact:** McManus's PR #489 added `20260530055800_add_transportation_category.sql`. The workflow ran "successfully" but the Transportation migration was never applied. User was staring at stale taxonomy in prod (35 categories instead of 39).

**Root Cause**

Hardcoded allowlists in CI scripts rot immediately and fail silently. The original implementation was written to apply only the expense pipeline migrations, but the function was never updated to be general-purpose as new migrations were added.

**Decision**

**Replace hardcoded allowlist with dynamic discovery.**

New behavior (`apply_pending_migrations_directly`):
1. List all `*.sql` files in `supabase/migrations/` (sorted by version)
2. Query prod `supabase_migrations.schema_migrations` for applied versions
3. For each local migration whose version is NOT in prod's applied list, apply it via `psql -v ON_ERROR_STOP=1 -f migrations/{file}` and record it via the existing `record_migration` helper
4. After applying, run `verify_expense_tables` to validate baseline schema

**Safety invariants:**
- Idempotent — running twice is safe (the `on conflict (version) do nothing` in `record_migration` already handles this)
- Only applies LOCAL migrations to prod (never removes or alters prod-only history entries)
- Fails LOUD if any psql apply fails (set -euo pipefail already in place)

**Implementation**

- **Commit f63185e:** Replaced `apply_expense_pipeline_directly()` with `apply_pending_migrations_directly()` in `.github/workflows/supabase-migrations.yml`
- **Commit 2f52292:** Fixed `20260512010000_enforce_dividend_yield_decimal.sql` to be idempotent (wrapped constraint creation in IF NOT EXISTS guard to handle prod drift)
- **Workflow run 26679731909:** Successfully applied 5 pending migrations including Transportation. Final verification: `expense_categories rows: 39` ✅

**Why**

- Hardcoded allowlists rot immediately and fail silently. Dynamic discovery (sorted local files vs. prod history) is the only safe pattern for fallback migration paths that need to tolerate prod drift.
- Pattern is now documented in `.squad/agents/kujan/history.md` and should be applied to any future CI scripts that need to apply migrations outside of the Supabase CLI's normal `db push` flow.

---

### 2026-05-30: Housing/Utilities Category Taxonomy

**By:** McManus (Data/Finance Dev)

**Status:** Shipped (commit 4d0e931, workflow run 26685706819)

**Context:** User gap report — "Meniv Rishon is the Water Utility company in Rishon LeZion. I didn't find a category that would fit utility bills related to housing (like water, electricity, home insurance etc)."

**Problem**

The existing "Utilities & Communications" category covers **telecom and streaming** (internet, mobile, HBO Max, HOT cable). There was no category for **housing-related utility bills**:
- Water utilities (Meniv Rishon, Hagihon, Mei Avivim, etc.)
- Electricity (Israel Electric Corporation / IEC)
- Cooking gas (Pazgas, Supergas, Amisragas)
- Home insurance (ביטוח דירה)
- Property tax / Arnona (ארנונה)
- Building HOA / Va'ad Bayit (ועד בית)
- Home maintenance / repairs

These are distinct spending categories with different budgeting needs than telecom.

**Decision**

Created a **new top-level "Housing" category** (slug: `housing`, Hebrew: דיור, color: #795548, icon: home) with **7 subcategories**:

1. **housing-water** (מים) — Water utilities
   - Meniv Rishon (Rishon LeZion)
   - Hagihon (Jerusalem)
   - Mei Avivim (Tel Aviv)
   - Mey Galim (Haifa)
   - Pelagei Sharon (Sharon region)

2. **housing-electricity** (חשמל) — Electricity
   - Israel Electric Corporation (IEC / חברת החשמל)

3. **housing-gas** (גז) — Cooking gas
   - Pazgas, Supergas, Amisragas

4. **housing-home-insurance** (ביטוח דירה) — Home insurance
   - Context-dependent: major providers (Harel, Migdal, Phoenix, Clal, Menorah) when descriptor includes "דירה" (dwelling)

5. **housing-property-tax** (ארנונה) — Property tax
   - Arnona (municipal tax billed by the Iriya)

6. **housing-hoa** (ועד בית) — Building HOA
   - Va'ad Bayit (building committee / HOA fees)

7. **housing-home-maintenance** (תחזוקת הבית) — Home repairs
   - Plumber, electrician, handyman, repairs

**Rationale**

### Why separate from Utilities & Communications?

- **Different budgeting contexts:** Housing utilities are recurring fixed costs tied to dwelling ownership/rental. Telecom/streaming are discretionary subscriptions.
- **Different financial planning:** Property tax and home insurance are annual lump sums. Water/electricity/gas are monthly variable costs.
- **User mental model:** People think of "utilities" as telecom + internet, not water/electricity (confirmed by user feedback).

### Why these subcategories?

- **Water/Electricity/Gas:** The three classic housing utilities. Distinct vendors, distinct billing cycles, distinct usage patterns.
- **Home insurance:** Legally required for mortgaged properties. Distinct from vehicle/life insurance.
- **Property tax (Arnona):** Israel-specific municipal tax. Very high weight (0.98) due to unique keyword.
- **HOA (Va'ad Bayit):** Israel-specific building committee fees. Common in apartment buildings.
- **Home maintenance:** Captures plumber, electrician, handyman, repair costs. Distinct from insurance/tax.

**Display order:** Housing given `display_order: 12` (between Transfers=10 and Other=99). Leaves room for future top-level categories.

**Merchant Patterns**

### High-confidence patterns (weight 0.95+)

- **Water:** `meniv\s*rishon|בינמ.*ןושאר` (Meniv Rishon), `hagihon|ןוחיגה` (Hagihon), `mei\s*avivim` (Mei Avivim)
- **Electricity:** `\biec\b|למשחה\s*תרבח|israel\s*electric` (IEC)
- **Gas:** `pazgas|supergas|amisragas` (gas providers)
- **Property tax:** `arnona|הנורא` (arnona keyword, weight 0.98)
- **HOA:** `va'?ad\s*ba?yit|תיב\s*דעו` (va'ad bayit)

### Context-dependent patterns (weight 0.8-0.9)

- **Home insurance:** `(harel|migdal|phoenix|clal|menorah).*הריד` (provider + dwelling context)
- **Home maintenance:** `(plumb|electrician|handyman|םינוקית|היצלטסניא)` (repair professionals)

**Sector Mappings**

Added to `categorize.py`:

```python
"רוייד": "housing",  # reversed דיור (housing)
"ינוריע": ("housing", "housing-property-tax"),  # reversed עירוני (municipal)
```

The `ינוריע` (municipal) sector directly maps to the subcategory (two-tier tuple), following the Transportation pattern.

**Migration**

**File:** `supabase/migrations/20260530165734_add_housing_category.sql`

**Idempotency:**
- `INSERT ... ON CONFLICT (slug) DO NOTHING` for new categories
- `UPDATE ... WHERE slug = 'housing'` for metadata refresh
- Safe to re-run

**No reparenting:**
- All 8 rows (1 parent + 7 subs) are new entities.
- No existing categories moved under Housing.

**Result:**
- `expense_categories` row count: 47 (was 39, added 8)
- Workflow run 26685706819 succeeded in 13s

**Alternatives Considered**

1. **Merge into existing "Utilities & Communications"** — Rejected. Users think of "utilities" as telecom/internet, not water/electricity.
2. **Make "Utilities" a parent with "Telecom" and "Housing" as children** — Rejected. Over-nesting. Two-level hierarchy is sufficient.
3. **Add "Housing" subcategory under "Financial & Insurance"** — Rejected. Home insurance is only one of seven housing costs.
4. **Create separate top-level categories for Water, Electricity, Gas** — Rejected. Too granular.

**Open Questions**

### Should Internet/Mobile move to Housing?

**Current state:** Internet and Mobile are under "Utilities & Communications".

**Decision:** Keep current split. If user feedback shows confusion, revisit in 3 months.

### Should Home Insurance move to a top-level "Insurance" category?

**Current state:** Home insurance is under Housing. Vehicle insurance is under Transportation. Life/health insurance is under Financial.

**Decision:** Keep insurance split by context. Insurance subcategory follows the context of the insured item.

**Impact**

- **User workflow:** "Meniv Rishon" water bill now auto-categorizes to Housing > Water (was previously falling into "Other" or manual resolution).
- **Plan engine (CC-13):** Housing category excluded from is_transfer filter. Full spending included in household expense projections.
- **Frontend CategoryPicker:** Dynamic fetching from `/api/expenses/categories` means no code change needed (Hockney's 2026-05-30 fix).

**Follow-up Work**

- [ ] **User validation:** Confirm Meniv Rishon charges now auto-categorize after next statement upload.
- [ ] **Israel Electric Corporation:** Verify IEC charges match the patterns.
- [ ] **Arnona patterns:** If municipal invoices have English "municipal tax" in merchant field, add fallback pattern.
- [ ] **Home maintenance edge cases:** Plumber/electrician patterns may collide with construction/renovation. Monitor resolution queue for false positives.
- [ ] **Chart color collision:** Housing (#795548) uses same brown as Financial (#795548). Verify intentional or pick distinct color (e.g., #8D6E63).

**Commit & Workflow**

- **Commit:** `4d0e931`
- **Workflow run:** `26685706819`
- **Push timestamp:** 2026-05-30T14:00:45Z
- **Migration applied:** 2026-05-30T14:00:56Z
- **Final expense_categories count:** 47

## Next.js 16.2.6 → 16.2.7 Patch Bump & PostCSS Override

### 2026-06-04: Next.js 16.2.6 → 16.2.7 Upgrade

**Date:** 2026-06-04T10:51:29.757+03:00
**Author:** Keaton (Lead)
**Status:** Approved — routine patch, low risk

#### Context

Jony received an alert claiming "Outdated Next.js v16.2.6 instance detected. Please update your Next.js copy to keep your device secure." Coordinator pre-flight verified the underlying drift is real (16.2.6 installed, 16.2.7 is npm latest). Alert framing was flagged as phishing-flavored.

#### What Changed in 16.2.7

All changes are backported bugfixes — no new APIs, no deprecations, no behavior changes outside the affected code paths:

| # | Fix | Relevant to this repo? |
|---|-----|------------------------|
| 1 | Documentation fixes | No |
| 2 | Patch playwright-core `_finishedPromise` on `requestFailed` | No (test harness only) |
| 3 | Fix dev-mode hydration failure from HTTP cache | Yes (dev experience) |
| 4 | Fix `router.query` corruption with `basePath` + `rewrites` | No (no basePath/rewrites) |
| 5 | Encode non-ASCII chars in cache tags | Low (Hebrew content but no custom cache tags) |
| 6 | **Fix server action forwarding loop with middleware rewrites** | **Yes** — middleware.ts + server actions |
| 7 | **Turbopack: base40 → base38 hash encoding** | **Yes** — app uses `next dev --turbopack` |
| 8 | CI: disable node 24 TS tests on 16.2 branch | No |
| 9 | Fix `type: module` in standalone/adapters | No |
| 10 | Propagate adapter preferred regions | No |
| 11 | **Don't drop FormData entries** | **Yes** — server actions may use FormData |
| 12 | **Turbopack: LocalPathOrProjectPath PostCSS config resolution** | **Yes** — `postcss.config.mjs` present |

#### Security Assessment

**Not a security patch.** No CVEs cited, no security advisories referenced, no GHSA entries. The "keep your device secure" message in the alert is misleading language consistent with phishing-flavor marketing or generic update nudges. The version drift is real and the patch is worth applying, but on routine maintenance grounds, not security urgency.

#### Compatibility Verdict

All dependency surfaces checked — no compatibility issues:

- `react ^19.2.6` — peer deps allow `^19.0.0` ✅
- `eslint-config-next@16.2.7` — exists on npm, peer deps: `eslint >=9.0.0` (app has `^9`) ✅
- `@supabase/ssr ^0.10.3` — no Next.js internal API dependency ✅
- `lightweight-charts ^5.2.0`, `html2pdf.js ^0.14.0` — no Next.js dependency ✅
- `next.config.ts` — minimal config (images + ignoreBuildErrors), no changed features ✅
- `middleware.ts` — standard Supabase SSR pattern; server action fix (#93919) is a net improvement ✅
- Node.js engines: 16.2.7 requires `>=20.9.0`; project requires `>=22` ✅

#### Decision

**Approve and execute the bump.** Risk classification: **LOW**.

#### Upgrade Path (for Fenster)

Package.json changes:
```json
// apps/frontend/package.json
"next": "^16.2.7"         // was ^16.2.6
"eslint-config-next": "^16.2.7"   // was ^16.2.6
```

Install: `cd apps/frontend && npm install`

Validation: lint, tests, build, dev smoke test, verify lock updated.

---

### 2026-06-04: Treat Unsolicited Dependency Alerts as Phishing-by-Default

**Author:** Rabin (Security Engineer)
**Date:** 2026-06-04T10:51:29.757+03:00
**Status:** Proposed — for Scribe merge

#### Context

On 2026-06-04, Jony received the message: "Outdated Next.js v16.2.6 detected. Please update your Next.js copy to keep your device secure." This message contains social-engineering indicators but coincidentally points at a real version drift (16.2.6 → 16.2.7).

#### Decision

Any unsolicited message (email, chat, browser notification, external tool) stating that a dependency needs updating is **treated as phishing-by-default** until verified through at least one authoritative channel.

Do not click links in the alert; independently verify through `npm audit`, GitHub GHSA, or Dependabot.

**Authoritative channels:**
- GitHub Security Advisories: `https://github.com/vercel/next.js/security/advisories`
- npm audit: `npm audit --json` in project root
- GitHub Dependabot alerts: Repository → Security → Dependabot alerts
- CVE/NVD: `https://nvd.nist.gov/`

A real advisory **always** includes: GHSA ID or CVE ID, severity rating, specific affected version range, and a link to the fix.

**Response Protocol:**
1. Log the message (screenshot or paste)
2. Run `npm audit` independently in the affected project
3. Cross-reference GHSA for the specific package
4. If real finding exists: bump per standard upgrade procedure
5. If no finding exists: discard the message

**Standard Next.js Upgrade:** When upgrading next in this project, also check if bundled dependencies (e.g., postcss) require an npm `overrides` entry to clear audit findings.

Example (for postcss GHSA-qx2v-qp2m-jg93):
```json
"overrides": {
  "postcss": "^8.5.10"
}
```

---

### 2026-06-04: middleware.ts Proxy Migration Should Be Scheduled

**Date:** 2026-06-04T10:51:29.757+03:00
**Author:** Fenster
**Status:** Proposed — for Coordinator + Keaton review

#### Context

During the Next.js 16.2.6 → 16.2.7 patch bump, the build output emitted a deprecation warning:

```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
```

The existing `middleware.ts` already contains a `// TODO: migrate to proxy for Next 17` comment. The warning now fires at **build time** (not just in release notes), which creates noise that may obscure future genuine build warnings.

#### Decision

**Schedule the `middleware.ts` → `proxy.ts` migration as a dedicated work item before Next.js 17 lands.** This is a Fenster task (pure frontend file, standard Supabase SSR pattern migration).

Suggested sprint: next available cleanup sprint before Next.js 17 release.

No urgency — not a security issue, not a runtime error, not a breaking change in 16.x.

#### Secondary Observation

The frontend currently has **39 lint errors** in existing files (e2e fixtures, `TradingAccountSettings.tsx`, `database.ts`). These are not caused by any recent changes but exist as technical debt. Any future patch bump that triggers lint checking will see these and need to distinguish them from new regressions.

**Proposed:** Add a lint-baseline check to the pre-bump workflow — `npm run lint 2>&1 | tail -3` before the bump, compare after.

---

### 2026-06-04: Add npm audit diff step to dependency bump PRs in CI

**Date:** 2026-06-04T10:51:29.757+03:00
**Author:** Fenster (Frontend Dev)
**Status:** Proposed — for Coordinator review

#### Context

During the `squad/deps-next-16-2-7` sprint, the Next.js 16.2.6 → 16.2.7 patch bump was committed as `d87a0ac`. At the time, the commit was correctly validated (build ✅, tests ✅, lint ✅). However, Rabin's subsequent security triage revealed that `next@16.2.7` still bundled `postcss@8.4.31` inside its own `node_modules/next/node_modules/postcss/` subtree — a transitive CVE (GHSA-qx2v-qp2m-jg93) that the parent bump did not clear.

This was only caught because Rabin ran a manual check. It was NOT visible in the commit diff, build output, or test results.

#### The Gap

Our current patch-bump workflow validates:
- Lint (pass/fail)
- Tests (pass/fail)
- Build (pass/fail)

It does **not** validate:
- npm audit before/after the bump
- Whether transitive CVEs were introduced or persisted through the bump

Vulnerabilities that live in vendored subtrees of a dependency are invisible to the standard validation suite.

#### Proposed Decision

In CI, on any PR that modifies `apps/frontend/package.json` or `apps/frontend/package-lock.json`:

1. **Capture pre-merge npm audit count** from the base branch.
2. **Capture post-merge npm audit count** from the PR branch.
3. **Fail the CI check if the post count is HIGHER than pre** (new vulnerabilities introduced).
4. **Surface the diff as a PR comment** (even if not blocking).

**Implementation notes:**
- Simple approach: `npm audit --json | jq '.metadata.vulnerabilities | .total'` before and after. Compare. Fail if delta > 0.
- More precise: diff the `advisories` object by GHSA ID to surface exactly which vulns changed.
- Step should run AFTER `npm install` and BEFORE the build step.

**Urgency:** Low — the postcss CVE was caught manually and cleared in a follow-up commit. No production exposure. But the gap is real and will recur on the next dep bump.

---

### 2026-06-04: Reviewer Gate Verdict — squad/deps-next-16-2-7 APPROVED

**Author:** Redfoot (Tester)
**Date:** 2026-06-04T10:51:29.757+03:00
**Branch:** `squad/deps-next-16-2-7`
**Verdict:** ✅ **APPROVED — ready to push and PR**

#### Summary

The Next.js 16.2.6 → 16.2.7 patch bump (+ postcss override) produced by Fenster has been independently verified. All 13 checklist gates pass. No regressions. No new warnings beyond pre-flagged middleware deprecation. GHSA-qx2v-qp2m-jg93 is cleared.

#### Evidence

**Branch & Commit Reality:**
- Branch: `squad/deps-next-16-2-7` ✅
- Commits ahead of main: 2 (exactly) ✅
- Commit 1: `chore(frontend): bump next & eslint-config-next to 16.2.7` ✅
- Commit 2: `chore(frontend): override postcss to ^8.5.10 (GHSA-qx2v-qp2m-jg93)` ✅
- Files changed: `apps/frontend/package.json`, `apps/frontend/package-lock.json` — **nothing else** ✅

**Installed Dependency State:**
- next@16.2.7 ✅
- eslint-config-next@16.2.7 ✅
- postcss resolution: all instances 8.5.15 (≥8.5.10, override working) ✅

**npm Audit:**
- Total vulnerabilities: 5
- Critical: 0
- High: 3
- Moderate: 2
- Low: 0
- GHSA-qx2v-qp2m-jg93 present: **No** ✅

**Cold Build Verification:**
- Cache cleared before build ✅
- Build result: exit 0 ✅
- Compile time: 3.7s ✅
- Static routes: 23, Dynamic routes: 13 (36 total)

**Build Warnings:**
```
⚠ The "middleware" file convention is deprecated. (expected)
NODE_TLS_REJECT_UNAUTHORIZED env var warning (pre-existing)
```

No new warnings. ✅

**Test Verification:**
```
Test Files: 65 passed, 3 failed (68 total)
Tests:      789 passed, 9 failed (798 total)
```

Exact match with Fenster's baseline ✅. All failed tests pre-existing.

**Dev Server Smoke Test:**
- Turbopack started cleanly ✅
- Ready in 317ms ✅
- Middleware loaded (deprecation warning only) ✅
- No stack traces ✅

**Regression Risk: 4 App-Relevant 16.2.7 Fixes:**

| Fix | Coverage in test suite | Risk |
|---|---|---|
| #3 Dev-mode hydration (HTTP cache) | No automated test — dev experience only | Low — not reproducible in Vitest |
| #6 Server action forwarding loop with middleware | `middleware.test.ts` logic test only; no integration test | **Test gap** — flagged as recommendation |
| #11 FormData entries not dropped | `CSVImportButton.test.tsx` asserts `expect.any(FormData)` passed; covers call site but not internal preservation | **Partial coverage** — flagged as recommendation |
| #12 Turbopack PostCSS config resolution | Implicitly covered via build exercising Tailwind → postcss → CSS pipeline | Implicitly covered via build ✅ |

**Test-gap recommendations (non-blocking):**
1. Add an integration test: server action through middleware round-trip (guards fix #6)
2. Add E2E test: FormData preservation through server action (guards fix #11)

**Decision-Trail Audit:**
- Keaton: bump next + eslint-config-next to ^16.2.7 — exactly implemented ✅
- Rabin: check bundled deps (postcss) for overrides — override applied ✅
- Fenster: middleware deprecation TODO exists — warning observed, matches flagged issue ✅
- All SKILL.md guardrails followed ✅
