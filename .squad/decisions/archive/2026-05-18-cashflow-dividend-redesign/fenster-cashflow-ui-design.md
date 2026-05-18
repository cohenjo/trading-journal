# Cash Flow Page UI Enhancement — Frontend Design
**Author:** Fenster (Frontend Dev)
**Date:** 2026-05-18
**Requested by:** Jony Vesterman Cohen

## Overview

This document outlines the frontend design for two enhancements to `/app/cash-flow/page.tsx`:
1. **Monthly/Yearly toggle** — allows users to view cash flow values divided by 12 for monthly comparison
2. **Per-account dividend flows in Sankey** — splits dividend income and reinvestment into 3 account-specific nodes (IBKR, Schwab, IRA)

---

## 1. Monthly/Yearly Toggle Component Design

### Location & Visual Design
**Placement:** Directly to the right of the year display (line 139-147 in current `page.tsx`), inline with the header section.

**JSX Structure (pseudocode):**
```tsx
<div className="flex justify-between items-end mb-6">
  <div>
    <h1>Cash Flow Analysis</h1>
    <p className="text-slate-400 mt-1">Visualize income, expenses, and savings flow</p>
  </div>
  <div className="flex flex-col items-end gap-3">
    <div className="text-3xl font-mono text-slate-100 font-bold">{selectedYear}</div>
    <div className="flex items-center gap-3 text-slate-400 text-sm">
      <span>Age {primaryAge}</span>
      {spouseAge && <span className="opacity-60">Spouse {spouseAge}</span>}
    </div>
    {/* NEW: Toggle Component */}
    <div className="flex items-center gap-2 bg-slate-900/60 rounded-lg border border-slate-700 p-1">
      <button
        onClick={() => setDisplayMode('yearly')}
        className={cn(
          "px-3 py-1.5 text-xs font-semibold rounded transition-all",
          displayMode === 'yearly'
            ? "bg-emerald-600 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-300"
        )}
        aria-pressed={displayMode === 'yearly'}
      >
        Yearly
      </button>
      <button
        onClick={() => setDisplayMode('monthly')}
        className={cn(
          "px-3 py-1.5 text-xs font-semibold rounded transition-all",
          displayMode === 'monthly'
            ? "bg-emerald-600 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-300"
        )}
        aria-pressed={displayMode === 'monthly'}
      >
        Monthly
      </button>
    </div>
  </div>
</div>
```

**Style:**
- Pill toggle with slate-900/60 background, slate-700 border
- Active state: emerald-600 bg (matches gradient header), white text, subtle shadow
- Inactive state: slate-400 text, hover to slate-300
- Small size (`text-xs`, `px-3 py-1.5`) to avoid dominating the header
- Positioned below age display for visual hierarchy

### State Management
**Recommendation:** Use **local useState** in `CashFlowPage` — **NOT** SettingsContext.

**Rationale:**
- Display mode is a **view preference**, not a financial parameter like `mainCurrency` or `dividendReinvestRate`
- Cash flow toggle doesn't need to persist across sessions or affect other pages
- Keeps SettingsContext clean — only global financial settings belong there
- Default state: `'yearly'` (no breaking change)

**Implementation:**
```tsx
type CashFlowDisplayMode = 'yearly' | 'monthly';
const [displayMode, setDisplayMode] = useState<CashFlowDisplayMode>('yearly');
```

### Accessibility
- `aria-pressed` attribute on both buttons (true for active, false for inactive)
- Keyboard-accessible: native `<button>` elements respond to Enter/Space
- Clear focus states via Tailwind focus ring utilities (add `focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950`)
- Screen reader announces "Yearly, pressed" or "Monthly, not pressed"

### Value Transformation
**Where divide-by-12 happens:** At **render time** in the parent component (`CashFlowPage`), before passing data to child components.

**Anti-pattern:** Mutating `projection` state array or passing a raw `displayMode` prop to 20 child components.

**Correct pattern:** Derive a `displayData` object from `selectedData` using `useMemo`:

```tsx
const displayData = useMemo(() => {
  if (!selectedData) return null;
  if (displayMode === 'yearly') return selectedData;

  // Monthly: divide all monetary values by 12
  return {
    ...selectedData,
    income: (selectedData.income || 0) / 12,
    withdrawals: (selectedData.withdrawals || 0) / 12,
    expenses: selectedData.expenses / 12,
    tax_paid: (selectedData.tax_paid || 0) / 12,
    income_details: selectedData.income_details?.map(item => ({
      ...item,
      value: item.value / 12,
    })),
    expense_details: selectedData.expense_details?.map(item => ({
      ...item,
      value: item.value / 12,
    })),
    savings_details: selectedData.savings_details?.map(item => ({
      ...item,
      value: item.value / 12,
    })),
    withdrawal_details: selectedData.withdrawal_details?.map(item => ({
      ...item,
      value: item.value / 12,
    })),
  };
}, [selectedData, displayMode]);
```

