## 2026-05-11 — #408 & #409 Summary + Estimations Source Fix

**Issues:** #408 (/summary shows ~$80k instead of ~$9,200) and #409 (estimations disconnected from live holdings)

### Diagnosis

**#408:** `/summary/page.tsx` called `getDividendProjection()` (legacy FastAPI `/api/dividends/projection`)
after `getDividendDashboard()`. If the legacy endpoint returned `total_annual > 0`, it overrode the
correct ~$9,200 from `getDividendSummary()` with a stale ~$80k figure.

**#409:** `/dividends/estimations/page.tsx` projected forward from `lastHistorical.amount`
(user's last manually-entered year). No connection to live holdings — 2026 projected from old
baseline rather than current ~$9,200.

### Fix (PR #412, SHA 4250f88)

- `/summary/page.tsx`: Removed `getDividendDashboard()` + `getDividendProjection()`. Replaced with
  direct `getDividendSummary()` call. Removed `settings.mainCurrency` dep (unused after refactor).
- `/dividends/estimations/page.tsx`: Fetch `getDividendSummary()` alongside estimations on mount.
  Store `liveAnnualTotal`. In projection loop, anchor current year to live total unless user has
  manually entered it. Added info banner: "Current year anchor (from /dividends): $X,XXX · based on
  current holdings." Historical user-backfilled years preserved untouched.
- 627/627 tests pass. No new lint errors.

**Before:** /summary 2026 dividends ~$80,000; estimations 2026 grew from old baseline.
**After:** /summary 2026 dividends ~$9,200 (matches /dividends); estimations 2026 anchored to live total.

---

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
---

## Archive Entry — Session 2026-05-13

**Lines archived:** 81 of 203
**Reason:** History file exceeded 15KB threshold (17026 bytes)

## 2026-05-13 — Regression diagnostic: "Plan not saved. Failed to create plan." (PR #443 follow-up)

**Triggered by:** jocohe report — toast fires but save fails for any expense on `/plan`.

**Trace summary:**

- **Toast source:** `apps/frontend/src/app/plan/page.tsx:98` — `handleUpdatePlanData` falls into the `else` (create) branch because `plan.id` is `undefined` on a brand-new plan. `createPlan` returns `{ ok: false, error: '...' }`, triggering rollback + toast.
- **createPlan:** `apps/frontend/src/app/plan/actions.ts:170-173` — the Supabase INSERT fails; the real error (`error.message`) was only logged **server-side** via `console.error`. The returned error was a sanitized generic string — **invisible to browser devtools**. This is the critical logging gap.
- **household_id:** Resolved cleanly via `resolveHouseholdId()` → `household_members` lookup. A null here returns a distinct `'Not authenticated or no active household'` message; the user saw `'Failed to create plan'`, confirming `household_id` was resolving but the INSERT failed.
- **data serialization:** `PlanData` passed as flat object (no `data` envelope). `normalizeCreatePayload` correctly takes the raw-PlanData path. No `undefined` values; valid jsonb shape.
- **Root cause hypothesis (ranked):** 1) `plans` table missing / migration not applied on target DB; 2) RLS policy blocking INSERT for the user's `household_id`; 3) NOT NULL constraint on an unset column.
- **Logging gap patched:** One-line fix in `createPlan` to propagate `error.message` to the returned error payload, so the existing `console.error` on `page.tsx:97` surfaces the real Supabase error in the browser console. Shipped as draft PR on branch `squad/440-followup-error-logging`.
- **Open for Hockney:** Confirm whether `plans` table exists + migration status; check RLS policy on `plans` INSERT; check for NOT NULL columns without defaults.

## 2026-05-13 — PR #443 squad/440-error-surfacing

Shipped P0 frontend fixes: error surfacing in `/plan` handleUpdatePlanData + empty-state CTA in `/cash-flow`.

- `/plan`: captures `previousPlan` before optimistic write; on `result.ok === false` rolls back state, fires `toast.error()` via sonner, and `console.error`s for devtools. Installed sonner + added `<Toaster>` to root layout.
- `/cash-flow`: replaced silent `return;` with a proper empty-state component (heading + copy + CTA link to `/plan`) when no plan exists post-load.
- `CashFlowSankey`: updated zero-nodes message to include a navigable link to `/plan`.

