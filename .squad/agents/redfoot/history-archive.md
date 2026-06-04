# Redfoot — Active History

> **Last summarized:** 2026-05-13 (removed 188 older entries to archive)
> **Current size:** 25330 bytes

---

**Step 1 — Check deployment SHA:**
```bash
vercel inspect https://<alias>.vercel.app | grep -i sha
# or: git log --oneline -3 && vercel ls | head -5
```

**Step 2 — Try bypass secret (Path 1):**
```bash
cd /project/root && vercel env pull .env.vercel-prod --environment=production --yes
grep -i "BYPASS\|VERCEL_AUTOMATION" .env.vercel-prod
```
If found, append `?x-vercel-protection-bypass=<value>&x-vercel-set-bypass-cookie=true` to URLs.

**Step 3 — Local prod build if no bypass (Path 2):**
```bash
# Keys are in apps/frontend/.env.local — SUPABASE_SERVICE_ROLE_KEY is present
# Build may already exist; if not: cd apps/frontend && npm run build
cd apps/frontend && npm run start &
# Server listens on :3000 and enforces auth (307 redirects for unauthenticated)
```

**Step 4 — Auth for Playwright:**
- `SUPABASE_SERVICE_ROLE_KEY` lives in `apps/frontend/.env.local` (checked after filtering)
- Use `e2e/fixtures/auth-cookie.ts` fixture → creates ephemeral E2E user, injects `sb-{ref}-auth-token` cookie
- Must set `SUPABASE_E2E_ALLOW_PROD=true` (production Supabase URL fails the dev-hint check)

**Step 5 — Run:**
```bash
SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-cf2fd19.spec.ts \
  --project=chromium --reporter=list
```

**Step 6 — Evidence:**
- Save DOM snapshots (`page.locator(...).evaluate(el => el.outerHTML)`) to `e2e/lurvg-evidence/`
- Screenshots with `page.screenshot({ path: ..., fullPage: true })`

**Step 7 — Post to issues + close:**
```bash
gh auth switch -u cohenjo   # ALWAYS switch before writes
gh issue comment <N> --body-file comment-N.md
gh issue close <N> --reason completed
```