Then pass `displayData` to `<CashFlowSankey>` and reference it in summary cards. The `valueFormat` callback in the Sankey already handles formatting — no changes needed there.

---

## 2. Sankey Diagram — Per-Account Dividend Flows

### Current Structure (Before)
`CashFlowSankey.tsx` renders a 5-stage flow:
1. Income sources (salary, pension, etc.) → Income types (Employment, Investment Income, etc.)
2. Income types → **Inflows** (single aggregated node)
3. Inflows → Allocations (Tax, Living Expenses, Net Savings)
4. Living Expenses → Expense categories (Housing, Transportation, etc.)
5. Net Savings → Savings destinations (IBKR, Schwab, IRA, Cash)

**Current limitation:** Dividend income arrives as a single aggregated `{ name: "Dividend Income", type: "Investment Income", value: 9200 }` entry in `income_details`. Reinvestment is not tracked separately.

### Proposed Structure (After)
Expand the Sankey to show **3 dividend income sources** and **3 reinvestment sinks**:

#### Stage 1-2: Dividend Income Sources
Add 3 new source nodes:
- `income_src_Dividend: IBKR` (emerald `#34d399`)
- `income_src_Dividend: Schwab` (emerald `#34d399`)
- `income_src_Dividend: IRA` (emerald `#34d399`)

These flow into the existing `income_type_Investment Income` node (teal `#2dd4bf`), which then flows into `node_Inflows`.

#### Stage 5: Reinvestment Outflows
Add 3 new sink nodes (after `node_Investments` aka "Net Savings"):
- `reinvest_dest_IBKR` (indigo `#6366f1` with 20% brightness boost → `#7c7ef8`)
- `reinvest_dest_Schwab` (indigo `#6366f1` with 20% brightness boost → `#7c7ef8`)
- `reinvest_dest_IRA` (indigo `#6366f1` with 20% brightness boost → `#7c7ef8`)

**Naming convention to avoid ID collision:**
- Income source: `income_src_Dividend: {AccountName}`
- Reinvestment destination: `reinvest_dest_{AccountName}`
- This ensures no collision with existing `save_dest_IBKR` nodes (regular contributions)

**Color rationale:**
- Dividend sources: emerald (matches existing income palette)
- Reinvestment destinations: slightly brighter indigo (`#7c7ef8` instead of `#6366f1`) to distinguish from regular savings flows while staying in the savings color family

### Data Flow Changes

#### Input to CashFlowSankey
Current prop signature:
```tsx
interface Props {
  data: any; // projection item for specific year
  currency: string;
}
```

**No change needed** — but the `data` object must now include per-account dividend details in `income_details` and reinvestment flows in `savings_details`.

#### Data Structure from Backend (Keaton's contract)
Keaton's simulation output (in `runPlanSimulation` → `simulation.ts`) must provide per-account breakdown. Current contract:
```ts
{
  income_details: [
    { name: "Dividend Income", type: "Investment Income", value: 9200 }
  ]
}
```

**Proposed contract (Keaton to implement):**
```ts
{
  income_details: [
    { name: "Dividend: IBKR", type: "Investment Income", value: 3200, account: "ibkr" },
    { name: "Dividend: Schwab", type: "Investment Income", value: 4500, account: "schwab" },
    { name: "Dividend: IRA", type: "Investment Income", value: 1500, account: "ira" }
  ],
  savings_details: [
    // ... existing contributions ...
    { name: "Reinvest: IBKR", type: "Dividend Reinvestment", value: 2560, account: "ibkr" }, // 80% of IBKR dividend
    { name: "Reinvest: Schwab", type: "Dividend Reinvestment", value: 3600, account: "schwab" },
    { name: "Reinvest: IRA", type: "Dividend Reinvestment", value: 1200, account: "ira" }
  ]
}
```