P1 income-stream wiring (dividends + bonds) pending Keaton architectural synthesis.
## 2026-05-13 — PR #441 squad/441-income-streams

Shipped P1 income-stream wiring: dividends + bonds + options as virtual, read-only rows in `/plan` and `/cash-flow`.

- `simulation.ts`: added `dividendTotal` + `bondProjection` inputs (follow `optionsMap` pattern); dividend income is a constant annual total; bonds are per-year from `buildIncome()` income_series.
- `plan/page.tsx` + `cash-flow/page.tsx`: extended `Promise.all` to fetch `getDividendSummary()` + `getLadderIncome()` in parallel alongside existing calls.
- `PlanEditor.tsx`: new `virtualIncomeStreams` prop + `virtualSummaryIncomeItems` useMemo; 3 locked rows at top of Income tab with "Auto" badge (emerald) and tooltip.
- Decision note: `.squad/decisions/inbox/fenster-virtual-income-implementation.md` — documents exact data shapes, year-bucket key, and edge cases.

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

---
## Archived from .squad/agents/fenster/history.md (2026-05-27T22:47:01.523858)

# Fenster — Active History

> **Last summarized:** 2026-05-13 (removed 81 older entries to archive)
> **Current size:** 11038 bytes

---

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

## 2026-05-12 — Dividend accuracy + Leumi IRA + chore-PR triage sprint

**Sprint by:** Jony Vesterman Cohen

### PR #411 — /dividends dividend_yield fallback path + est. badge (`34bf9f7`)

**Problem:** `getDividendPositions()` required TTM payments or `dividend_accruals`. Schwab CSV imports never create `dividend_payments` rows → only 3 tickers visible (cross-account IBKR overlap); 18 others silently dropped.

**Fix:** Third parallel query for `stock_positions.dividend_yield`; filter expanded to `hasTTM || hasAccrual || hasYield`. Yield-only path: `forwardDivPerShare = mark_price × normalised_yield`; `source = 'csv'`. Amber **est.** badge added to `DividendPositionsTable` (Fwd Annual$ column) when `source === 'csv'`.

**Result:** Schwab tab 3 → 21 positions; ~$430/yr → ~$9,200/yr. Issue #406 closed.

**Note:** Read-time heuristic (`raw > 1 ? raw / 100 : raw`) was removed in PR #413 (Hockney) once canonical decimal format was enforced at write time.

### PR #412 — /summary + /estimations source fix (`4250f88`)

**Problem #408:** `/summary` called legacy FastAPI `getDividendProjection()` which returned stale ~$80k, overriding `getDividendSummary()` (~$9,200).

**Problem #409:** `/estimations` anchored projections to last user-entered historical year instead of live holdings.

**Fix:** `/summary/page.tsx` calls `getDividendSummary()` directly — drops `getDividendDashboard()` + `getDividendProjection()` (removes extra DB round-trips and legacy override). `/dividends/estimations/page.tsx` anchors current-year projected point to `getDividendSummary()` live total; historical user entries preserved. Info banner added showing live anchor.

**Decision:** `getDividendProjection()` dropped entirely — unmaintained legacy endpoint, values wrong. `getDividendSummary()` is the authoritative dividend total source.

**Result:** /summary 2026 bar: $80,000 → $9,200. /estimations 2026: anchored to live total. Issues #408 + #409 closed.

### 2026-05-12 23:55 — PR #418 (IRA market value 3 composite display bugs)

DB correct (LUMI `market_value` = 78,639 ILS); 3 stacked display-layer bugs fixed: (1) Agorot→ILS: `toDisplayMarkPrice()` divides by 100 for ILA positions so mark price shows `₪77.86` not `₪7,786`. (2) ILA→ILS Intl code: `toDisplayCurrency()` maps ILA→ILS for `Intl.NumberFormat` so `market_value` (stored in ILS) is not mislabeled as agorot. (3) FX in footer: `AggregatePortfolioFooter` now calls `convertCurrency(mv, 'ILS', 'USD')` for ILA positions (was summing ILS as USD, 3× inflation). (4) `market_value_local` fallback: 7 positions with `market_value=null` now use `market_value_local` instead of contributing $0. Files: `StockPositionsTable.tsx`, `AggregatePortfolioFooter.tsx`, `actions.ts`. Result: IRA ~$260k USD (was ~$778k); LUMI ~$26k USD.

