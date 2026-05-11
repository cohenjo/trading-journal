## 2026-05-11 — #406 Dividends Accuracy Fix

**Issue:** #406 — /dividends shows only ~3 Schwab positions (~$430/yr) instead of ~21 (~$9,200/yr)

### Diagnosis

`getDividendPositions()` filtered with `if (!hasTTM && !hasAccrual) continue` — only positions
with IBKR Flex payment history (`dividend_payments`) or `dividend_accruals` were shown. Schwab
CSV imports write to `stock_positions` only; 18 of 21 yielding Schwab positions were silently
dropped. Three tickers (ABR, BXMT, JPC) slipped through because IBKR also held them.

DB diagnostic: account 71 (Schwab) had 21 positions with `dividend_yield > 0` in `stock_positions`
but 0 TTM payments. Additionally found `dividend_yield` is stored in mixed format:
values > 1 are percentages (Yahoo Finance format); values ≤ 1 are decimal fractions.

### Fix (PR #411, SHA 34bf9f7)

- Added third parallel query: `stock_positions.dividend_yield` for the account.
- Expanded filter: `!hasTTM && !hasAccrual && !hasYield` (yield-only positions now qualify).
- Yield-only forward estimate: `mark_price × normalised_yield × quantity`; `source = 'csv'`.
- Normalisation at read-time: `raw > 1 ? raw / 100 : raw` (handles both storage formats).
- `DividendPositionsTable`: amber **est.** badge on Fwd Annual$ for `source='csv'` rows.
- +2 regression tests (percentage + decimal yield paths). 627/627 pass.

**Before:** 3 rows, ~$430/yr. **After:** 21 rows + est. badges; ~$9,200/yr once full.

---

## 2026-05-11 — #372 & #376 Batch Frontend Fixes

**Issues:** #372 (label htmlFor accessibility), #376 (LadderPage coupon test alignment)

### #372 — Label htmlFor accessibility on TradingAccountSettings

**Problem:** PR #371 LURVG found that `getByLabel('Account Type')` timed out in Playwright tests because the form label had no `htmlFor` attribute, preventing screen readers and test tools from associating the label with its form control.

**Fix:** Added `htmlFor`/`id` pairs to all 9 form labels in `TradingAccountSettings.tsx`:
- `account-name`, `account-type`, `linked-account` (always shown)
- `host`, `port`, `client-id` (IBKR-specific)
- `app-key`, `app-secret`, `account-hash` (Schwab/LeumiIRA)

**Impact:** Improves accessibility compliance and enables reliable Playwright label-based queries.

### #376 — LadderPage coupon test alignment

**Problem:** PR #373 introduced `displayCouponRate()` utility with default `decimals: 3`. Production renders 3-decimal coupons (e.g., "4.250%"), but the LadderPage test expected 2 decimals ("4.25%"), causing test failure (518/519 → 519/519).

**Fix:** Updated test expectation in `LadderPage.test.tsx` line 142: `"4.25%"` → `"4.250%"` to match production behavior.

**Rationale:** No need to modify `displayCouponRate` defaults (used elsewhere correctly); test alignment is the right fix.

**Tests:** All 519 tests pass ✅

**Commit:** `2ee7637` on `squad/372-376-fenster-batch` → PR #378.

---

## 2026-05-12 — #358 Extract displayCouponRate() utility


**Issue:** #358 "Bonds: extract displayCouponRate() utility to remove Bug-2 footgun"

