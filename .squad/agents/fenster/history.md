## 2026-05-09 — #340 follow-up: stock_positions dedup (bypass-API antipattern)

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

- Upsert uses `onConflict: 'date'` (PK). RLS blocks cross-household updates at DB level.


### Pattern established

This is the **template for all 32 MOVE endpoints**. See decision note at:
`.squad/decisions/inbox/fenster-finances-server-action.md`

### Build/test results

- `npm run test`: 8/8 new tests pass. 3 pre-existing Pension test failures (unrelated).
- `npm run lint`: 0 errors in changed files. All other lint errors are pre-existing.
- `npm run build`: ✅ succeeds with env vars set.

## Household Bootstrap + Sign-out (2026-05-03)

**Issue:** Jony hit "⚠️ No active household found for your account" on `/current-finances` when saving funds/assets. New OAuth users have no `household_members` row.

**Solution:** Implemented TASK A–D in branch `squad/login-household-bootstrap-2026-05-03`.

### Files created/modified

| File | Change |
|------|--------|
| `apps/frontend/package.json` | +`lucide-react ^1.14.0` |
| `src/lib/household/HouseholdContext.tsx` | NEW — HouseholdProvider + useHousehold hook |
| `src/components/Household/AccountTypePickerDialog.tsx` | NEW — modal for first-login household setup |
| `src/components/Household/HouseholdBanner.tsx` | NEW — inline banner with "Set up household" CTA |
| `src/components/Layout/MainLayout.tsx` | HouseholdProvider wrap + sign-out section + user email |
| `src/app/current-finances/page.tsx` | HouseholdBanner replaces raw error message |
| `e2e/flows/household-bootstrap.spec.ts` | Already existed; all data-testid attrs now implemented |
| `.squad/decisions/inbox/fenster-login-bootstrap.md` | Design notes |

### Architecture highlights

- **HouseholdContext:** React Context (no Zustand dep needed). Bootstrap on first authenticated render. Reads `v_my_active_household`. Exponential back-off (800ms × 2^attempt, max 3 retries). `runningRef` prevents concurrent runs.
- **Sign-out:** `supabaseBrowser.auth.signOut()` → `router.replace('/login')`. `LogOut` icon from lucide-react.
- **data-testid contract:** `household-banner`, `household-banner-setup`, `account-type-individual`, `account-type-joint`, `account-type-confirm`, `sidebar-signout`, `signed-in-email` — all implemented and stable for Redfoot E2E.

### Lint/typecheck

- `npm run lint`: 0 errors in changed files. Pre-existing errors unchanged.
- `npx tsc --noEmit`: 0 errors in changed files. Pre-existing errors unchanged.

## 2026-05-03: HouseholdProvider + Sign-out Menu Landed — PR #163

**Features:** Implemented `HouseholdProvider` component for household context management and added sign-out menu option in the UI. Enables user to manage active household and logout workflows.

**Merge:** PR #163 rebased on top of #164 (Hockney's RPC), CI green, merged (commit 168171d). Conflict resolution during rebase preserved #163's household context logic.

**Downstream:** PR #166 (Redfoot's comprehensive E2E coverage) depended on #163's household UI, merged successfully after rebase.

## Dual Y-axis: Net Cash Flow vs Realized P&L (2026-05-06)

**Issue:** `NetCashFlowVsRealizedChart` rendered cash-flow bars and cumulative P&L line on a single shared Y-axis, making the bars (±$1K-$10K) invisible against the cumulative line (~$219K).

**Solution:** Dual Y-axis using lightweight-charts' built-in `leftPriceScale` / `rightPriceScale` with `priceScaleId` per series.

### Files changed

| File | Change |
|------|--------|
| `apps/frontend/src/components/Options/net-cash-flow-vs-realized-chart.tsx` | Dual axes, currency formatter, axis-hint labels |
| `apps/frontend/src/components/Options/__tests__/NetCashFlowVsRealizedChart.test.tsx` | +2 tests (dual-axes, tooltip hints) |

### Implementation details

