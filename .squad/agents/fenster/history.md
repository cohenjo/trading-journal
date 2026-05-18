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
