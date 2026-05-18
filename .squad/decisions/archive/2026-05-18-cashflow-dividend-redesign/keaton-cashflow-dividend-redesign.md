# Cash Flow Dividend Redesign

**Author:** Keaton (Lead)
**Date:** 2025-01-28
**Status:** Design

## Summary

This document outlines the architecture for three cash flow page improvements:

1. **Monthly/Yearly Toggle** — Display financial data in monthly or annual views
2. **Real Dividend Data** — Replace plan-page-configured dividend yields with actual per-account dividend income from `getDividendSummary()`
3. **Dividend Reinvestment** — Show per-account dividend reinvestment as both income and corresponding outflow in the Sankey visualization

The changes primarily impact `simulation.ts`, `cash-flow/page.tsx`, and `CashFlowSankey.tsx`. No backend/worker changes are required.

---

## 1. Data Contract Changes

### Current State: `DividendIncomeTotal`

```typescript
// apps/frontend/src/app/plan/simulation.ts:35
interface DividendIncomeTotal {
  annualTotal: number;  // Single aggregate value
}
```

### Proposed: `DividendIncome`

```typescript
interface DividendIncome {
  ibkr: number;
  schwab: number;
  ira: number;
  total?: number;  // Optional convenience field (sum of above)
}
```

**Contract:**
- All values in USD, major units (no ÷100 needed per Round 8 currency decision)
- Aligns with `DividendSummaryResult.by_account` structure from `getDividendSummary()` (dividends/actions.ts:1211)
- `total` is optional and redundant but may reduce repeated summation in UI code

**Migration:**
- Cash flow page currently passes `dividendTotal: DividendIncomeTotal` to `runPlanSimulation()`
- Change signature to `dividendIncome: DividendIncome`
- Update `useState` in cash-flow/page.tsx line 18
- Update plan page's `setDividendTotal()` call (plan/page.tsx:42) to emit per-account structure

---

## 2. Simulation Engine Changes

### 2.1 Disable Yield-Driven Dividend Calculation

**Current behavior:**
- `AccountManager.processGrowthAndIncome()` (lines 542-589) computes dividends from account-level configuration:
  - `dividend_policy: 'Accumulate' | 'Payout'`
  - `dividend_mode: 'yield' | 'fixed'`
  - `dividend_yield: number` (percentage) or `dividend_fixed_amount: number`
- This synthetic dividend logic must be **disabled** for investment accounts (IBKR, Schwab, IRA) to avoid double-counting real dividends

**Proposed change:**
- Add boolean flag `use_real_dividends` to account configuration (or detect implicitly by account type)
- If `use_real_dividends === true`, skip virtual dividend computation in `processGrowthAndIncome()`
- Keep existing logic intact for accounts without real data (e.g., pensions, annuities) for backwards compatibility

**Backwards compatibility:**
- Existing plan configurations rely on `dividend_yield` and `dividend_fixed_amount` settings
- Must not break plans for accounts that don't yet have real dividend data
- Solution: Only disable synthetic dividends for accounts where `getDividendSummary()` returns non-zero by_account values
- This requires passing real dividend data into simulation as input (see next section)

### 2.2 Inject Real Dividend Income

**Current approach (line 882-896):**
- Virtual dividend income injected as single entry:
  ```typescript
  {
    name: 'Dividend Income',
    type: 'dividends',
    gross: dividendTotal.annualTotal,
    tax: 0,
    value: dividendTotal.annualTotal
  }
  ```

**Proposed approach:**
- Emit **three separate income entries** (one per account):
  ```typescript
  {
    name: 'Dividends (IBKR)',
    type: 'dividends',
    subtype: 'ibkr',  // New field for Sankey grouping
    gross: dividendIncome.ibkr,
    tax: 0,
    value: dividendIncome.ibkr
  },
  {
    name: 'Dividends (Schwab)',
    type: 'dividends',
    subtype: 'schwab',
    gross: dividendIncome.schwab,
    tax: 0,
    value: dividendIncome.schwab
  },
  {
    name: 'Dividends (IRA)',
    type: 'dividends',
    subtype: 'ira',
    gross: dividendIncome.ira,
    tax: 0,
    value: dividendIncome.ira
  }
  ```
- Total annual income increases by `dividendIncome.total` (mass conservation check remains valid)