### 2026-05-12 — PR #422 (Dividends page TASE/ILA display fix)

**Round:** 7 (single-agent Fenster session)

**Bug:** `/dividends` page showed CLIS (TASE 224014, 101 shares) annual dividend as **$49,995** instead of **₪499.95** — 100× multiplier and USD mislabel.

**Root cause:** Same pattern as PR #418 (`/trading/accounts`), but on `/dividends` page. `getDividendPositions()` computed dividend from `qty × mark_price × yield` without dividing `mark_price` by 100 for ILA (agorot→ILS).

**Fix:** (1) Added `currency` field to `DividendPosition` type. (2) For ILA: `canonicalPrice = mark_price / 100` before calculations. (3) Preferred `pos.market_value` (canonical ILS) over recomputation. (4) `getDividendSummary` converts ILS→USD. (5) `DividendPositionsTable` uses per-row currency display.

**Verification:** CLIS: $49,995 → ₪499.95 ✓. All TASE IRA positions corrected. 634 unit tests passing.

## Learnings

**PR #422 (`faec8e7`) — TASE dividends page wasn't covered by PR #418.** Same fix pattern: currency-aware display + don't recompute from agorot. **Lesson: display-layer fixes must enumerate ALL pages, not just the page that triggered the report.** When fixing `stock_positions` with `currency='ILA'`, audit all pages rendering that table (accounts, dividends, bonds, reports, etc.). The `/dividends` page was an easy miss because PR #418 never mentioned it.

---

