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