**Tax handling:**
- Dividends are currently modeled with `tax: 0` (line 885)
- If future iterations require withholding tax, add per-account `dividend_tax_rate` to configuration

### 2.3 Emit Dividend Reinvestment Entries

**Current behavior:**
- `processSavings()` (line 600-626) distributes surplus to accounts:
  - Respects `inflow_priority` (1-N ranking)
  - Stops at `savings_goal` threshold
  - Remainder goes to unallocated cash
- Each inflow creates a `savings_details` entry:
  ```typescript
  { name: account.name, value: amount, type: 'Cash' | 'Investment' }
  ```

**Proposed change:**
- Before calling `processSavings()`, emit **three reinvestment entries** (one per account with `dividend_policy: 'Accumulate'`):
  ```typescript
  savings_details.push({
    name: `Dividend Reinvestment (IBKR)`,
    value: dividendIncome.ibkr,
    type: 'Investment',
    subtype: 'dividend_reinvestment'  // For Sankey filtering
  });
  ```
- Apply reinvestment **directly to account balances** in `AccountManager` (before `processSavings()` distributes remaining surplus)
- This ensures:
  - Dividend reinvestment bypasses `inflow_priority` and `savings_goal` limits
  - Sankey shows explicit "income → account" flow for dividends
  - Mass conservation holds: total inflows = salary + bonus + dividends; total outflows = expenses + taxes + savings (including reinvestment)

**Key invariant:**
- Sum of `savings_details.value` must equal net savings (after expenses, taxes)
- Dividend reinvestment increases gross savings but is offset by dividend income increase
- Formula: `totalSavings = (income + dividends) - (expenses + taxes) = traditionalSavings + dividendReinvestment`

### 2.4 Handling Deficits with Dividends

**Open question:** In deficit years, do dividends reduce the deficit before account withdrawals?

**Current behavior:**
- `processDeficit()` (line 628-665) withdraws from accounts by `withdrawal_priority`
- Respects `max_withdrawal_rate` (e.g., 4% for IRA)
- No special handling for income vs. expenses priority