2026-05-12: Wired options estimation into /options/estimations (#436), /summary (#435), and /plan (#434). Mirrors dividends estimation patterns. Actuals-win merge in /summary per Keaton's arch decision §4.

## 2026-05-13 — Plan persistence + cashflow sprint, PR #443 (Round 9, Issue #440)

Frontend recon (sonnet-4.6) + P0 error surfacing: identified optimistic UI with silent error swallow in handleUpdatePlanData. PR #443: captures previousPlan, rolls back on {ok: false}, fires sonner toast + console.error. Added empty-state CTA in /cash-flow page when plan is null. Installed sonner, added <Toaster> to root layout. Verified Vercel green post-merge.

## 2026-05-13 — Plan persistence + cashflow sprint, PR #445 (Round 9, Issue #441)

P1 income-stream wiring (sonnet-4.6): dividends + bonds + options as virtual read-only rows. PR #445: extended Promise.all to fetch getDividendSummary() + getLadderIncome(); added dividendTotal + bondProjection inputs to simulation.ts (follow optionsMap pattern); PlanEditor renders virtualIncomeStreams with "Auto" badge (emerald), isVirtual: true. Edge cases documented (zero values shown, missing streams undefined). FX limitation on multi-currency bonds noted as Round 10 follow-up. Verified Vercel green post-merge, PR #445 rebased ×1 post-Hockney.

## 2026-05-18 — Cash Flow Page UI Enhancement Design (Design Doc)

**Requested by:** Jony Vesterman Cohen

Created comprehensive frontend design document for two cash flow page enhancements:

### 1. Monthly/Yearly Toggle
- **Location:** Header section, inline with year display and age indicators
- **Component:** Pill-style toggle with emerald-600 active state (matches existing palette)
- **State:** Local `useState<'yearly' | 'monthly'>` in CashFlowPage (not SettingsContext — view preference, not global setting)
- **Default:** 'yearly' (no breaking change)
- **Value transformation:** useMemo-derived `displayData` divides all monetary values by 12 at render time (income, expenses, savings_details, etc.)
- **A11y:** `aria-pressed` on buttons, keyboard-accessible, focus ring utilities
- **Summary cards:** Show "/ mo" badge when monthly mode active

### 2. Per-Account Dividend Flows in Sankey
- **Income sources:** 3 new nodes (Dividend: IBKR, Dividend: Schwab, Dividend: IRA) flowing into Investment Income type
- **Reinvestment sinks:** 3 new destination nodes (Reinvest: IBKR/Schwab/IRA) as outflows from Net Savings
- **Naming convention:** `income_src_Dividend: {account}` and `reinvest_dest_{account}` to avoid ID collision with existing `save_dest_{account}` nodes
- **Color scheme:** Dividend sources = emerald `#34d399`, Reinvestment destinations = bright indigo `#7c7ef8` (20% brighter than standard savings `#6366f1`)
- **Data contract:** Keaton to extend `runPlanSimulation()` output with per-account breakdown in `income_details` and `savings_details`
- **Backend input:** `getDividendSummary()` already returns `by_account: { ibkr, schwab, ira }` — simulation consumes directly
- **Zero-value filtering:** Omit accounts with $0 dividend from output (no orphaned nodes)
### 3. Plan Page Implications
**Recommendation:** Replace editable dividend controls with **"Auto from real positions" read-only banner** showing per-account totals. Rationale: dividend income is now auto-calculated via `getDividendSummary()` — user-entered policies would be overridden and confusing.

### Edge Cases Documented
- Empty dividend account (0-value filtering)
- Lopsided Sankey when reinvestment rate = 0 (no reinvest entries emitted)
- Currency mismatch (ILS mainCurrency with USD dividends — existing FX approximation limitation documented)
- Reinvestment rate > 100% or < 0% (Keaton to clamp to [0, 1])

### Test Surfaces (for Redfoot)
- Toggle interaction + aria-pressed state
- Monthly calculations (all values / 12)
- Per-account dividend node rendering (3 sources + 3 sinks)
- 0-value account omission (no orphaned nodes)
- Color differentiation (dividend emerald vs reinvestment bright indigo vs regular savings indigo)
- Integration: `getDividendSummary` → simulation → Sankey

**Files produced:**
- `.squad/decisions/inbox/fenster-cashflow-ui-design.md` (22KB, 8 sections)

**Open questions for Jony:**
1. Should monthly/yearly preference persist in localStorage?
2. Reinvestment naming: "Reinvest: IBKR" vs "IBKR Dividend Reinvestment"?
3. Plan page controls: confirm removal of editable dividend inputs acceptable?
4. Should monthly toggle apply to options income too, or only dividends?

## Learnings

**Design-first sprint pattern works.** When UX changes involve multiple pages + backend contracts + test surfaces, producing a design doc BEFORE code prevents re-work. The monthly toggle decision (local state vs SettingsContext) and the plan page removal (vs grayed-out locked state) are architectural choices that would have caused refactor loops if discovered mid-implementation. Documenting the per-account data flow contract (Keaton's domain) ensures alignment before backend work starts.

## 2026-05-18 — Cash Flow UI Implementation, PR squad/cashflow-dividend-redesign (`09cd6c1`)

Monthly/yearly toggle added to cash-flow header (pill button, local useState, resets on reload). `displayData` useMemo scales all monetary fields ÷12 in monthly mode; summary card labels get "/ mo" suffix. Sankey reinvestment nodes now use indigo `#7c7ef8` vs regular savings `#6366f1`. Plan page wires `dividendByAccount` to simulation and threads `dividendAutoAccounts` through PlanEditor→PlanModal→PlanAccountDetails; accounts with real positions (>$0) show blue "Auto from real positions" banner and hide editable yield/policy controls. Build: ✅ (`npm run build` exit 0, 6 files changed).

## 2026-05-18 — Next.js 16 Round 2 Fixes, PR #393 (`3855e10`)

Applied 4 targeted fixes to bring PR #393 from "builds + tests pass" to "ready to merge with zero deprecation warnings":

1. `next.config.ts`: removed deprecated `eslint: { ignoreDuringBuilds: true }` block (Next 16 removed this config key).
2. `package.json`: bumped `eslint-config-next` `^15.5.15` → `^16.2.6` (unblocks PR #459 eslint 10 upgrade).
3. `package.json`: changed `"lint": "next lint"` → `"lint": "eslint ."` (next lint removed in Next 16).
4. `package.json`: bumped `react-dom` `^19.2.5` → `^19.2.6` to match `react@19.2.6`.
5. `middleware.ts`: added one-line TODO comment for Next 17 proxy migration (edge runtime preserved).

**tsconfig.json** was reverted post-build (Next 16 auto-modifies it; Keaton's merge gate criterion #8 forbids tsconfig changes).

**Result:** Tests improved from 534 passed (26 failed suites) → 714 passed (2 failed suites). React-dom version sync eliminated all 25 suite initialization failures. 3 pre-existing TTM dividend calc failures remain (matches Keaton's 714/717 baseline). Build shows zero eslint-key deprecation warnings. eslint@10 compat dry-run clean — PR #459 is unblocked.

## Learnings

**Always revert tsconfig.json after `next build`.** Next 16 silently rewrites `jsx: "preserve"` → `"react-jsx"` and injects `.next/dev/types` into the include array. This must be caught and reverted BEFORE commit. Add `git checkout -- apps/frontend/tsconfig.json` to the post-build verification sequence for every Next.js upgrade sprint. If left in, it will cause unwanted diffs and break Keaton's merge gate criterion #8 without any error message.
📌 2026-05-19: PR #464 frontend shipped (Refresh button rewire, state machine, 7 tests, 4 nits addressed) merged a9e2444

## 2026-05-27 — RSU Account UI Wiring (PlanAccountDetails.tsx)

**Branch:** `squad/rsu-ui-wiring` | **Tests:** 10 new pass (714+10 total)

**Goal:** Wire RSU account configuration surface in `PlanAccountDetails.tsx` for "Wix RSU" and "MSFT RSU" accounts.

**Changes to `apps/frontend/src/components/Plan/PlanAccountDetails.tsx`:**
- Added `dividendYieldOverride` state (local, default false — auto mode).
- `fetchMarketData`: defensively reads optional `dividend_yield` from extended API response with TODO for Hockney's endpoint; conditionally calls `updateSettings({ dividend_yield })` when not in override mode.
- Price-fetch `useEffect`: now fires in **both** planning and snapshot modes (removed `mode === 'snapshot'` guard).
- Auto-defaults `useEffect`: fires on `settings.type` change; sets `dividend_policy = 'Payout'` and `dividend_tax_rate = 25` (if unset) when type is RSU. Uses eslint-disable for intentional deps.
- New **RSU Configuration** block (planning mode only): ticker input required (red border + error when empty), price cache status, dividend yield auto-display with Override/Revert toggle, tax rate input defaulting to 25.
- Investment Profile section: `settings.type !== 'RSU'` guard on dividend yield block — RSU yield managed by RSU Config block only.
- Dividend Policy section: `settings.type !== 'RSU'` added to section-level condition — entire section hidden for RSU.

**Tests created:** `apps/frontend/src/components/Plan/__tests__/PlanAccountDetails.test.tsx`
- 10 tests across: ticker validation, dividend yield auto display, policy locked for RSU, tax rate default 25.

**Patterns confirmed:**
- Ticker field name is `stock_symbol` (not `ticker`).
- `getPrice` returns `{ price, as_of, refreshed_at, isStale }` — no `dividend_yield` yet. Defensive cast pattern: `const extendedData = data as typeof data & { dividend_yield?: number }`.
- Hockney's extended endpoint is a future TODO; code is ready to handle it.
- Dividend Policy section hidden (not disabled) — single source of truth is the RSU Config block.
- `dividendYieldOverride` does NOT reset on ticker change — user opted in explicitly.

**Decisions filed:** `fenster-rsu-ui.md`

---

📌 **Team update (2026-05-27)**: RSU automation batch completed. All 5 agents collaborated on price_cache extension (backend), engine tax/policy enforcement (frontend), and UI configuration. 46 acceptance tests pass. Branch: squad/rsu-ui-wiring. Decisions merged to .squad/decisions.md. Next: yield-units normalization follow-up pending from Hockney.
📌 Team update (2026-05-29T122212Z): Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.

## 2026-05-29 — CC-7 + CC-8: Credit-Card Expenses UI (`632cd51`, branch `squad/credit-cards`)

**Route:** `/finances/expenses` (Next.js App Router, `force-dynamic`)
**Nav:** Added "💳 Credit Card Expenses" link under new "Expenses" section in `MainLayout.tsx`
**Tests:** 31 new (8 MonthlyOverview, 8 UnresolvedQueue, 15 CategoryPicker) — all pass
**Build:** `npm run build` exit 0, route appears in build manifest

### Components shipped

| File | Description |
|------|-------------|
| `page.tsx` | Tab container (Monthly / By Category / Unresolved / Statements) |
| `MonthlyOverview.tsx` | `@nivo/bar` stacked chart; date-range pills (3/6/12m); transfers toggle default OFF |
| `CategoryPie.tsx` | `@nivo/pie` donut; month picker; collapsible side-panel; inline drill-down table |
| `UnresolvedQueue.tsx` | Resolution table: inline CategoryPicker, apply-to-all ON default, bulk modal, optimistic remove, sonner toasts |
| `CategoryPicker.tsx` | Searchable hierarchical dropdown; English + Hebrew filter; Escape closes; subcategory expand |
| `StatementsList.tsx` | Bonus tab: statements table with ⚠ icon+text for parse_warnings |

### @nivo/bar + @nivo/pie patterns learned

- `ResponsiveBar` takes `data: Record<string, unknown>[]` with `indexBy` as x-axis key and `keys` as the series names. Colors are passed via `colors={(bar) => colorMap[bar.id]}`.
- `ResponsivePie` `data` shape: `{ id, label, value, color }[]`. Colors via `colors={(d) => d.data.color}`.
- Both components need ResizeObserver — mock them entirely in vitest with a `vi.mock('@nivo/bar', ...)` shim returning a `<div>` with data-testid + click handlers. This is cleaner than trying to polyfill ResizeObserver in jsdom.
- Theme for dark mode: pass `theme={{ axis: { ticks: { text: { fill: '#94a3b8' } } }, grid: { line: { stroke: '#334155' } } }}`.
- `@nivo/bar` and `@nivo/pie` installed with `--legacy-peer-deps` (React 19 peer compat issue — same pattern as other @nivo packages in this repo).

### Hebrew RTL approach

- Page wrapper: `dir="ltr"` (layout stays LTR for charts + tables).
- Individual merchant / category cells: `dir="auto"` — browser auto-detects bidi direction from first strong character. Works correctly for both Hebrew and ASCII merchant names.
- `toLocaleDateString('he-IL')` for date display; `toLocaleString('he-IL')` for currency amounts.
- `formatMonthHe()` helper uses `Date.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })` for the month picker labels.

### CategoryPicker design decisions

- **Hardcoded tree** from `EXPENSE_CATEGORIES` in `types/expenses.ts` — mirrors McManus's YAML exactly (slugs, Hebrew names, colors, subcategory nesting).
- Search filters by `name` OR `name_he` at both parent and subcategory level; parent auto-expands when a subcategory matches.
- `aria-selected` on each `role="option"` item; trigger button has `aria-haspopup="listbox"` + `aria-expanded`.
- Escape closes via `onKeyDown` on the wrapper div (bubbles up from any focused child).
- `disabled` prop disables the trigger and suppresses open — used when category picker is in a confirming state.

### Backend gaps discovered (for Hockney)

1. **No `GET /api/expenses/categories` endpoint.** The frontend hardcodes the category tree from McManus's YAML. Tracked as `TODO(CC-9)` in `src/lib/expenses/api.ts`. Hockney should add this endpoint so the UI stays in sync when categories are added. The tree in `types/expenses.ts` is the temporary shim.
2. **No `suggested_category` field on `UnresolvedTransactionItem`.** The `TODO(v1.5)` is documented in the backend Pydantic model; the frontend column renders blank for now.
3. **Rate-limit on `POST /api/expenses/resolve` not yet implemented** (Rabin §4.3 — tracked as `TODO(CC-13)` in the backend). Frontend has no special handling needed here.

### Decimal precision

- All client-side aggregation (pivot for bar chart, pie totals) uses `decimal.js` — no native float arithmetic on ILS amounts.
- `amount_ils` from API is `number` (float64 JSON); accumulated via `new Decimal(row.amount_ils).plus(...)` before `.toNumber()` for the chart. Precision loss is only at the final render step, which is acceptable for display purposes.

### Decisions filed

None needed — no decisions that cross team boundaries. Category tree gap documented as TODO(CC-9) in code comments.

## 2026-06-04 — Next.js 16.2.6 → 16.2.7 Patch Bump (`d87a0ac`, branch `squad/deps-next-16-2-7`)

Routine patch bump directed by Keaton's inbox decision. Two pins changed: `next` and `eslint-config-next`. `npm install` resolved 5 changed packages in 15s.

### Validation run observations

**Lint:** 39 errors / 10 warnings — all pre-existing, in e2e fixtures and existing components. `react-hooks/rules-of-hooks` in `auth-cookie.ts` / `test-user.ts` (e2e fixture naming convention mismatch), `react-hooks/immutability` in `TradingAccountSettings.tsx`, one unused `eslint-disable` in `database.ts`. Not a regression from the version bump.

**Tests:** 789 passed, 9 failed across 3 suites — pre-existing failures:
- `dividend-positions.test.ts` (2 tests): Keaton's documented TTM baseline failures
- `UnresolvedQueue.test.tsx` (6 tests): CC module mock issue, not caused by Next.js bump
- `SettingsContext.test.tsx` (1 test): pre-existing parameter mismatch
Total test count grew from prior baseline (714 → 789) — reflects CC-7+CC-8 additions and subsequent test additions.

**Build:** ✅ Exit 0. `▲ Next.js 16.2.7 (Turbopack)` confirmed in build header. 27 static + 8 dynamic routes generated successfully. Build time ~4.3s compile, ~250ms static generation.

**New build warning observed:** `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` — this is a new message in 16.2.7 (not present in 16.2.6). The existing `// TODO: migrate to proxy for Next 17` comment in `middleware.ts` correctly anticipated this. Not blocking.

**tsconfig.json mutation:** Next build silently rewrote `jsx: "preserve"` → `"react-jsx"` and injected `.next/dev/types/**/*.ts` into include — exactly as documented in prior learnings. Reverted with `git checkout -- apps/frontend/tsconfig.json` before commit. Zero diff on tsconfig in the final commit.

## Learnings

**The `middleware` deprecation warning is new in 16.2.7.** The message says to use `"proxy"` file convention. The existing TODO in `middleware.ts` was correct — but the warning now fires at _build time_, not just runtime. Coordinator should schedule the migration before Next 17 drops support. No action needed from Fenster this sprint.

**Pre-existing lint failures can mask real regressions.** This project has 39 lint errors in files unrelated to the bump. Any future patch bump should first document the pre-bump lint/test baseline (e.g., via `npm run lint 2>&1 | tail -3` before the bump), so regressions are immediately distinguishable from pre-existing issues.

**npm install resolved 5 packages for a 2-package pin change.** The 5 transitively updated packages were all internal to the `next` and `eslint-config-next` dependency trees — no surprises.

## 2026-06-04 — postcss Override for GHSA-qx2v-qp2m-jg93 (`2eb1ca0`, branch `squad/deps-next-16-2-7`)

Layered a security override on top of the Next.js 16.2.7 bump commit. Rabin's triage found that `next@16.2.7` still bundles `postcss@8.4.31` inside its own nested `node_modules/next/node_modules/postcss/` — the parent version bump did NOT flatten this. Additionally, the top-level `postcss@8.5.9` (used by `@tailwindcss/postcss` and `vite`) was also below the `8.5.10` fix threshold. Added `"overrides": { "postcss": "^8.5.10" }` to `apps/frontend/package.json` as a top-level sibling of `dependencies`/`devDependencies`.

### npm overrides behavior observed

- `npm install` after adding `overrides` ran in ~820ms — extremely fast, changed only 3 packages (`removed 1, changed 2`). npm's override mechanism forces a single version into the resolution tree without downloading large dependency sets.
- **The override flattened `postcss` across ALL consumers** — `next`'s bundled copy, `@tailwindcss/postcss`, and `vite` all resolved to `postcss@8.5.15` (latest satisfying `^8.5.10`). The `deduped` annotation in `npm ls postcss` confirms the single-instance resolution.
- `postcss@8.5.9` → `8.5.15`: no peer-dep warnings triggered. Tailwind, Vite, and Next all accept the higher patch version without complaint.
- **Vulnerability before override:** 7 vulnerabilities (4 moderate, 3 high) — the 2 postcss moderate vulns counted twice (once for top-level, once for next's nested copy). **After override:** 5 vulnerabilities (2 moderate, 3 high) — the 2 postcss entries vanished entirely. GHSA-qx2v-qp2m-jg93 cleared: ✅ YES.
- Remaining 5 vulnerabilities (brace-expansion, dompurify, flatted, lodash, picomatch) are pre-existing and unrelated to postcss.

### Build and test impact

**Build:** ✅ Exit 0. postcss 8.5.15 processes Tailwind CSS correctly — no CSS pipeline failures. Same 27 static + 8 dynamic routes, same ~3.9s compile. The middleware deprecation warning continues (pre-existing from 16.2.7).

---