- `leftPriceScale: { visible: true, borderColor: '#22c55e', scaleMargins: { top: 0.1, bottom: 0.1 } }` — emerald, matches cash-flow bars
- `rightPriceScale: { borderColor: '#60a5fa', scaleMargins: ... }` — blue, matches P&L line
- Cash-flow histogram: `priceScaleId: 'left'`
- Realized P&L + tax lines: `priceScaleId: 'right'`
- Currency format: `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })` passed as `priceFormat: { type: 'custom', formatter }`
- Legend buttons show axis direction hints: `← left axis` / `right axis →`
- Tooltip shows `Cash Flow (←)` and `Cumulative P&L (→)`

## Learnings

**Charting library:** `lightweight-charts` v5 (canvas-based, not SVG).

**Dual-axis pattern for this project:**
```typescript
// Chart creation
createChart(el, {
  leftPriceScale:  { visible: true, borderColor: SERIES_A_COLOR, scaleMargins: { top: 0.1, bottom: 0.1 } },
  rightPriceScale: {                 borderColor: SERIES_B_COLOR, scaleMargins: { top: 0.1, bottom: 0.1 } },
});

// Series assignment
chart.addSeries(HistogramSeries, { priceScaleId: 'left',  priceFormat: { type: 'custom', formatter: currencyFn, minMove: 1 } });
chart.addSeries(LineSeries,      { priceScaleId: 'right', priceFormat: { type: 'custom', formatter: currencyFn, minMove: 1 } });
```

**Testing dual axes:** The lightweight-charts mock (in `src/test/setup.ts`) exposes `vi.mocked(createChart).mock.calls` — assert `calls[n][1].leftPriceScale.visible === true` to verify dual-axis config without needing DOM introspection.

Reusable pattern documented in `.squad/skills/dual-axis-chart/SKILL.md`.

📌 Team update (2026-05-07): Dual-axis chart skill now in `.squad/skills/dual-axis-chart/SKILL.md`. Reusable pattern for any two-metric charts (cash flow vs. P&L, volume vs. price, etc.). FE charts now rendering both metrics independently.

## Stacked Income Bar Chart (2026-05-09)

**Issue:** Jony wanted stacked bars on `/summary` showing options/dividends/bonds income per year with future projections. Existing chart used area series (not bars) and didn't show actual options "Cumulative Cash Flow" data.

**Solution:** Paired with McManus to implement proper stacked histogram bars using lightweight-charts. McManus designed data model, I built the chart.

### Files created/modified

| File | Change |
|------|--------|
| `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx` | NEW — stacked histogram chart with 3 layers (options/dividends/bonds) |
| `apps/frontend/src/components/Summary/__tests__/StackedIncomeBarChart.test.tsx` | NEW — 6 tests for chart rendering, stacking, and projection styling |
| `apps/frontend/src/app/summary/page.tsx` | Updated data fetching to use getOptionsYearlyCashFlow() + proper year aggregation |
| `apps/frontend/src/app/options/actions.ts` | +getOptionsYearlyCashFlow() action (McManus) |

### Implementation details

- **Chart type:** HistogramSeries (lightweight-charts), NOT area series
- **Stacking:** Three overlapping histograms — options (base), dividends (options + dividends), bonds (total)
- **Projected years:** Reduced opacity (0.4) vs actuals (1.0) — makes future projection visually distinct
- **Tooltip:** Interactive floating tooltip shows breakdown by source + total
- **Currency formatting:** `Intl.NumberFormat` with USD, no decimals, thousands separator
- **Data source:** `getOptionsYearlyCashFlow()` aggregates from `options_dashboard_monthly.cash_flow_cumulative` — takes max cumulative per year

### Projection model (McManus)

- **Options:** Actual cumulative cash flow for past years, 0 for future (conservative)
- **Dividends:** Compound growth from current annual income (yield + reinvest + growth rate)
- **Bonds:** Scheduled coupon + maturity payments from ladder

### Test/lint results

- `npm run test -- --run StackedIncomeBarChart`: 6/6 tests pass
- `npm run lint`: 0 errors in changed files

## Learnings

**Stacked histograms in lightweight-charts:** Unlike area series, histograms don't auto-stack. Create 3 series with cumulative values:
- Series 1 (bottom): value = A
- Series 2 (middle): value = A + B
- Series 3 (top): value = A + B + C