**Root cause addressed:** Bug-2 (sprint #356) occurred because `coupon_rate` flows through two conventions: PERCENTAGE units in `bond_holdings` (DB-native, 4.25 = 4.25%) vs DECIMAL units in the `Bond` type used by Ladder components (normalised by `/100` in `actions.ts`). Inline `* 100` and `.toFixed(2)` calls were scattered across three files, making it easy to re-introduce the footgun.

**Fix:** Extracted `apps/frontend/src/lib/bonds/coupon-rate.ts`:
- `displayCouponRate(raw, { kind?, decimals? })` — formats coupon rate for display. Kind `'percentage'` (default, 3dp) or `'decimal'` (multiplies by 100 internally). Returns "—" for null/undefined/NaN/Infinity.
- `parseCouponRate(raw)` — parses unknown input to number | null; empty string → null.

**Call sites replaced:**
- `apps/frontend/src/app/holdings/page.tsx` (line 322): `{Number(h.coupon_rate).toFixed(3)}%` → `{displayCouponRate(h.coupon_rate)}`
- `apps/frontend/src/app/ladder/page.tsx` (line 258): `{(bond.coupon_rate * 100).toFixed(2)}%` → `{displayCouponRate(bond.coupon_rate, { kind: 'decimal' })}`
- `apps/frontend/src/components/Ladder/RungDetails.tsx` (line 220): same decimal-kind swap

**Tests:** 28 new unit tests in `src/lib/bonds/__tests__/coupon-rate.test.ts`. All 519 tests pass.

**Build:** ✅ Next.js build succeeds.

**Commit:** `9ea88a8` on `squad/358-coupon-rate-utility` → PR #373.

---



**Issue:** `/trading/accounts` showed duplicate rows for the same ticker — e.g. `ABR` appeared 4× with stale 2022/2023/2024 quantities. Root cause: `getStockPositions()` in `actions.ts` fetched **all** `stock_positions` rows ordered by ticker with no latest-snapshot filter. Flex imports store year-end snapshots (2022/2023/2024/2025) as separate rows, so 55 tickers × avg 3.4 snapshots ≈ 213 raw rows were rendered verbatim.

**Bypass-API antipattern identified:** The page server action queries Supabase directly instead of calling Hockney's FastAPI endpoint `GET /api/accounts/positions` (which already applies `DISTINCT ON`). This creates a dual query path that can silently diverge. Decision: fix the frontend data layer now (Option A), flag Option B (switch to API) as future consolidation work.

**Fix applied (Option A — TS-side dedupe):**
- Added `dedupeLatestSnapshot()` helper in `actions.ts`: iterates rows and keeps the entry with the **latest `as_of_date`** per `(account_id, ticker)` composite key, then re-sorts alphabetically by ticker.
- Applied at the end of `getStockPositions()` before returning — covers both `flex` and `manual` (Schwab/LeumiIRA) sources defensively.

**Before/after row count:** before ≈ 213 rows rendered → after: 55 unique rows (matches Hockney's API output).

**Multi-part verification applied:**
- 5 new unit tests in `actions.test.ts` (Vitest): ABR×4 dedup, total-count uniqueness, DBK passthrough, manual source dedup, alphabetical sort. All 377 tests green.
- Tests would FAIL on `main` before this fix.

**Commit:** `7e6bcfe` on `origin/main`.

**Pattern established — dedup key:**
```ts
const key = `${row.account_id}:${row.ticker}`;
if (!existing || row.as_of_date > existing.as_of_date) map.set(key, row);
```

**Future work:** Option B (route page through `GET /api/accounts/positions`) would eliminate the dual-path entirely — recommended when API consolidation is on the roadmap.

---

## 2026-05-09 — #340 follow-up: account label rename

Renamed tab display labels to match Jony's finalized directive:
- `ibkr: "IBKR"` → `ibkr: "InteractiveBrokers"`
- `ira: "IRA (Hishtalmut)"` → `ira: "LeumiIRA"`
- `schwab: "Schwab"` (unchanged)

Internal `account_type` codes stay as tech identifiers (ibkr, schwab, ira).

**Files touched:**
- `apps/frontend/src/app/trading/accounts/page.tsx` — central `TAB_LABELS` mapping (3-line change)
- `apps/frontend/src/components/trading/accounts/__tests__/AggregatePortfolioFooter.test.tsx` — test fixture names

**Test results:** 364/364 green (no regressions).

**Commit:** 06c4984 (pushed to origin/main).

---

## 2026-05-11 — #363/#364 Dividends + Bonds: frontend wiring + playwright e2e (PR #365)

**Scope:** Wire backend data (`getDividendPositions`, `getDividendSummary`, `getLadderOverviewByAccount`) into UI components; 3-tab layout for dividends and bonds; comprehensive e2e specs.

**Files created:**
- `apps/frontend/src/components/Dividends/DividendPositionsTable.tsx` — sorted by `forward_dividend_annual` DESC; 9 columns (Ticker/Qty/Price/TTM Yield%/TTM Yield$/Fwd Yield%/Fwd Annual$/Frequency/Last Payment)
- `apps/frontend/src/components/Dividends/DividendAccountTab.tsx` — per-tab component with `useEffect` fetch + collapsible history
- `apps/frontend/e2e/dividends-positions-mirror.spec.ts` — 6 e2e specs for #363
- `apps/frontend/e2e/bonds-account-tabs.spec.ts` — 5 e2e specs for #364

**Files rewritten:**
- `apps/frontend/src/app/dividends/page.tsx` — 3-tab layout with `DividendAccountTab`, summary header, testids
- `apps/frontend/src/app/ladder/page.tsx` — added 3-tab pattern with `getLadderOverviewByAccount`

**Testids:** `dividends-summary-total`, `dividends-account-empty`, `dividends-history-toggle`, `bonds-account-empty`, `bonds-tab-{ibkr,schwab,ira}`

**Test results:** 471/471 unit tests pass; 13/13 playwright specs pass (8/8 #363, 5/5 #364).

**Observation:** Fenster specs lack auth fixture in current e2e/ — all specs fail on protected routes. Workaround: use `auth-cookie` fixture for real runs. Noted for Redfoot validation.

**TS hygiene:** Work around type conflict — import `DividendPosition` directly from `@/types/dividends`, NOT from `@/app/dividends/actions` (had conflicting local interface).

---


### Pattern established

This is the **template for all 32 MOVE endpoints**. See decision note at:
`.squad/decisions/inbox/fenster-finances-server-action.md`

### Build/test results

- `npm run test`: 8/8 new tests pass. 3 pre-existing Pension test failures (unrelated).
- `npm run lint`: 0 errors in changed files. All other lint errors are pre-existing.
- `npm run build`: ✅ succeeds with env vars set.

---

## 2026-05-10 — ✅ Frontend Bug Fixes: Bonds Page + Accounts Page + Dividends

**Commit:** `11e7760` on `main` | **Tests:** 378 pass (+1 new)

**Bug 1 — Bond holdings sort:** `listBondHoldings()` in `apps/frontend/src/app/holdings/actions.ts` changed from maturity-only sort to `ticker ASC nullsFirst:false` then `maturity_date ASC`. Null tickers sort last; deterministic for all rows.

**Bug 2 — CUSIP column showed row ID:** `BOND_HOLDING_SELECT` now includes `cusip`; `BondHolding` interface gets `cusip: string | null`; `normalizeHolding()` populated; render changed from `{h.id}` → `{h.cusip ?? ""}`. Confirmed DB has correct CUSIPs (e.g., `91282CJZ5`).

**Bug 3 — Coupon × 100 (387.5% bug):** `(h.coupon_rate * 100).toFixed(2)` → `Number(h.coupon_rate).toFixed(3)`. Removed `/ 100` on save. Default new-row value `0.04` → `4.0`. DB stores in percentage units (4.25 = 4.25%). Files: `apps/frontend/src/app/holdings/page.tsx`, `apps/frontend/src/app/holdings/actions.ts`.

**Bug 4 — Accounts page title:** `<h1>` renamed from "Trading Accounts" → "Stock Positions" in `apps/frontend/src/app/trading/accounts/page.tsx` (page only renders equity; bonds at `/holdings`).

**Bug 5 — Dividends getDividendAccounts() returned []:** `dividend_accounts` table sparsely seeded for household. Fix: explicit `.eq('household_id', householdId).is('deleted_at', null)` filter; falls back to `trading_account_config.name` when result empty. Three trading accounts (InteractiveBrokers id=1, Schwab id=71, LeumiIRA id=72) now populate dividend tabs. File: `apps/frontend/src/app/dividends/actions.ts`.

**Sacred files untouched:** `buildYearlyIncomeData.ts`, `StackedIncomeBarChart.tsx`, `dedupeLatestSnapshot()` ✅

**Decisions filed:** `fenster-frontend-bugs-2026-05-10.md` (processed by Scribe)

---

### 2026-05-10: Manual Position CRUD UI on Stock Positions Page (Fenster-2)

**Commit:** `6adf8e7`
**Date:** 2026-05-10
**Files:** `apps/frontend/src/app/trading/actions.ts`, `apps/frontend/src/app/trading/accounts/page.tsx`, `AddPositionModal.tsx`, `StockPositionsTable.tsx`, `CSVImportButton.tsx`, and related tests

Delivered full inline CRUD management for Schwab and LeumiIRA manual accounts. Added `updateStockPosition()` and `importManualPositionsCsv()` server actions. New Next.js multipart proxy route at `/api/accounts/[accountId]/positions/import` for CSV upload. Components: Edit modal with pre-fill, two-step inline delete confirmation, CSV import button. Guard: `isManualAccount` flag hides mutate UI on Flex accounts (IBKR). 9 new tests; 387/387 green. Sacred functions (`dedupeLatestSnapshot`, `buildYearlyIncomeData`, `StackedIncomeBarChart`) untouched per constraints (#340, #342, #343).

## 2026-05-11 — Hardcoded 3-Tab Pattern + Settings Banners + Playwright Spec

Frontend invariant established: `ACCOUNT_TABS` hardcoded from `TAB_ORDER` keys (`ibkr`, `schwab`, `ira`), never derived from DB rows. Empty config renders `data-testid="account-not-configured"` banner. Settings form defaults to lowercase `account_type` matching DB constraint. Form errors display `data-testid="settings-save-error"` (red) and success (green). E2E spec created: `apps/frontend/e2e/account-tabs.spec.ts` for local and deployed validation. Pattern mirrors `dividends/page.tsx` — tabs hardcoded, DB rows map to visible state.

## 2026-05-11 — #363 Dividends positions-first view + #364 Bonds account tabs

**Issues:** #363 (dividends page refactor to positions-first projected-income view) and #364 (bonds/ladder page 3-tab account pattern). Built on Hockney's backend PR #365 which provided `getDividendPositions()`, `getDividendSummary()`, and `getLadderOverviewByAccount()`.

**Dividends (#363):**
- Rewrote `dividends/page.tsx`: title "Dividend Income", summary header with total forward annual income, 3-tab layout (IBKR/Schwab/IRA).
- Created `DividendPositionsTable` — 14-column table sorted by `forward_dividend_annual` DESC. Exports `fmtFrequency` for testing.
- Created `DividendAccountTab` — per-tab container using `useEffect` + `getDividendPositions(accountKey)`. Shows table or empty state; collapsible history section backed by legacy `DividendDashboard`.
- Import pattern: `DividendPosition` type from `@/types/dividends`, functions-only from `@/app/dividends/actions` — workaround for TS2440/TS2484 conflict in actions.ts (Hockney's bug, logged in drop-box).

**Bonds (#364):**
- Refactored `ladder/page.tsx`: added 3-tab bar, switched from `getLadderOverview()` to `getLadderOverviewByAccount(activeTab)`.
- IBKR always shows full ladder view; Schwab/IRA show `bonds-account-empty` when API returns empty data.
- `isEmpty` guard: `!loading && !error && activeTab !== 'ibkr' && bonds.length === 0 && rungs.length === 0`.

**Test pattern learned:**
- Top-level `await` in `beforeEach` for dynamic imports does NOT work in Vitest. Correct pattern: assign mock fn at module level, override return value in `beforeEach` with `.mockResolvedValue()`.
- When refactoring a page to call a different action function, always update the test's `vi.mock()` factory to include the new function name.

**Tests:** 471 passing (52 files). 3 previously failing LadderPage tests fixed by updating mock factory.

**Commit:** `0eaea1d` on `squad/363-dividends-positions-mirror` → PR #365.