**Proposed semantics (for Jony's decision):**
1. **Option A: Dividends reduce deficit first**
   - Net deficit = `expenses - (salary + dividends)`
   - If net deficit > 0, withdraw from accounts
   - Pro: Minimizes account depletion
   - Con: May not align with actual cashflow behavior (dividends often paid quarterly)

2. **Option B: Deficit withdrawals occur regardless of dividends**
   - Deficit = `expenses - salary`
   - Withdrawals fill deficit
   - Dividends increase account balances simultaneously
   - Pro: More realistic monthly cashflow modeling
   - Con: Higher transient withdrawals (may violate `max_withdrawal_rate`)

**Recommendation:** Implement Option A (dividends reduce deficit) for consistency with annual projection model. Monthly toggle (Requirement 1) is display-only and doesn't affect simulation logic.

---

## 3. UI Changes: Monthly/Yearly Toggle

### Location
- Add toggle component to `cash-flow/page.tsx` above or beside the summary cards (lines 174-199)
- Use Shadcn `ToggleGroup` or `RadioGroup` component for "Monthly" vs "Yearly" selection

### Display Mode Propagation

**Option 1: Pre-multiply values before passing to Sankey**
- Convert all income/expense/savings values to monthly by dividing by 12 in `cash-flow/page.tsx`
- Pass modified data to `CashFlowSankey` component
- Pro: Sankey component remains stateless and unaware of display mode
- Con: Loses precision if values are not evenly divisible by 12

**Option 2: Pass `displayMode` prop to Sankey**
- Add `displayMode: 'monthly' | 'yearly'` prop to `CashFlowSankey` component
- Divide all displayed values by 12 internally during rendering
- Pro: Preserves original annual values in data contracts
- Con: Sankey must track display mode state

**Recommendation:** Implement Option 2 for precision and separation of concerns. Sankey formatting logic is already complex (lines 62-83), adding a simple divisor is minimal cognitive overhead.

### Implementation

```typescript
// cash-flow/page.tsx
const [displayMode, setDisplayMode] = useState<'monthly' | 'yearly'>('yearly');

return (
  <div>
    <div className="flex justify-end mb-4">
      <ToggleGroup type="single" value={displayMode} onValueChange={setDisplayMode}>
        <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
        <ToggleGroupItem value="yearly">Yearly</ToggleGroupItem>
      </ToggleGroup>
    </div>

    <CashFlowSankey
      data={{ income_details, savings_details, withdrawal_details }}
      displayMode={displayMode}
    />

    {/* Summary cards also respect displayMode */}
    <div>Total Income: ${formatCurrency(totalIncome / (displayMode === 'monthly' ? 12 : 1))}</div>
  </div>
);
```

```typescript
// CashFlowSankey.tsx
interface CashFlowSankeyProps {
  data: { income_details, savings_details, withdrawal_details };
  displayMode: 'monthly' | 'yearly';
}

function CashFlowSankey({ data, displayMode }: CashFlowSankeyProps) {
  const divisor = displayMode === 'monthly' ? 12 : 1;

  // Apply divisor when rendering node values and link values
  const displayValue = (value: number) => formatCurrency(value / divisor);

  // ... existing Sankey logic with displayValue() applied to all numeric outputs
}
```

---

## 4. Sankey Visualization Changes

### Current Structure
- **Income nodes:** Salary, Bonus, Other Income, Dividend Income (single)
- **Intermediate node:** "Net Savings"
- **Savings nodes:** Individual accounts (IBKR, Schwab, IRA, etc.)
- **Withdrawal nodes:** (If deficit year)

### Proposed Structure
- **Income nodes:**
  - Salary
  - Bonus
  - Other Income
  - **Dividends (IBKR)** ← New
  - **Dividends (Schwab)** ← New
  - **Dividends (IRA)** ← New

- **Savings flows:**
  - Traditional savings (from salary/bonus) → "Net Savings" → accounts (by `inflow_priority`)
  - **Dividend Reinvestment (IBKR)** → IBKR account (direct edge, bypasses "Net Savings" node)
  - **Dividend Reinvestment (Schwab)** → Schwab account
  - **Dividend Reinvestment (IRA)** → IRA account

### Naming Convention
- **Income nodes:** `"Dividends ({account_name})"`
- **Reinvestment flows:** `"Dividend Reinvestment ({account_name})"` in `savings_details`
- **Account nodes:** Match existing account names (e.g., "IBKR", "Schwab", "IRA")

### Filtering Zero-Value Nodes
- If `dividendIncome.ibkr === 0`, omit "Dividends (IBKR)" node and reinvestment flow
- Prevents visual clutter for accounts with no dividend activity

### Visual Layout Concerns
- Current Sankey code (lines 169-185) may need adjustment for 3 new income nodes and 3 new savings edges
- Test with realistic data to ensure nodes don't overlap or compress excessively
- Consider grouping dividend income nodes into a single "Investment Income" parent node if space is constrained

---

## 5. Plan Page Changes

### Current State
- Plan page displays per-account dividend configuration:
  - `dividend_policy: 'Accumulate' | 'Payout'`
  - `dividend_mode: 'yield' | 'fixed'`
  - `dividend_yield: number` (%)
  - `dividend_fixed_amount: number`

### Decision Required: Handle Existing Yield Config UI

**Option A: Remove yield config UI**
- Delete dividend yield/mode/fixed_amount input fields from plan page
- Pro: Clean separation between synthetic and real dividends
- Con: Breaks existing UX for accounts without real dividend data (e.g., pensions)

**Option B: Hide yield config for accounts with real data**
- Show config fields only for accounts where `use_real_dividends === false`
- Add info message: "Dividend data is automatically fetched from IBKR/Schwab. Manual configuration is not needed."
- Pro: Backwards compatible, educates users
- Con: Conditional UI adds complexity

**Option C: Mark as "Override" (deprecated)**
- Keep config fields visible but disabled
- Add label: "Yield configuration overridden by real dividend data"
- Pro: Users see old settings but understand they're inactive
- Con: Cluttered UI

**Recommendation:** Implement Option B. Show yield config only for accounts without real dividend integration. This keeps the plan page clean while preserving functionality for synthetic dividend use cases (pensions, annuities).

### Update `setDividendTotal()` Call

**Current (line 42):**
```typescript
setDividendTotal({ annualTotal: computedTotal });
```

**Proposed:**
```typescript
setDividendTotal({
  ibkr: dividendSummary.by_account.ibkr,
  schwab: dividendSummary.by_account.schwab,
  ira: dividendSummary.by_account.ira,
  total: dividendSummary.total_dividend_usd
});
```

**Data source:**
- Plan page must call `getDividendSummary()` on mount/refresh (same as cash flow page)
- Cache result to avoid redundant queries

---

## 6. Background Worker / Data Pipeline

### Assessment: No Worker Changes Needed

**Current state:**
- `getDividendSummary()` (dividends/actions.ts:1211) is a **frontend API route** that queries Supabase
- Returns pre-aggregated dividend data with `by_account` breakdown
- Already converts all positions to USD via `convertCurrency()` (line 1223)

**Questions:**
1. **Does dividend data require forecasting?**
   - Current implementation appears to return historical/realized dividends
   - If forward-looking projections are needed (e.g., "expected dividends for 2025"), a background worker may be required
   - **Clarify with Jony:** Should cash flow projection use trailing 12-month dividend data, or forecasted dividend income?

2. **Does `getDividendSummary()` include dividend reinvestment?**
   - If the function returns total dividend income but doesn't distinguish between paid-out vs. reinvested dividends, simulation must infer reinvestment from `dividend_policy` configuration
   - **Clarify with Jony:** Does IBKR/Schwab data API already track reinvestment separately?

**Provisional decision:**
- Use existing `getDividendSummary()` data as-is (no worker changes)
- If forecast worker is needed, defer to Phase 2 after validating MVP with historical data

---

## 7. Sequencing & Dependencies

### Merge Order (per Stacked-Branch Protocol)

1. **Phase 1: Data Contract + Simulation Engine**
   - Change `DividendIncomeTotal` → `DividendIncome` interface
   - Update `runPlanSimulation()` signature
   - Modify dividend income injection logic (3 separate entries)
   - Implement dividend reinvestment in `processSavings()`
   - **Tests:** Verify mass conservation, account balances, savings_details structure
   - **PR:** `feat/dividend-by-account-simulation`

2. **Phase 2: Sankey Visualization**
   - Add support for 3 dividend income nodes and 3 reinvestment flows
   - Update node naming and filtering logic
   - **Tests:** Visual regression tests with real data
   - **PR:** `feat/dividend-sankey-visualization` (depends on Phase 1)

3. **Phase 3: Monthly/Yearly Toggle**
   - Add toggle component to cash flow page
   - Pass `displayMode` prop to Sankey
   - Update summary cards to respect display mode
   - **Tests:** Unit tests for divisor logic, visual tests for both modes
   - **PR:** `feat/cash-flow-display-toggle` (independent of Phase 1/2, can be developed in parallel)

4. **Phase 4: Plan Page Integration**
   - Hide dividend yield config for accounts with real data
   - Update `setDividendTotal()` call to per-account structure
   - **Tests:** Integration tests for plan page state management
   - **PR:** `feat/plan-page-real-dividends` (depends on Phase 1)

### Stacked-Branch Considerations
- Phase 1 must merge to `main` before Phase 2/4
- Phase 3 can merge independently (no cross-branch dependencies)
- If Phase 1 PR is blocked, Phase 3 can proceed to unblock frontend team

---

## 8. Test Plan Summary

### Unit Tests

**Simulation Engine:**
- `dividendIncome` contract validation (3 accounts, USD major units)
- Mass conservation: `(salary + dividends) = expenses + taxes + savings + unallocated`
- Dividend reinvestment increases account balances correctly
- Accounts with `dividend_policy: 'Accumulate'` emit reinvestment entries in `savings_details`
- Accounts with `dividend_policy: 'Payout'` do not emit reinvestment entries
- Deficit year logic: dividends reduce deficit before account withdrawals (if Option A selected)

**Sankey Component:**
- 3 dividend income nodes rendered when all accounts have non-zero dividends
- Zero-value accounts filtered out correctly
- Dividend reinvestment edges bypass "Net Savings" node
- `displayMode: 'monthly'` divides all values by 12
- `displayMode: 'yearly'` shows original values

**Toggle Component:**
- State updates on click
- Summary cards and Sankey update reactively
- Persists selection to localStorage (optional)

### Integration Tests

**Cash Flow Page:**
- `getDividendSummary()` called on mount
- `dividendIncome` passed to `runPlanSimulation()`
- Sankey receives correct `income_details` and `savings_details` arrays
- Summary cards display correct totals in both monthly and yearly mode

**Plan Page:**
- Dividend yield config hidden when `getDividendSummary()` returns non-zero values for account
- `setDividendTotal()` emits per-account structure
- No regression for accounts without real dividend data

### Visual Regression Tests

**Sankey Layouts:**
- 1 account with dividends (minimal case)
- 3 accounts with dividends (full case)
- Mixed case: 2 accounts with dividends, 1 without
- Deficit year with dividend income (withdrawal nodes present)
- Monthly vs. yearly mode (value labels update correctly)

---

## 9. Open Questions for Jony

### Data Source & Forecasting
1. **Should cash flow projection use trailing 12-month dividend data, or forecasted dividend income?**
   - If forecasted: Does a background worker need to compute expected dividends based on position holdings and yield schedules?
   - If trailing: Is `getDividendSummary()` already returning the correct data?

2. **Does `getDividendSummary()` distinguish between paid-out and reinvested dividends?**
   - If yes: Use `reinvested_dividends` field directly
   - If no: Infer reinvestment from `dividend_policy` configuration

### Deficit Year Semantics
3. **In deficit years, should dividends reduce the deficit before account withdrawals?**
   - Option A: `netDeficit = expenses - (salary + dividends)` — Dividends offset deficit first
   - Option B: `deficit = expenses - salary` — Withdrawals occur regardless of dividends
   - Affects account depletion rates and `max_withdrawal_rate` compliance

### Display Mode
4. **Should the monthly/yearly toggle affect only display, or also affect any underlying calculations?**
   - Recommendation: Display-only (divisor applied at render time)
   - Alternative: Rerun simulation with monthly time steps (requires major refactor)

### Plan Page UX
5. **How should we handle existing dividend yield configuration UI?**
   - Option A: Remove entirely (may break accounts without real data)
   - Option B: Hide for accounts with real data (recommended)
   - Option C: Show but disable with "override" label

### Backwards Compatibility
6. **Should we support a gradual rollout where some accounts use real dividends and others use synthetic dividends?**
   - If yes: Add per-account `use_real_dividends` flag
   - If no: Assume all accounts migrate simultaneously (simpler but riskier)

---

## Appendices

### A. Affected Files

| File | Change Type | Lines |
|------|-------------|-------|
| `apps/frontend/src/app/plan/simulation.ts` | Modify | 27-56 (interface), 530-598 (disable synthetic), 600-626 (reinvestment), 882-896 (inject 3 nodes) |
| `apps/frontend/src/app/cash-flow/page.tsx` | Modify | 18 (state type), 54-85 (simulation call), 174-199 (summary cards), +20 (toggle UI) |
| `apps/frontend/src/components/CashFlow/CashFlowSankey.tsx` | Modify | 36 (props), 62-83 (income loop), 169-185 (savings loop), +50 (displayMode logic) |
| `apps/frontend/src/app/plan/page.tsx` | Modify | 42 (setDividendTotal call), +30 (conditional yield config UI) |
| `apps/frontend/src/types/dividends.ts` | Read-only | 49-54 (reference for by_account structure) |
| `apps/frontend/src/app/dividends/actions.ts` | Read-only | 1211 (getDividendSummary data source) |

**Total estimated LOC:** ~300-400 lines changed across 4 files

### B. Options Income Pattern Reference

Per `.squad/decisions.md` lines 29-60, the **Options Income Estimation** feature provides a precedent for virtual income streams:
- Computes income from options trades (call premiums, assignment proceeds)
- Emits multiple income nodes in Sankey (one per strategy)
- Bypasses traditional income categories (salary, bonus)
- Similar architecture to dividend reinvestment (direct account inflows)

**Key difference:** Options income is fully synthetic (no real data source), whereas dividend income replaces synthetic with real data.

### C. Round 8 Currency Contract

Per `.squad/decisions.md` lines 1510-1528:
- All monetary values in **major units** (dollars, not cents)
- No ÷100 conversion needed in simulation or UI
- `getDividendSummary()` already returns USD major units via `convertCurrency()` (dividends/actions.ts:1223)
- Multi-currency precision tracked as future work (not blocking this feature)

---

**End of Design Document**
