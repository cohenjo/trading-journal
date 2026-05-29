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