**Calculation logic (Keaton's domain):**
- `getDividendSummary()` already returns `by_account: { ibkr: X, schwab: Y, ira: Z }`
- Reinvestment amount per account = `account_dividend * settings.dividendReinvestRate` (default 0.8)
- Net cash dividend = `account_dividend * (1 - dividendReinvestRate)` (flows to `income_details`, not reinvestment)

#### Frontend Consumption (Fenster)
`CashFlowSankey.tsx` already iterates `income_details` and `savings_details` to build nodes/links. **No structural change** — the new entries will automatically render if named correctly.

**Edge case handling:**
- If an account has $0 forward dividend (e.g., `by_account.ibkr === 0`), Keaton should **omit** that entry from `income_details` and `savings_details` (don't emit a 0-value node). The Sankey already filters links with `value < 0.01` (line 50 in current `CashFlowSankey.tsx`).
- This keeps the diagram clean when one account has no dividend activity.

---

## 3. Summary Cards — Monthly Annotation

**Current cards (lines 174-200):**
- Total Inflow
- Spending
- Taxes
- Net Savings

**Change:** Add a label suffix when `displayMode === 'monthly'`.

**JSX pseudocode:**
```tsx
<div className="bg-slate-900/80 p-4 rounded-lg border border-slate-800">
  <span className="text-xs text-slate-500 uppercase font-semibold">
    Total Inflow{displayMode === 'monthly' && ' / mo'}
  </span>
  <div className="text-xl font-mono text-emerald-400 mt-1">
    {formatCurrency((displayData.income || 0) + (displayData.withdrawals || 0))}
  </div>
</div>
```

**Alternative:** Instead of `/ mo`, show a small badge:
```tsx
<span className="text-xs text-slate-500 uppercase font-semibold flex items-center gap-2">
  Total Inflow
  {displayMode === 'monthly' && (
    <span className="px-1.5 py-0.5 bg-emerald-600/20 text-emerald-400 rounded text-[10px] font-mono">
      MONTHLY
    </span>
  )}
</span>
```

**Recommendation:** Use the badge approach — visually clearer and consistent with existing "est." badge pattern in `DividendPositionsTable`.

---

## 4. Per-Account Dividend Data Flow

### Backend Contract (Keaton's domain)
Keaton must extend `runPlanSimulation` in `apps/frontend/src/app/plan/simulation.ts`:

**Current input:**
```ts
dividendTotal?: DividendIncomeTotal; // { annualTotal: number }
```

**Proposed input (backward-compatible):**
```ts
dividendTotal?: {
  annualTotal: number; // kept for backward compat
  by_account?: {
    ibkr: number;
    schwab: number;
    ira: number;
  };
};
```

When `by_account` is present, simulation should:
1. Distribute dividend income into 3 separate `income_details` entries (per-account)
2. Calculate reinvestment per account using `settings.dividendReinvestRate`
3. Add 3 `savings_details` entries for reinvestment flows
4. Net cash dividend (non-reinvested portion) remains part of `income` for spending

**Fallback:** If `by_account` is missing, current behavior (single aggregated dividend) is preserved.

### Frontend Call Site (`cash-flow/page.tsx`)
Current code (lines 26-36):
```ts
getDividendSummary().then(data => {
  setDividendTotal({ annualTotal: data.total_forward_annual });
});
```

**No change needed** — `getDividendSummary()` already returns `by_account`. The simulation will consume it directly when Keaton updates the contract.

**Optional enhancement:** If the frontend wants to display per-account totals in a tooltip or sub-header, the data is available in `dividendTotal.by_account`.

---

## 5. Plan Page Implications

**Context:** `/app/plan/page.tsx` (PlanEditor) has dividend controls per account (yield, growth rate, reinvestment rate).

**Current UI:** Three editable sections for IBKR, Schwab, IRA dividend policies (user-entered).

**Problem:** With the new flow, dividend income is **auto-calculated from real positions** via `getDividendSummary()`. User-entered dividend policies in the plan editor are **overridden** by live data.

### Recommendation: **Replace with "Auto from real positions" indicator**

**Design:**
1. Remove editable dividend inputs (yield %, growth %, reinvestment %) from the plan editor.
2. Replace with a **read-only banner** showing the live dividend total per account:

```tsx
<div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-4 mb-6">
  <div className="flex items-start gap-3">
    <div className="text-emerald-400 text-2xl">✓</div>
    <div className="flex-1">
      <h3 className="text-emerald-300 font-semibold mb-2">Dividend Income (Auto-calculated)</h3>
      <p className="text-slate-400 text-sm mb-3">
        Dividend projections are automatically derived from your current stock positions.
      </p>
      <div className="grid grid-cols-3 gap-4 text-xs font-mono">
        <div>
          <span className="text-slate-500">IBKR:</span>
          <span className="text-emerald-400 ml-2">${dividendTotal.by_account.ibkr.toLocaleString()}/yr</span>
        </div>
        <div>
          <span className="text-slate-500">Schwab:</span>
          <span className="text-emerald-400 ml-2">${dividendTotal.by_account.schwab.toLocaleString()}/yr</span>
        </div>
        <div>
          <span className="text-slate-500">IRA:</span>
          <span className="text-emerald-400 ml-2">${dividendTotal.by_account.ira.toLocaleString()}/yr</span>
        </div>
      </div>
    </div>
  </div>
</div>
```

3. Add a small info icon with tooltip: "Want to adjust? Update your positions on the Dividends page."

**Rationale:**
- Eliminates confusion: user can't edit a value that's auto-calculated
- Shows live data transparency
- Directs users to the source-of-truth page (`/dividends`) for changes

**Alternative (not recommended):** Keep the editable fields but gray them out with a "locked" icon. This is more confusing — users will try to unlock them.

---

## 6. TypeScript Types & Interfaces

### New Type: `CashFlowDisplayMode`
**File:** `apps/frontend/src/app/cash-flow/page.tsx` (local to component)

```ts
type CashFlowDisplayMode = 'yearly' | 'monthly';
```

**Rationale:** Not shared across pages — no need to export to a central types file. If other pages need this pattern later, refactor to `@/types/cash-flow.ts`.

### Updated Type: `DividendIncomeTotal` (if Keaton extends contract)
**File:** `apps/frontend/src/app/plan/simulation.ts` (already exists, line 26-37)

```ts
export interface DividendIncomeTotal {
  annualTotal: number; // USD, forward annual
  by_account?: {
    ibkr: number;
    schwab: number;
    ira: number;
  };
}
```

**Backward-compatible:** `by_account` is optional. Existing code that only reads `annualTotal` continues to work.

### No changes to:
- `DividendSummaryResult` (already has `by_account`, line 50-54 in `@/types/dividends.ts`)
- `CashFlowSankey` props (still accepts `data: any` — no breaking change)

---

## 7. Test Surfaces (for Redfoot)

### Component: CashFlowPage (`apps/frontend/src/app/cash-flow/__tests__/page.test.tsx`)
1. **Toggle interaction:**
   - Click "Monthly" → summary cards show values / 12
   - Click "Yearly" → summary cards show full annual values
   - Default state is "Yearly" on mount
   - `aria-pressed` is correctly set on active button

2. **Monthly view calculations:**
   - Given `selectedData.income = 120000`, monthly shows `$10,000`
   - Given `selectedData.expenses = 60000`, monthly shows `$5,000`
   - Verify all 4 summary cards divide by 12
   - Verify Sankey receives divided values (check `displayData` prop)

3. **Edge cases:**
   - Empty projection → no toggle shown (existing empty state CTA)
   - Zero values → monthly shows $0 (not undefined)

### Component: CashFlowSankey (`apps/frontend/src/components/CashFlow/__tests__/CashFlowSankey.test.tsx`)
4. **Per-account dividend nodes:**
   - Given `income_details` with 3 "Dividend: {account}" entries → 3 source nodes render
   - Given `savings_details` with 3 "Reinvest: {account}" entries → 3 sink nodes render
   - Node IDs don't collide (`income_src_Dividend: IBKR` ≠ `save_dest_IBKR`)

5. **Zero-value account filtering:**
   - Given `income_details` with only 2 accounts (IBKR, Schwab) → only 2 dividend nodes render (IRA omitted)
   - Links with `value < 0.01` are filtered (existing behavior, verify preserved)

6. **Color differentiation:**
   - Dividend source nodes have color `#34d399` (emerald)
   - Reinvestment destination nodes have color `#7c7ef8` (bright indigo)
   - Regular savings destination nodes have color `#6366f1` (standard indigo)

### Integration: Full flow
7. **Plan → Simulation → Cash flow:**
   - Mock `getDividendSummary()` returning `by_account: { ibkr: 3000, schwab: 4500, ira: 1500 }`
   - Mock `runPlanSimulation()` to generate `income_details` with 3 dividend entries
   - Verify Sankey renders 3 dividend sources and 3 reinvestment destinations
   - Verify monthly toggle divides all 6 values correctly

---

## 8. Edge Cases

### Empty dividend account (e.g., IBKR has 0 forward)
**Scenario:** `getDividendSummary()` returns `{ by_account: { ibkr: 0, schwab: 4500, ira: 1500 } }`

**Handling:**
- Keaton's simulation should **omit** IBKR from `income_details` and `savings_details` (don't emit 0-value entries)
- Sankey filters links with `value < 0.01` (line 50) → no orphaned nodes
- Frontend doesn't need special handling — existing filter covers this

### Sankey looking lopsided with 3 reinvest nodes when one is 0
**Scenario:** User has dividends but sets `dividendReinvestRate = 0` (all dividends to cash)

**Handling:**
- Keaton's simulation should emit **no reinvestment entries** when reinvestment amount is 0
- Sankey will only show dividend income sources, no reinvestment sinks
- Result: clean diagram (no empty/orphaned nodes)

### Currency mismatch (dividend totals in USD, mainCurrency is ILS)
**Current behavior:** `getDividendSummary()` already converts all positions to USD via `convertCurrency()` (line 1223 in `actions.ts`).

**Cash flow page behavior:**
- Summary cards format values using `settings.mainCurrency` (line 179: `currency: settings.mainCurrency || 'USD'`)
- If `mainCurrency = 'ILS'`, the formatter will display ₪ symbols and convert USD values to ILS (via `Intl.NumberFormat` locale awareness)

**Problem:** `convertCurrency()` is a **read-time FX approximation**, not live FX rates. If the user's `mainCurrency` is ILS, displaying dividend totals (sourced in USD) may show stale conversion.

**Mitigation:**
1. Document in code comments that dividend aggregation is always in USD (matches existing pattern for `total_forward_annual`)
2. If `mainCurrency !== 'USD'`, show a subtle info tooltip: "Values converted from USD positions using approximate FX rates"
3. **Do not** attempt real-time FX conversion in the cash flow page — that's a backend concern

**Long-term fix (Keaton's domain):** Store `forward_dividend_annual` in each position's native currency, aggregate in USD, then provide per-currency breakdowns. Out of scope for this design.

### Monthly view on a leap year
**Non-issue:** Dividing annual values by 12 is always approximate (months have different lengths). This is a UX trade-off for simplicity. No special handling needed.

### Reinvestment rate > 100% or < 0%
**Current constraints:** `SettingsContext` has no validation on `dividendReinvestRate`. If the user manually edits localStorage or sets an invalid value, Keaton's simulation could generate negative or >100% reinvestment.

**Handling:**
- Keaton should clamp `dividendReinvestRate` to `[0, 1]` when calculating reinvestment amounts
- Frontend displays whatever the simulation returns — no validation layer
- **Out of scope:** Add SettingsContext validation (separate issue)

---

## Implementation Checklist (for implementation PR)

### Frontend (Fenster)
- [ ] Add `CashFlowDisplayMode` type and `displayMode` state to `CashFlowPage`
- [ ] Implement toggle UI component (2 buttons, pill style, emerald active state)
- [ ] Add `aria-pressed` and focus ring styles for accessibility
- [ ] Create `displayData` useMemo that divides by 12 when mode is 'monthly'
- [ ] Update summary cards to show "/ mo" badge when monthly
- [ ] Pass `displayData` instead of `selectedData` to `<CashFlowSankey>`
- [ ] Update `CashFlowSankey` to handle per-account dividend node naming (no code change, just verify)
- [ ] Replace plan page dividend controls with "Auto from real positions" banner
- [ ] Add color constants for reinvestment nodes (`#7c7ef8`)

### Backend (Keaton)
- [ ] Extend `DividendIncomeTotal` interface with optional `by_account` field
- [ ] Update `runPlanSimulation()` to generate per-account `income_details` entries
- [ ] Calculate reinvestment per account using `dividendReinvestRate`
- [ ] Add 3 `savings_details` entries for dividend reinvestment flows
- [ ] Omit 0-value accounts from output (don't emit entries when dividend is 0)
- [ ] Clamp `dividendReinvestRate` to `[0, 1]` in calculations

### Tests (Redfoot)
- [ ] Test monthly toggle interaction and aria-pressed state
- [ ] Verify monthly calculations (all values / 12)
- [ ] Test per-account dividend node rendering (3 sources + 3 sinks)
- [ ] Test 0-value account omission (no orphaned nodes)
- [ ] Test color differentiation (dividend vs reinvestment)
- [ ] Integration test: full flow from `getDividendSummary` → Sankey render

---

## Open Questions (for Jony)

1. **Default toggle state:** Should monthly/yearly preference persist in localStorage for future sessions? (Current design: does not persist, always defaults to yearly)
2. **Reinvestment naming:** Is "Reinvest: IBKR" clear, or prefer "IBKR Dividend Reinvestment"? (Longer name may cause Sankey label overlap)
3. **Plan page controls:** Confirm removal of editable dividend inputs — is this acceptable UX, or should we keep them with a "locked" state?
4. **Options income:** Should the monthly toggle also apply to options income in the Sankey, or only dividends? (Current design: applies to all income/expense, including options)

---

**End of Design Document**