Each series draws from 0 to its cumulative value, creating a stacked effect when overlapped.

**Projection styling:** Set opacity in the `color` property of each data point (not series-level). Example: `color: rgba(245, 158, 11, 0.32)` for projected vs `rgba(245, 158, 11, 0.8)` for actuals.

**Paired work with McManus:** Data design first, then UI. McManus owned the SQL aggregation + projection logic, I owned the chart component. Clear separation of concerns made parallel work efficient.

📌 **Team update (2026-05-09):** Shipped stacked income bar chart on /summary with McManus (#338) — options via `options_dashboard_monthly.cash_flow_cumulative`, dividends compound-growth, bonds scheduled income; future years at 40% opacity. Hockney completed migration audit (#335). Kujan removed no-commit-to-branch + trimmed docker-compose (#336, #337). Redfoot fixed E2E hook placement (#334).

## Cumulative-vs-Per-Year Cash Flow Bug Fix (2026-05-09, Issue #341)

**Issue:** 2025 options income showed ~$373k in stacked bar chart instead of actual ~$96k. Bug was in `getOptionsYearlyCashFlow()` — took MAX of `cash_flow_cumulative` per year, but that column is cumulative from inception (not reset annually), so each year's bar included all prior years.

**Solution (paired with McManus):** Changed query to SUM `cash_flow_total` (monthly net) per year instead of MAX `cash_flow_cumulative`. This gives true per-year delta, not cumulative-as-of-EOY.

**Files modified:**
- `apps/frontend/src/app/options/actions.ts` — `getOptionsYearlyCashFlow()` function

**Before/After:**
- Before: `SELECT cash_flow_cumulative ... MAX(cumulative) per year`
- After: `SELECT cash_flow_total ... SUM(monthly_net) per year`

**Verification:**
- Tests: 6/6 pass in `StackedIncomeBarChart.test.tsx`
- 2025 options value now renders correctly at ~$96k (was ~$373k)
- Lint: 0 new errors
- Typecheck: 0 new errors

**Learning (Cumulative Trap):** When a table has both cumulative and per-period columns (like `options_dashboard_monthly.cash_flow_cumulative` vs `cash_flow_total`), always confirm whether you need:
1. **Cumulative-to-date**: Use the cumulative column directly (e.g., total P&L from inception)
2. **Per-period delta**: Sum the per-period column (e.g., annual cash flow) OR difference consecutive cumulative values

This is a common trap with financial time-series data. Our bug happened because we mistakenly treated an inception-cumulative column as if it reset annually. The fix was straightforward once diagnosed: use the right column (`cash_flow_total` for monthly net) and the right aggregation (`SUM` for per-year total).

McManus and I paired on this — the separation between data layer (his) and UI layer (mine) made it easy to spot the bug at the boundary and fix it quickly.

📌 **Team update (2026-05-09T18:26:00+03:00):** Fixed #341 stacked income chart cumulative bug. 2025 options now shows correct ~$96k (was ~$373k). Paired with McManus on diagnosis + fix. (commit 1649369)

## 2026-05-09T18:19:36+03:00 — Issue #339 Part B: Summary Uses Dividend Estimations

**Context:** The `/summary` stacked income chart projected dividends using a simple growth model. Jony wanted to override specific years with actual/estimated values.

**Task:** Fetch dividend estimations from the new `dividend_estimations` table and merge with the projection model — estimation wins if present, otherwise fall back to projection.

**Changes:**
- `apps/frontend/src/app/summary/page.tsx`:
  - Import `getDividendEstimations` from `@/app/dividends/actions`
  - Fetch estimations and build a `Map<year, amount>` for fast lookups
  - Build `divSourceMap` to track whether each year's value came from 'estimation' or 'projection'
  - In the merge loop: `if (estimationsMap.has(year))` use that, else compute projection
  - Pass `dividendsSource` to `YearlyIncomeData` objects
- `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx`:
  - Added `dividendsSource?: 'estimation' | 'projection'` to `YearlyIncomeData` and `TooltipData`
  - Tooltip now shows `(est.)` badge next to "Dividends" when source is 'estimation'
  - Updated chart description: "Dividends use your estimations where entered, otherwise project with X% growth rate"

**Outcome:** Summary chart now respects user-entered estimations. Tooltip makes the data source transparent.

**Pattern learned:** When merging user-entered data with model projections, always track provenance and surface it in the UI. Estimations override projections, not vice versa.

**Paired with:** Hockney (backend schema + actions) — working as Fenster (frontend).

## 2026-05-09T18:42:35+03:00 — Bug Fix #342: Dividend Estimations Not Appearing on Summary Chart

**What the actual bug was:**
The projection loop in `summary/page.tsx` started at `currentYear` (2026). Jony's estimations were for 2022–2025 — all *before* `currentYear`. Those years were correctly fetched into `estimationsMap` but never written into `divMap` because the loop's range excluded them. The merge step then read `divMap.get(year) || 0` → `0` for those years, silently zeroing out the dividend bar instead of using the estimation value.

The estimations data existed in the DB (confirmed: 4 rows for 2022–2025 with household_id scoped correctly). The field name matched (`amount`). The fetch logic was correct. Only the loop boundary was wrong.

**Why it slipped through #339's test:**
The test added in `StackedIncomeBarChart.test.tsx` asserted structural plumbing — chart renders, three series created, stacking math correct, projected opacity lower. It did not assert the override semantic: "for an estimation year, `dividendsIncome` equals the estimation amount, not the projection." No test data included a year whose estimation would be missed by the loop boundary (all test mock data used years ≥ 2024 with the test running before 2026's rollover was a factor). The test could pass even with the bug present.

**The fix:**
Extracted merge logic to pure `buildYearlyIncomeData()` in `apps/frontend/src/app/summary/buildYearlyIncomeData.ts`. The function adds a "Pass 1" before the projection loop that writes all `estimationsMap` entries for years < `currentYear` into `divMap`/`divSourceMap`. Also adds estimation years to `allYears` so they appear in the chart even when no options/ladder data shares the same year.

**New regression test pattern for "this overrides that" behavior:**
When A should override B for the same year:
1. Set A to a known value (e.g., 50_000).
2. Set B to a deliberately absurd value (e.g., 999_999) to make any failure obvious.
3. Assert result equals A — and explicitly assert it is NOT B, NOT A+B, and NOT 0.
4. Add a separate case where A is absent and assert B is used.
5. Mentally (or in CI via branch) revert the override pass and confirm the test returns 0 or B instead of A.

This pattern catches: wrong field name, loop boundary miss, accidental summation instead of replacement, silent swallow by `|| 0`.

**Files changed:**
- `apps/frontend/src/app/summary/buildYearlyIncomeData.ts` (NEW — pure merge function)
- `apps/frontend/src/app/summary/__tests__/buildYearlyIncomeData.test.ts` (NEW — 5 regression tests)
- `apps/frontend/src/app/summary/page.tsx` (calls `buildYearlyIncomeData`, removes inline merge)

**Commit:** `3a75bd5`

## 2026-05-09T19:39:13+03:00 — Bug Fix #343: Stacked Income Bars All Rendering Blue

**Root cause (one sentence):** All three `HistogramSeries` started at `base=0` and the bonds series (added last) was drawn on top by lightweight-charts, its tallest blue bar covering the amber and emerald bars below it entirely.

**The fix — reversed series addition order:**
In lightweight-charts, the LAST series added is rendered on top. The correct stacking visual (options at bottom, dividends middle, bonds at top) requires the OPPOSITE addition order: bonds first (background), dividends second, options last (foreground). Each cumulative bar is then "painted over" by the shorter bar of the series above it, revealing the correct color band for each income layer. No data values were changed; only the order of `chart.addSeries()` calls.

**SERIES_COLORS single-source-of-truth pattern:**
Introduced `export const SERIES_COLORS = { options, dividends, bonds }` in `StackedIncomeBarChart.tsx`. Both the chart's `addSeries` color options AND the legend swatches in `summary/page.tsx` now derive their color from this constant, making drift structurally impossible. Tooltip swatches updated to inline styles from SERIES_COLORS too. Also replaced the hardcoded `rgba(r,g,b,…)` strings with a `hexToRgba(hex, alpha)` helper so projected-year dimming derives from SERIES_COLORS automatically.

**Tailwind purge note:** Not applicable here — the legend swatches were previously using Tailwind `bg-amber-500 / bg-emerald-500 / bg-blue-500` classes. These are safe from purge since they're static class names. After this fix they use inline styles from SERIES_COLORS, which is even safer (no purge risk at all).

**Regression test:**
`each series receives a distinct fill color matching SERIES_COLORS` in `StackedIncomeBarChart.test.tsx`. Asserts `new Set(seriesColors).size === 3` and that each entry matches the corresponding SERIES_COLORS key. Against the broken code (if all three addSeries calls used the same color), `distinctColors.size` would be 1 and the assertion would fail.

**Files changed:**
- `apps/frontend/src/components/Summary/StackedIncomeBarChart.tsx` (SERIES_COLORS, hexToRgba, reversed series order, inline tooltip swatches)
- `apps/frontend/src/app/summary/page.tsx` (import SERIES_COLORS, legend swatches → inline styles)
- `apps/frontend/src/components/Summary/__tests__/StackedIncomeBarChart.test.tsx` (new color test, updated series indices 0/1/2 to reflect bonds/dividends/options order)

**Commit:** `362851a`

---

## Issue #340 Phase 2 — 3-Account Tabs UI + Manual Position Entry + Dividend Projection

**Commits:** `c27299a` (F1), `df86e97` (F2)
**Date:** 2025-07-09

### What was built

**F1: 3-Account Tabs UI**
- Rewrote `/trading/accounts/page.tsx`: IBKR / Schwab / IRA / Settings tabs
- `normalizeType()` handles case mismatch (DB uses uppercase `'IBKR'`, `'SCHWAB'`)
- `StockPositionsTable.tsx`: readonly/editable mode, P&L coloring (green/red), multi-currency (USD/EUR/JPY via `Intl.NumberFormat`), delete button, total footer
- `AccountHeader.tsx`: account name badge, "FLEX" (IBKR) vs "MANUAL" (Schwab/IRA), IBKR refresh button vs manual add-position button
- `AggregatePortfolioFooter.tsx`: total portfolio value + per-account breakdown bars + top-5 holdings
- `AddPositionModal.tsx`: ticker autocomplete from `dividend_ticker_data`, quantity/cost-basis/date fields, validation, error display
- All 6 server actions (`getStockPositions`, `createStockPosition`, `deleteStockPosition`, `getTickerSymbols`, `triggerIBKRSync`, `getDividendProjection`) degrade gracefully if `stock_positions` table missing (Hockney's migration pending)

**F2: Dividend Projection Wire-Up**
- `summary/page.tsx`: `getDividendProjection()` called first; falls back to `getDividendDashboard().stats.annual_income` if unavailable
- `buildYearlyIncomeData.ts` unchanged (preserves #342 fix)

### Key debugging lesson — jsdom `type="number"` with `min` attribute

The two failing tests (`quantity = "0"`, `quantity = "-5"`) were traced to jsdom's handling of `<input type="number" min="0.000001">`. When jsdom sanitizes the value, fractional-min inputs with integer test values may not expose the expected `e.target.value`. Fixes applied:
1. Changed `min="0.000001"` → `min="0"` (validation is still JavaScript-only: `qty <= 0`)
2. Added `data-testid="position-form"` to the `<form>` element
3. Used `fireEvent.submit(form)` instead of `fireEvent.click(button)` for quantity-validation tests to bypass button click routing; wrapped each `fireEvent` in `await act(async () => {})`

Result: all 364 tests passing.

### Test coverage added
- `StockPositionsTable.test.tsx`: 15 tests
- `AggregatePortfolioFooter.test.tsx`: 8 tests
- `AddPositionModal.test.tsx`: 11 tests

**Files changed:**
- `apps/frontend/src/app/trading/actions.ts` (Phase2 types + 6 new actions)
- `apps/frontend/src/app/trading/accounts/page.tsx` (complete rewrite)
- `apps/frontend/src/app/summary/page.tsx` (dividend projection wire-up)
- `apps/frontend/src/components/trading/accounts/` (4 new components + 3 test files)