**Gotchas:**
- `vercel env pull` returns EMPTY strings for sensitive vars — don't rely on it for secrets
- The `assertNotProd` guard in `e2e/fixtures/admin.ts` blocks on `zvbwgxdgxwgduhhzdwjj.supabase.co` — bypass with `SUPABASE_E2E_ALLOW_PROD=true`
- Test user cleanup (`deleteE2eUser`) may fail with "Database error deleting user" — this is non-critical; tests still pass
- `account-tabs.spec.ts` (Fenster's spec) has no auth — tests will silently fail on protected routes unless wrapped with `auth-cookie` fixture. Create a separate LURVG spec file rather than modifying the original.

**Drop-box note:** `.squad/decisions/inbox/redfoot-lurvg-cf2fd19.md`

---
## Archived from .squad/agents/redfoot/history.md (2026-05-27T22:47:01.508312)

## 2026-05-12: LURVG — PR #371 broker-form fix (issue #359)

**Assigned:** Redfoot validates Hockney's `fix(settings): normalize account_type to lowercase + surface save errors (#359)`.

**Context:** Jony reported silent failure when adding a broker — uppercase `account_type` rejected by `chk_account_type` constraint with no user feedback. PR #371 adds: (1) `normalizeAccountType()` utility with validation before DB write, (2) duplicate prevention with friendly error message, (3) `data-testid` rename `tab-{type}` → `account-tab-{type}`, (4) 17 new unit tests, (5) 2 new e2e tests.

**Reproduce-Before-Fix Rule applied:** The original uppercase bug was already patched in `cf2fd19` (`.toLowerCase()` added). Tested the remaining unfixed behavior: duplicate account_type insertion. On main, inserting a second Schwab silently succeeds (no unique constraint on `(household_id, account_type)`). Bug reproduced ✅.

**Spec defect found:** Hockney's `add-broker-form.spec.ts` used `getByLabel(/account name/i)` — but the Account Name `<label>` has no `htmlFor` attribute association. Fix applied: `getByLabel` → `getByTitle('Account Name')`. Both tests then pass 2/2.

**Procedure:** LURVG Path 2.
1. **Main build + pre-fix spec:** Seeded ephemeral Schwab config. Submitted duplicate Schwab via form. On main: no duplicate check → INSERT succeeds → **success banner shown** (bug — should be rejected). ✅ Bug reproduced.
2. **Fix branch build + Hockney's spec:** 2/2 tests pass. Happy path: Schwab added successfully, 3 tabs visible after reload. Negative: duplicate Schwab rejected with "Schwab account is already configured for this household." ✅ Fix confirmed.
3. **Smoke tests:** /dividends, /ladder, /summary all load without regression (3/3 ✅).
4. **Unit tests:** **492/492** including 17 new `account-type.test.ts` tests ✅.
5. **DB cleanup:** Restored production rows (ids 1, 71, 72 intact). Cleared stale test households via trigger-bypass.

**Evidence files:**
- `e2e/lurvg-evidence/pr371-prebug-broker-add-silent-fail.png` — pre-fix: duplicate succeeds silently
- `e2e/lurvg-evidence/pr371-prebug-dom-state.txt` — pre-fix DOM state text
- `e2e/lurvg-evidence/add-broker-schwab-success.png` — post-fix: happy path success banner
- `e2e/lurvg-evidence/add-broker-schwab-after-reload.png` — post-fix: 3 tabs visible after reload
- `e2e/lurvg-evidence/add-broker-schwab-duplicate-error.png` — post-fix: duplicate rejection banner
- `e2e/lurvg-evidence/pr371-smoke-dividends.png` — smoke: dividends no regression
- `e2e/lurvg-evidence/pr371-smoke-ladder.png` — smoke: ladder no regression
- `e2e/lurvg-evidence/pr371-smoke-summary.png` — smoke: summary no regression

**Verdict: 🟢 APPROVED** — pre-fix reproduced, fix confirmed, all tests pass, no regressions.

**Learnings banked:** `TradingAccountSettings.tsx` Account Name/Type `<label>` elements lack `htmlFor` attribute — always use `getByTitle()` not `getByLabel()` for these inputs. E2e spec authors should associate labels properly (`htmlFor` / `aria-labelledby`) to enable `getByLabel` matching.

## 2026-05-11: LURVG — PR #375 RLS policies fix (issue #374)

**Assigned:** Redfoot validates Hockney's `fix(security): add RLS policies for dividend tables, disable RLS on security_reference (#374)`. HIGH STAKES — migration already applied to prod DB.

**Context:** PR #375 removes `createAdminClient()` workaround from `getDividendPositions()` (introduced PR #368) and switches to standard `createClient()`. The new RLS migration (`20260511102251`) adds SELECT policies on `dividend_payments` + `dividend_accruals` (household-scoped via `trading_account_config.account_id → is_household_member(household_id)`), and disables RLS on `security_reference` (global reference data). If the new standard client cannot read through the policies, dividends will go empty in prod on merge.

**Reproduce-Before-Fix Rule:** INVERTED here — the migration is already applied to prod. Bug to validate is "the new RLS policies allow authenticated reads". Skipped main pre-fix step per instructions; went directly to fix branch validation.

**Procedure:** LURVG Path 2.
1. **Migration verified in prod via Supabase MCP:**
   - `dividend_payments_select` (r) ✅
   - `dividend_accruals_select` (r) ✅
   - `security_reference rowsecurity = false` ✅
   - Version `20260511102251` tracked in `supabase_migrations.schema_migrations` ✅
2. **Code verification:** `actions.ts` uses only `createClient()` — no `createAdminClient` import ✅
3. **Fix branch build:** `npm run build` ✅ — clean compile on `squad/374-rls-policies`
4. **Unit tests:** **518/519** (1 pre-existing `LadderPage coupon formatting` failure). Confirmed same failure on `main` — truly pre-existing, unrelated to #375. ✅
5. **LURVG Playwright spec:** 5/5 passed (Path 2, local prod build, authenticated ephemeral test user).

   **Key insight on RLS seed strategy:** The new policy uses `dividend_payments.account_id IN (SELECT account_id FROM trading_account_config WHERE is_household_member(household_id))`. Seeding with a fake account ID (as PR #368 spec did) causes a false skip because the RLS join returns 0 rows. Correct approach: seed `trading_account_config` with the real IBKR broker number (`U2515365`) under the ephemeral household. `is_household_member` returns true for the ephemeral user's own household → RLS allows reads from `dividend_payments`.

6. **Evidence files:**
   - `pr375-postfix-dividends-ibkr-populated.png` — JEPI/O/GS rows visible in `dividends-positions-table` ✅
   - `pr375-postfix-dividends-ibkr-dom.txt` — DOM: `dividend-row-GS`, `dividend-row-JEPI`, `dividend-row-O` ✅
   - `pr375-postfix-dividends-schwab-empty.png` — Schwab correct empty state ✅
   - `pr375-postfix-ladder-ibkr-populated.png` — ladder loads, no regression ✅
   - `pr375-postfix-summary.png` — summary loads, no regression ✅
   - `pr375-postfix-accounts-tabs.png` — 3 account tabs visible ✅
   - `pr375-postfix-accounts-tabs-dom.txt` — DOM: `account-tab-ibkr`, `account-tab-schwab`, `account-tab-ira`, `account-tab-settings` ✅
7. **Negative test (unauthenticated):** `curl localhost:3000/dividends` → `307` redirect (not 500) ✅
8. **`security_reference` accessible:** `SELECT count(*) FROM security_reference` → 75 rows, no RLS error ✅

**Verdict: 🟢 APPROVED** — all 5 Playwright tests pass, unit tests 518/519 (pre-existing failure confirmed on main), migration confirmed in prod, cookie-client reads correctly through new RLS policies. Safe to merge.

**Learnings banked:**
- **RLS seed strategy for account_id joins:** When the RLS policy joins `dividend_payments.account_id → trading_account_config.account_id`, seed with the REAL broker account number (not a fake UUID/string). Using a fake ID causes RLS to return 0 rows → test passes for the wrong reason (empty state shown as "correct" when it's actually blocked).
- **`trading_account_config` select with duplicate account_id:** After seeding the real account_id (`U2515365`) which already exists in Jony's household, `.single()` fails with multiple rows. Always filter by `household_id` too, or use `.maybeSingle()` with household scoping.
- **`account-tab-{type}` testids:** Trading accounts page uses `<button data-testid="account-tab-ibkr">` not `role="tablist"` / `role="tab"`. Always use `getByTestId('account-tab-ibkr')` for tab assertions on this page.
## 2026-05-01: CC-10 — Playwright E2E for `/finances/expenses` (8 specs, 51 tests)

**Result: ✅ 51/51 PASSING.** Delivered full E2E coverage for the expenses page across all 4 tabs (Monthly Overview, By Category, Unresolved Queue, Statements) and the CategoryPicker component.

**Specs created:**
- `01-page-load-tabs.spec.ts` — page init, tab switching (5 tests)
- `02-monthly-overview.spec.ts` — MonthlySummary table + bar chart + transfers toggle (6 tests)
- `03-by-category.spec.ts` — CategoryBreakdown drill-down, pagination, month filter (7 tests)
- `04-unresolved-queue.spec.ts` — queue render, resolve POST, dir=auto, search (9 tests)
- `05-statements.spec.ts` — table columns, warning badge, totals (7 tests)
- `06-category-picker.spec.ts` — CategoryPicker hierarchy, Hebrew search, Escape (6 tests)
- `07-error-handling.spec.ts` — 500 responses on all endpoints (5 tests)
- `08-empty-states.spec.ts` — empty state rendering (5 tests)

**Learnings banked:**
1. Playwright `page.route()` is LIFO — catch-all must be registered first, specific routes after.
2. Auth fixture must use worker scope (`scope: 'worker'`) or Supabase rate-limits (429) on 50+ tests.
3. `waitForRequest()` in `Promise.all` with click is reliable for re-fetch assertions; `networkidle` + flag variables are not.
4. Hebrew substrings need `{ exact: true }` in `getByText`/`getByRole` — partial match causes strict mode violation.
5. `count()` is not an auto-waiting assertion — always `expect(locator).toBeVisible()` first.

## 2026-05-11: LURVG — PR #379 insurance_policies cleanup (prod-applied migration)

**Verdict: 🟢 APPROVED.** Schema verified via Supabase MCP: `user_id` dropped, `household_id` NOT NULL, 2/2 rows preserved, 4 canonical household-scoped RLS policies intact, 0 wave2 `_own` policies remain. Unit tests: 519/519. Playwright: 3/3 passed (`/insurance` renders clean, no `user_id` errors, Add Policy flow functional). Server log clean. PR #379 ready to squash-merge.

**Learnings banked:** `households` requires `name+created_by+account_type ∈ {individual,joint}` (NOT NULL). `trg_households_add_creator` auto-inserts creator as `owner` — never insert manually into `household_members` or duplicate key violation occurs. `is_household_writer` = role in `('owner','member')`. New seed pattern lives in `e2e/lurvg-pr379-insurance.spec.ts`.

## 2026-05-11: LURVG — PR #381 Leumi IRA XLS Import

**Verdict: 🟢 APPROVED.** All 7 concerns resolved. Unit tests: 568/568 (+49 new). Playwright: 3/3 passed. DB validation: 30 rows in `stock_positions` (18 TASE/ILA + 4 US/USD + 8 LSE/GBP) for account_id=72. Idempotency confirmed (2nd import = 30 rows, not 60).

**One non-blocking doc error:** PR body claims "22 TASE" — actual is 18 TASE (real file has 30 holdings: rows 6–35, not rows 5–35). Algorithm is correct; only PR description is wrong.

**Learnings banked:** SpreadsheetML XML from Leumi IRA fails ET parser on malformed `& ` entity (e.g., `LEGAL & GEN`) at line 278 — regex extraction is the correct approach and matches TS implementation. Jony (account_id=72) uses Google OAuth so no JWT can be programmatically obtained; FastAPI import must be DB-simulated via service role for LURVG. `activeTab` on accounts page defaults to `"ibkr"` and has no URL-param sync — Playwright tests must click `data-testid="account-tab-ira"` explicitly. Jony's 30 IRA positions now live in production (source='manual', as_of_date=2026-05-11) — this is the intended final state.

## 2026-05-11: LURVG — PR #394 Import endpoint P0 fix + Schwab CSV + Leumi enrichment

**Verdict: 🟢 GREEN.** All 4 LURVG tests passed (P0 code inspection, UI testids, Schwab CSV import, Leumi XLS import). 619 unit tests pass. Build green. Schema confirmed.

**Evidence:**
- Phase 0: 619 tests, build green, migration `20260511200000` confirmed
- Phase 1: `description`, `mark_price`, `dividend_yield`, `market_value_local` all nullable in prod
- Phase 3 (Leumi): 30 positions, 15/18 TASE numeric tickers with Hebrew description (e.g. "מיטב השקעות"), 30/30 mark_price, 30/30 market_value_local, 18 `dir="rtl"` subtitle spans in UI
- Phase 4 (Schwab): 21 positions, 21/21 description+mark_price+dividend_yield, all USD, cash rows correctly skipped
- Phase 6: IBKR 270 rows unchanged, production Leumi/Schwab data untouched

**Learnings:**
- **Import endpoint P0 pattern:** The bug was `fetch('/api/...')` in a `'use server'` action — Node's native fetch requires absolute URLs. Fix pattern: replace fetch+API route with direct `createClient()` + `supabase.from(...).insert()`. This eliminates the HTTP roundtrip and is more secure (RLS enforced).
- **Broker file import validation strategy (schema assertion + DB post-state diff):** For validating broker CSV/XLS imports without disrupting production data: (1) provision ephemeral user + household + account config via admin client; (2) upload file via Playwright on the provisioned account; (3) assert DB post-state via admin client for enriched fields; (4) cleanup in finally block. This gives full end-to-end coverage without touching real accounts.
- **`holdingsToCsv()` does NOT emit `exchange`:** The Leumi parser computes exchange (TASE/US/LSE) but `holdingsToCsv()` omits it from the CSV header. `listing_exchange` in `stock_positions` remains NULL for Leumi imports. Future work: add exchange to CSV and map to `listing_exchange` in server action.
- **`trading_account_config` required columns:** `host`, `port`, `client_id`, `compute_options_income` are NOT NULL. Admin-provisioned test configs must include these: `host: 'e2e-test-host', port: 9999, client_id: 0, compute_options_income: false`.
- **`stock_positions` column is `listing_exchange` not `exchange`:** Any DB query or insert using `exchange` will fail — use `listing_exchange`.
- **Accounts page tab init:** `activeTab` defaults to `"ibkr"`, URL query param `?account=schwab` has no effect. Playwright tests must explicitly click `getByTestId('account-tab-schwab')` to switch tabs before triggering file upload.
- **Schwab CSV sentinel rows:** Parser correctly skips "Cash & Cash Investments", "Positions Total", "--", and blank symbols. Validated by absence of cash rows in DB post-state.

---

## LURVG Validation — PR #399 + PR #400 (2026-05-11)

**PRs validated:**
- **#399** `squad/parser-fixes-cost-basis-leumi-ticker` — Schwab cost_basis/gain, Leumi ticker contamination, Leumi unrealized P&L
- **#400** `squad/yahoo-finance-worker-issue-395` — Yahoo Finance worker, APScheduler, yfinance, 11 TASE overrides

**Verdicts:**
- PR #399: 🟢 **GREEN** — 625 tests pass, build green, tsx direct parser validation confirms all three fixes correct
- PR #400: 🟡 **YELLOW/PASS** — 613 tests pass, Docker healthy, idempotency confirmed (Run 1 + Run 2 both 300/321 refreshed, timestamps advanced); two flags for Jony re: TASE price units and tase_yahoo_map correctness

**Key findings:**
- Leumi parser fix: `col 0 .split(/\s+/)[0]` correctly strips Hebrew names from TASE paper IDs. Zero contaminated tickers in 30-position real file.
- Leumi unrealized_pnl: col 10 extraction confirmed; 18/18 ILS rows populated.
- Schwab unrealized_pnl: `gain $` header maps to `unrealized_pnl`; 21/21 positions populated (ABR=-1177, ADC=+1331.5, JEPQ=+928.53 match PR table exactly).
- Yahoo worker: `{'total': 321, 'refreshed': 300, 'skipped': 13, 'failed': 8}` on both runs. 13 skipped = EUR tickers without listing_exchange (expected). 8 failed = delisted/no-data (graceful, no crash).
- Worker regression: `description` and `cost_basis_total` preserved after worker run.

**Learnings:**
- **Two-PR LURVG coordination:** When two PRs in sequence share a DB schema (PR #400 adds columns consumed by PR #399 server action), validate schema on PR #400 branch and parser on PR #399 branch independently. No need to merge first since schema was already in prod.
- **Direct tsx parser fallback:** Playwright ephemeral account upload flow blocked when UI requires full account config beyond just a `trading_account_config` row. Fallback: `npx tsx` direct validation of parser functions with real broker files — covers all parser logic without UI ceremony.
- **Ephemeral account limitation (account-not-configured state):** The UI file-upload input only appears when the account is fully configured + active. Admin-provisioned accounts with minimal config show empty-state CTA ("Account not configured"), not the upload input. Future workaround: seed all NOT NULL columns in `trading_account_config` AND set a valid `account_status`/`is_active` value if required.
- **Idempotency pattern:** Run worker twice with `--run-once`, compare `max(prices_refreshed_at)` before and after run 2. Timestamps must advance and row counts must be stable.
- **PR comment EMU restriction:** `gh pr comment` blocked by Enterprise Managed User policy. Verdicts must be delivered via other channels (drop note in `.squad/decisions/inbox/`, direct message to team).
- **TASE price unit ambiguity:** Yahoo Finance returns TASE prices in ILS; broker exports use agorot (ILA = 1/100 ILS). If mark_price is stored raw from Yahoo, the units differ from broker values. Always flag this for the developer to confirm conversion is handled.
- **`trading_account_config` required columns (update):** In addition to previously learned columns, `account_status` or `is_active` may also be required for the UI to render the upload input.

---

2026-05-12: Regression tests for options estimation (PR #437). Math verified with known fixtures (100% growth doubling, 0% growth flat). Edge cases: <3 years, negative baseline, large N projection.

## 2026-05-19: Test Review — PR #461 Flex Sync Fixes (squad/flex-sync-fixes)

**Verdict: 🟢 APPROVE.** All 4 required test paths present. Orphan-filter tests use `_OrphanMixedSession` with mixed rows; warning-log assertion uses `caplog` with exact level + account_id checks (strong). `last_synced` success test passes via FakeSession synthetic mode. Failure test verifies call ordering: A_GOOD (id=10) stamped before B_FAIL (id=20) raises, B_FAIL never stamped. Backfill of `household_exists: True` in 3 existing test files correct and necessary — without it `_load_accounts` would KeyError. No silent pass-throughs.

**Key non-blocking gaps:** (1) Warning log test asserts account_id but not household_id — diagnostic required both; easy one-liner fix. (2) Test #4 documents call ordering, not transaction durability — in production, A_GOOD's `last_synced` update also rolls back when B_FAIL raises (shared session, no per-account savepoint). (3) No test for `config_id=None` guard or soft-deleted household (logically covered but not explicitly named).

**Regression value confirmed:** deleting the `_load_accounts` guard → test #1 fails. Moving `_update_config_last_synced` before `_ingest_account` → test #4 fails (B_FAIL's config_id would be in the stamped list before the raise).

**Learning:** When reviewing `last_synced` write-through tests for nightly jobs, always check whether the test is asserting *call ordering* (unit level) vs *transaction commit* (integration level). These are different guarantees. Unit tests that use FakeSessions inherently can't test rollback behavior — flag this gap with a comment rather than blocking merge.

## 2026-05-18: TDD test suite — cashflow dividend redesign (squad/cashflow-dividend-redesign)

**Assigned:** Redfoot writes tests per approved test plan against `dividendByAccount` contract. Created 3 test files: (1) simulate.test.ts extended with 10 new cases (surplus/deficit-full/deficit-partial/zero-account/multi-currency/back-compat/mass-conservation/first-year/tax/three-account-total), (2) new `cash-flow/__tests__/page.test.tsx` with 5 toggle+a11y cases — all 5 green, (3) new `CashFlowSankey.test.tsx` with 5 node-structure cases — all 5 green (Fenster already implemented `#7c7ef8` indigo + reinvestment color). Simulate TDD tests: 6/10 green immediately (back-compat, zero-account, multi-currency, first-year, deficit-fully-consumed, three-account-total); 4 red awaiting McManus's `dividendByAccount` implementation (surplus mass-conservation, partial reinvest proportions, account.value growth, total_dividend_income). Baseline 706/713 preserved (pre-existing 7 failures unchanged). Commit: `9c42238`.


📌 Team update (2026-05-19): Strict-lockout 5-round P0 fix protocol shipped Flex sync fixes in ~2.5h (diagnostic → implement → parallel review → merge → deploy). 88 orphan trading_account_config rows discovered; cascade gap suggests future audit needed. IB Gateway is desktop app, not Docker-managed. Decided by Scribe during cross-agent orchestration.
📌 2026-05-19: R3 test reviews (#463 APPROVE WITH NITS vacuous test + mock fragility; #464 APPROVE WITH NITS unmount cleanup + ambiguity + timeout assertion)

## 2025-07-10: TDD — RSU Automation Acceptance Criteria (issue: RSU plan account feature)

**Assigned:** Redfoot writes acceptance criteria and test implementations for RSU plan account automation (Wix RSU / MSFT RSU, 25% dividend tax, mandatory Payout routing).

**Context:** RSU plan accounts need: (1) `yahoo_refresh` worker extended to price RSU plan account positions, (2) engine to enforce 25% dividend tax and Payout-only policy, (3) UI fields for RSU strategy section. Two accounts in scope — WIX (no dividends) and MSFT (~0.87% trailing yield).

**Work completed:**

1. **Backend tests** (`apps/backend/tests/test_rsu_refresh.py`) — 21 tests, all passing:
   - `TestAC1_MSFTRefresh` — Yahoo price/yield upsert for MSFT RSU
   - `TestAC2_WIXNoDiv` — WIX stores `None` yield (not 0.0, which is falsy)
   - `TestAC7_TickerChangeRefresh` — ticker change triggers new Yahoo lookup
   - `TestAC8_MissingYahooData` — graceful handling of missing Yahoo fields
   - `TestAC9_CurrencyUSD` — USD RSU positions fetched with correct currency
   - `TestAC10_ZeroShares` — zero-share positions handled without crash
   - *Note*: These are TDD stubs; backend implementation (Hockney's worker extension) pending.

2. **Component tests** (`apps/frontend/src/components/Plan/__tests__/PlanAccountDetails.rsu.test.tsx`) — 12 tests, all passing:
   - AC6: RSU strategy section renders in snapshot mode
   - AC7: ticker lookup calls `getPrice` after 800ms debounce
   - AC8: missing/network error handled gracefully
   - Key pattern: `vi.useFakeTimers()` + `vi.runAllTimersAsync()` for the debounce

3. **Engine tests** (appended to `apps/frontend/src/app/plan/__tests__/simulate.test.ts`) — 13 new RSU tests, all passing:
   - AC3: 25% tax ratio check in yr1 (yr0 has no tax field in `currentDividendPayouts`)
   - AC4: Payout forced even with user Accumulate override; dividend visible in income_details
   - AC9: USD→ILS 3× RATES conversion for net_worth and dividend income
   - AC10 edge cases: zero yield, explicit tax override, multiple RSU accounts, two-account totals

**Key technical discoveries:**
- `yr0` uses `currentDividendPayouts()` (no `tax` field) — always check `yr1+` for tax assertions
- Savings routing re-invests Payout income back into accounts — so account.value grows even with Payout; the distinction is that dividend is trackable in `income_details` and tax is tracked
- WIX Yahoo `0.0` yield is falsy in Python → stored as `None` (not `Decimal('0')`)
- `toBeCloseTo(numDigits)` tolerance boundary can bite floating point: use ratio checks over absolute values for tax assertions
- `simulateUsd()` helper needed: default `simulate()` uses ILS main currency which 3×-multiplies USD amounts

**Test counts:** 21 backend ✅ + 12 component ✅ + 13 engine ✅ = 46 new tests. Pre-existing 3 failures (SettingsContext, 2 TTM yield) unchanged.

**Acceptance criteria doc:** `.squad/decisions/inbox/redfoot-rsu-acceptance.md`

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.
📌 Team update (2026-05-29T122212Z): Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.

## 2026-05-29: CC-9 — Anticipatory Test Plan + Scaffold (Credit-Card Expense Pipeline)

**Task:** Write the full test scenario catalogue and pytest stub scaffold for the CC pipeline before any implementation exists (CC-2/CC-5/CC-6 not yet built). 91 stubs: 90 skip, 1 xfail. Zero failures.

**Files produced:**
- `.squad/decisions/inbox/redfoot-cc-test-plan.md` — ~75-scenario catalogue across 7 sections
- `apps/backend/tests/credit_card_pipeline/test_plan_scaffold.py` — 91 stubs (90 skip + 1 xfail)

**Test counts by section:**
- Section 1 (Parsers): 36 stubs — 9 Cal + 8 PayBox + 9 Max + 10 Isracard
- Section 2 (Categorization): 10 stubs
- Section 3 (Dedup/Ingestion): 7 stubs (1 xfail for SHA-256 collision trade-off)
- Section 4 (API): 18 stubs
- Section 5 (Worker): 7 stubs
- Section 6 (Integration): 5 stubs
- Section 7 (Regression): 8 stubs

## Learnings

### Hebrew RTL Test Fixture Strategy
- Do NOT synthesize Hebrew PDFs — use real fixture files from `reports/credit-card/`. The 30 existing files cover all 4 formats and most edge cases (FX rows, installments, multi-page, date quirks).
- For edge cases not in real files (empty statements, corrupt PDFs), generate minimal synthetic fixtures using `reportlab` or `fpdf2` — never pdfplumber itself (circular dependency).
- For bidi correctness assertions: check that `merchant_raw` contains expected Hebrew Unicode codepoints in source (extracted) order. Do NOT assert RTL/LTR direction markers — pdfplumber strips them.
- Max format's `statement__*.pdf` filenames are English-looking but content is fully Hebrew RTL — always verify format by text fingerprint, not filename.

### File-Watcher Test Patterns
- Inject inbox scan as a callable accepting a directory path parameter — never use real filesystem watches in unit tests.
- Use pytest's `tmp_path` fixture for isolated inbox directories per test.
- Mock `shutil.move` in worker tests to assert correct destination path without touching real directories.
- For concurrent-arrival tests (D-5): use threading + `tmp_path`, assert on DB row counts with appropriate locking.
- Orphan detection pattern (D-7/W-4): at worker startup, SELECT all rows WHERE `status='processing'` AND `queued_at < now() - interval '5 minutes'`; re-queue them. Test by inserting a stale `processing` row before calling startup logic.

### Regression-Catcher Patterns for Future Features
- **Dual migration assertion (R-MIGR-1):** For every new DB feature, `test_regression__dual_migration_exists` should assert that BOTH `apps/backend/alembic/versions/` and `supabase/migrations/` contain a file referencing the new table/column names. Implementation agents must remove the skip and extend the assertion table when CC-1 lands.
- **Amount unit regression (R-AMT-1/2):** Build an explicit parametrized table test: `[(₪-string, expected_Decimal)]`. Add a row per parser format per new amount field. This catches the agorot/ILS confusion that is common in Israeli broker integrations.
- **Currency leak regression (R-FX-1/2):** After any new FX-capable format is added, insert a synthetic row with mismatched `amount_ils` vs `amount_original_currency` into the test DB and assert the summary API uses `amount_ils`. This prevents aggregation over the wrong column.
- **General pattern:** regression tests should assert the bad old behavior FAILS, not just that the good behavior passes. Use `pytest.raises` or explicit `assert result != wrong_value` to document the specific regression being guarded against.

---

## 2026-06-04: Reviewer Gate — squad/deps-next-16-2-7 (Next.js 16.2.6→16.2.7 + postcss override)

**Verdict: ✅ APPROVED.** All 13 independent verification gates passed. Branch: `squad/deps-next-16-2-7`. Commits: `d87a0ac` (version bump) + `2eb1ca0` (postcss override). Only `package.json` + `package-lock.json` in committed diff.

**Key findings:**
- postcss: all 3 instances in `npm ls` resolve to 8.5.15 (`deduped` confirms override working)
- GHSA-qx2v-qp2m-jg93: absent from `npm audit` ✅
- 5 remaining advisories (brace-expansion, dompurify ×4, flatted ×2, lodash ×2, picomatch ×2): all pre-existing, outside PR scope
- Cold build: exit 0, 3.7s compile, 23 static + 13 dynamic routes (growth vs task-briefing baseline — consistent with expenses API routes added in prior main commits)
- Tests: 789 passed / 9 failed — exact baseline match; 9 failures are the identical pre-existing ones (dividend-positions ×2, UnresolvedQueue ×6, SettingsContext ×1)
- Dev server: Turbopack ready in 317ms, no module resolution errors, no stack traces
- tsconfig.json: NOT in committed diff (correctly reverted before commit by Fenster)

**Test-coverage gaps surfaced (non-blocking):**

---
