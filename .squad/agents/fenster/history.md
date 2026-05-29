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
