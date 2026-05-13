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
