# Cashflow Dividend Redesign - Test Plan
**Author:** Redfoot (Tester)
**Date:** 2026-05-14
**Status:** Ready for Review
**Reviewers:** Keaton (code), McManus or Fenster (tests)

## Overview

This test plan covers comprehensive testing for the cashflow dividend redesign feature, which adds:
- Per-account dividend breakdown (IBKR, Schwab, IRA)
- Monthly/yearly toggle for cash flow page
- Dividend reinvestment visualization in Sankey diagram
- Improved simulation accuracy with real dividend data

Based on consolidated designs from Keaton (architecture), Fenster (frontend), McManus (simulation), and Hockney (backend audit).

## Test Surface Inventory

### Files Under Test

**Primary:**
- `apps/frontend/src/app/plan/simulation.ts` - Simulation engine with reinvestment logic
- `apps/frontend/src/app/plan/cash-flow/page.tsx` - Cash flow page with toggle
- `apps/frontend/src/app/plan/cash-flow/CashFlowSankey.tsx` - Sankey visualization

**Secondary:**
- `apps/frontend/src/app/plan/page.tsx` - Plan page dividend banner
- Type definitions for DividendIncome interface

**Test Files:**
- `apps/frontend/src/app/plan/__tests__/simulate.test.ts` - Simulation engine tests (extend existing)
- `apps/frontend/src/app/plan/cash-flow/__tests__/page.test.tsx` - Page component tests (new)
- `apps/frontend/src/app/plan/cash-flow/__tests__/CashFlowSankey.test.tsx` - Sankey component tests (new)

## Test Taxonomy

**Unit Tests (Vitest)**
- Simulation engine logic (mass conservation, reinvestment formulas, tax handling)
- Helper functions (account mapping, value transformation)

**Component Tests (React Testing Library)**
- Toggle component behavior and accessibility
- Sankey node rendering and color palette
- Plan page banner display

**Integration Tests**
- Full cash flow page with real simulation data
- End-to-end user workflows (toggle → recalculate → verify display)

## Specific Test Cases

### 1. Simulation Engine Tests (simulate.test.ts)

#### Test 1.1: Surplus Year - Full Reinvestment
```
Given: Plan with dividendByAccount = { ibkr: 12000, schwab: 8000, ira: 5000 }
  And: Annual expenses = $15,000 (surplus situation)
When: Simulation runs for 30 years
Then: Year 1 emits 3 income_details entries:
  - "Dividend - IBKR": $12,000
  - "Dividend - Schwab": $8,000
  - "Dividend - IRA": $5,000
And: Year 1 emits 3 savings_details entries:
  - "Dividend Reinvest - IBKR": $12,000
  - "Dividend Reinvest - Schwab": $8,000
  - "Dividend Reinvest - IRA": $5,000
And: sum(income_details) === sum(savings_details) (mass conservation)
```

#### Test 1.2: Deficit Year - Partial Reinvestment
```
Given: Plan with dividendByAccount = { ibkr: 12000, schwab: 8000, ira: 5000 }
  And: Annual expenses = $30,000 (deficit = $5,000)
When: Simulation runs
Then: Year 1 dividends offset deficit first
And: Residual reinvestment = $25,000 - $5,000 = $20,000
And: Reinvestment split proportionally: IBKR $9,600, Schwab $6,400, IRA $4,000
And: sum(dividend_income) === sum(reinvestment) + $5,000
```

#### Test 1.3: Deficit Year - Full Consumption
```
Given: Plan with dividendByAccount = { ibkr: 10000, schwab: 5000, ira: 0 }
  And: Annual expenses = $50,000 (large deficit)
When: Simulation runs
Then: All dividends consumed for spending
And: Reinvestment entries = 0 for all accounts
And: Withdrawals triggered for remaining deficit ($35,000)
And: sum(dividend_income) + withdrawals >= expenses
```

#### Test 1.4: Zero Account - Selective Rendering
```
Given: dividendByAccount = { ibkr: 0, schwab: 8000, ira: 5000 }
When: Simulation runs
Then: Only 2 income_details entries emitted (Schwab, IRA)
And: Only 2 reinvestment entries emitted
And: No "Dividend - IBKR" or "Dividend Reinvest - IBKR" nodes
```

#### Test 1.5: Multi-Currency Conversion
```
Given: Plan with settings.mainCurrency = 'ILS'
  And: dividendByAccount in USD = { ibkr: 12000, schwab: 8000, ira: 5000 }
  And: exchangeRate USD→ILS = 3.5
When: Simulation runs
Then: income_details values converted: IBKR ₪42,000, Schwab ₪28,000, IRA ₪17,500
And: Reinvestment values also converted
And: Mass conservation holds in ILS
```

#### Test 1.6: Tax Handling - Gross Income, Net Reinvestment
```
Given: Account IBKR with dividend_tax_rate = 0.15
  And: dividendByAccount = { ibkr: 10000, schwab: 0, ira: 0 }
When: Simulation runs (surplus year)
Then: income_details["Dividend - IBKR"] = $10,000 (gross)
And: savings_details["Dividend Reinvest - IBKR"] = $8,500 (net after 15% tax)
And: Account balance increases by $8,500, not $10,000
```

#### Test 1.7: First Year Behavior - Uses dividendByAccount
```
Given: Plan with dividendByAccount defined
  And: Current year = 2026
When: Simulation runs from current year
Then: Year 2026 uses dividendByAccount values (not currentDividendPayouts() fallback)
And: No duplicate dividend income from legacy yield path
```

#### Test 1.8: Backward Compatibility - Legacy Yield Path
```
Given: Plan with NO dividendByAccount (undefined)
  And: Account with yield = 0.04
When: Simulation runs
Then: Falls back to legacy synthetic dividend calculation
And: Single aggregate "Dividend Income" entry emitted
And: No reinvestment entries (old behavior preserved)
```

#### Test 1.9: Mass Conservation - Three Account Split
```
Given: dividendByAccount = { ibkr: 12000, schwab: 8000, ira: 5000 }
  And: Surplus year
When: Simulation runs
Then: sum([12000, 8000, 5000]) === sum([12000, 8000, 5000])
And: Total income = $25,000 === Total reinvestment = $25,000
And: No rounding errors > $0.01
```

#### Test 1.10: Account Mapping - Fuzzy Match
```
Given: dividendByAccount keys = { "Interactive Brokers": 12000, "Charles Schwab": 8000, "Trad IRA": 5000 }
  And: Account names = { "IBKR", "Schwab", "IRA" }
When: Simulation maps accounts (case-insensitive, type fallback)
Then: "Interactive Brokers" → IBKR account
And: "Charles Schwab" → Schwab account
And: "Trad IRA" → IRA account (type match)
```

### 2. Cash Flow Page Tests (page.test.tsx)

#### Test 2.1: Default Yearly Display Mode
```
Given: User navigates to /plan/cash-flow
When: Page renders
Then: Toggle shows "Yearly" pill in active state (emerald-600)
And: "Monthly" pill in inactive state (slate-400)
And: displayMode state = 'yearly'
And: Simulation data passed unmodified to CashFlowSankey
```

#### Test 2.2: Toggle to Monthly - Value Transformation
```
Given: Cash flow page with simulation data (income = $60,000, expenses = $30,000)
When: User clicks "Monthly" pill
Then: Toggle updates to show "Monthly" active, "Yearly" inactive
And: displayMode state = 'monthly'
And: All monetary values divided by 12 in useMemo
And: CashFlowSankey receives income = $5,000, expenses = $2,500
```

#### Test 2.3: Toggle Persistence - Re-render Stable
```
Given: User toggles to "Monthly" mode
When: Component re-renders (props update, parent state change)
Then: displayMode remains 'monthly' (not reset to 'yearly')
And: Derived displayData recalculated correctly
```

#### Test 2.4: Toggle Accessibility - Keyboard and Screen Reader
```
Given: Cash flow page rendered
When: User tabs to toggle pills
Then: Both pills are focusable and receive focus ring
When: User presses Enter or Space on inactive pill
Then: Toggle switches mode
And: aria-pressed="true" on active pill, aria-pressed="false" on inactive
And: Screen reader announces "Yearly, button, pressed" or "Monthly, button, pressed"
```

#### Test 2.5: Empty State - No Simulation Data
```
Given: Plan with no accounts or dividends
When: Cash flow page renders
Then: Toggle still renders and functions
And: CashFlowSankey shows empty state or minimal nodes
And: No runtime errors from undefined data
```

### 3. CashFlowSankey Tests (CashFlowSankey.test.tsx)

#### Test 3.1: Three Dividend Income Nodes Rendered
```
Given: Simulation data with income_details = ["Dividend - IBKR": 12000, "Dividend - Schwab": 8000, "Dividend - IRA": 5000]
When: CashFlowSankey renders
Then: 3 income source nodes created with IDs:
  - "income_src_Dividend: IBKR"
  - "income_src_Dividend: Schwab"
  - "income_src_Dividend: IRA"
And: All nodes have emerald color (#34d399)
```

#### Test 3.2: Three Reinvestment Destination Nodes Rendered
```
Given: Simulation data with savings_details = ["Dividend Reinvest - IBKR": 12000, ...]
When: CashFlowSankey renders
Then: 3 reinvestment destination nodes created with IDs:
  - "reinvest_dest_IBKR"
  - "reinvest_dest_Schwab"
  - "reinvest_dest_IRA"
And: All nodes have indigo color (#7c7ef8, brighter than regular savings #6366f1)
```

#### Test 3.3: Node ID Collision Prevention
```
Given: Simulation with existing savings_details = ["Savings - IBKR": 5000] (account contributions)
  And: New reinvestment = ["Dividend Reinvest - IBKR": 12000]
When: CashFlowSankey renders
Then: Two distinct destination nodes:
  - "save_dest_IBKR" (regular savings, indigo #6366f1)
  - "reinvest_dest_IBKR" (reinvestment, indigo #7c7ef8)
And: No duplicate node IDs or overwriting
```

#### Test 3.4: Zero Account Filtering - Only Non-Zero Nodes
```
Given: dividendByAccount = { ibkr: 0, schwab: 8000, ira: 5000 }
When: CashFlowSankey renders
Then: Only 2 dividend income nodes (Schwab, IRA)
And: Only 2 reinvestment nodes
And: No IBKR nodes in the graph
```

#### Test 3.5: Color Palette Consistency
```
Given: CashFlowSankey with mixed income sources (salary, dividends, options)
When: Component renders
Then: Salary income = green (#10b981)
And: Dividend income = emerald (#34d399)
And: Options income = existing color (cyan/teal)
And: Reinvestment savings = indigo (#7c7ef8)
And: Regular savings = indigo (#6366f1)
```

### 4. Plan Page Tests (page.test.tsx)

#### Test 4.1: Banner Displayed for Real Dividend Data
```
Given: Plan with dividendByAccount defined
When: Plan page (/plan) renders
Then: Read-only banner shows: "Dividends auto-calculated from account data: IBKR $12,000, Schwab $8,000, IRA $5,000"
And: Banner has info icon (blue or gray styling)
```

#### Test 4.2: Yield Controls Hidden for Real Data Accounts
```
Given: Plan with account IBKR having dividendByAccount.ibkr = 12000
When: Plan page renders account row for IBKR
Then: Yield input field is hidden or disabled
And: Dividend amount shown as read-only
```

#### Test 4.3: Manual Override Preserved for Non-Real Accounts
```
Given: Plan with account "Vanguard" (no dividendByAccount entry)
When: Plan page renders
Then: Yield input field remains editable
And: User can manually set yield percentage
And: No banner or auto-calculation for this account
```

## Regression Risks

**Baseline:** 519/519 tests passing (per decisions.md 2026-05-12)

### High-Risk Areas

1. **Bond Ladder Virtual Income** (simulation.ts lines 890-896)
   - Risk: New dividend logic might interfere with bond ladder income_details
   - Mitigation: Verify existing bond ladder tests still pass, no double-counting

2. **Options Income** (simulation.ts lines 875-880)
   - Risk: Options income rendering broken by new income_details structure
   - Mitigation: Run existing options income tests (simulate.test.ts lines 331-378)

3. **Existing Savings Details** (account contributions)
   - Risk: Regular account contributions overwritten by reinvestment entries
   - Mitigation: Test both contribution and reinvestment in same simulation

4. **Legacy Yield Path** (backward compatibility)
   - Risk: Plans without dividendByAccount fail or break
   - Mitigation: Test undefined dividendByAccount, ensure fallback to synthetic yield calculation

5. **Current Year Dividends** (first year behavior)
   - Risk: Double-counting if both currentDividendPayouts() and dividendByAccount apply
   - Mitigation: Test first year explicitly, verify no duplicate income

### Medium-Risk Areas

6. **Multi-currency conversion** - Verify exchange rates applied correctly to all 3 accounts
7. **Tax handling edge cases** - Zero tax rate, 100% tax rate, negative dividends (refunds)
8. **Sankey layout performance** - Large graphs with 10+ accounts might slow rendering
9. **Toggle state race conditions** - Rapid clicking might cause stale displayData
10. **Account name matching** - Case sensitivity, special characters, empty names

## Acceptance Gates

### Automated Gates (Must Pass)

1. **Full test suite green**: All 519 baseline + new tests passing
2. **No TypeScript errors**: `tsc --noEmit` succeeds
3. **Lint clean**: ESLint passes with no warnings
4. **Build succeeds**: Production build completes without errors

### Manual Smoke Test Checklist

- [ ] Navigate to /plan/cash-flow with real plan data
- [ ] Toggle between Yearly and Monthly - verify values divided by 12
- [ ] Inspect Sankey diagram - count 3 dividend nodes (emerald) + 3 reinvestment nodes (indigo)
- [ ] Check zero account filtering - only non-zero accounts shown
- [ ] Visit /plan page - verify dividend banner displays for accounts with real data
- [ ] Test legacy plan (no dividendByAccount) - verify old yield controls still work
- [ ] Multi-currency plan - verify USD→ILS conversion
- [ ] Deficit year plan - verify withdrawals triggered, reinvestment reduced/zero
- [ ] Browser devtools - no console errors or warnings

### Performance Benchmarks

- [ ] Cash flow page initial render < 500ms (with 3 accounts)
- [ ] Toggle switch response < 100ms
- [ ] Sankey re-render < 200ms
- [ ] Simulation engine (30 years, 5 accounts) < 1000ms

## Test Data Fixtures

### Canonical Fixture (Surplus Year)
```typescript
const canonicalDividendPlan = {
  accounts: [
    accountSettings({ name: 'IBKR', type: 'taxable', value: 500000, dividend_tax_rate: 0.15 }),
    accountSettings({ name: 'Schwab', type: 'taxable', value: 300000, dividend_tax_rate: 0.15 }),
    accountSettings({ name: 'IRA', type: 'traditional_ira', value: 200000, dividend_tax_rate: 0 }),
  ],
  dividendByAccount: { ibkr: 12000, schwab: 8000, ira: 5000 }, // Total $25k
  expenses: baseItem({ amount: 15000, startAge: 65, endAge: 95 }),
  settings: { primaryUser: { birthYear: 1960 }, mainCurrency: 'USD' }
}
```

### Deficit Year Fixture (Partial Reinvestment)
```typescript
const deficitPartialPlan = {
  ...canonicalDividendPlan,
  expenses: baseItem({ amount: 30000, startAge: 65, endAge: 95 }), // Deficit $5k
  // Expected: $20k reinvestment proportionally split
}
```

### Deficit Year Fixture (Full Consumption)
```typescript
const deficitFullPlan = {
  ...canonicalDividendPlan,
  dividendByAccount: { ibkr: 10000, schwab: 5000, ira: 0 }, // Total $15k
  expenses: baseItem({ amount: 50000, startAge: 65, endAge: 95 }), // Deficit $35k
  // Expected: Zero reinvestment, withdrawals triggered
}
```

### Multi-Currency Fixture
```typescript
const multiCurrencyPlan = {
  ...canonicalDividendPlan,
  settings: { primaryUser: { birthYear: 1960 }, mainCurrency: 'ILS' },
  exchangeRates: { USD: 3.5 }, // 1 USD = 3.5 ILS
  // Expected: All values in ILS (₪42k, ₪28k, ₪17.5k)
}
```

### Zero Account Fixture
```typescript
const zeroAccountPlan = {
  ...canonicalDividendPlan,
  dividendByAccount: { ibkr: 0, schwab: 8000, ira: 5000 },
  // Expected: Only 2 nodes rendered (Schwab, IRA)
}
```

### Legacy Yield Fixture (Backward Compat)
```typescript
const legacyYieldPlan = {
  accounts: [
    accountSettings({ name: 'Vanguard', type: 'taxable', value: 500000, yield: 0.04 }),
  ],
  // NO dividendByAccount field
  expenses: baseItem({ amount: 15000, startAge: 65, endAge: 95 }),
  // Expected: Synthetic dividend = $20k from yield calculation
}
```

## Review Gating

**Code Review (Required):**
- Reviewer: **Keaton** (Lead Architect, non-author per strict-lockout rule)
- Scope: Simulation engine changes, data contract modifications, type safety
- Checklist:
  - [ ] Mass conservation invariants enforced
  - [ ] Backward compatibility preserved (undefined dividendByAccount)
  - [ ] No performance regressions (simulation.ts complexity)
  - [ ] Type definitions accurate (DividendIncome interface)

**Test Review (Required):**
- Reviewer: **McManus** (for simulation tests) OR **Fenster** (for component tests)
- Scope: Test coverage, fixture quality, regression risk mitigation
- Checklist:
  - [ ] All 10 simulation test cases implemented
  - [ ] All 5 cash flow page test cases implemented
  - [ ] All 5 Sankey test cases implemented
  - [ ] Test fixtures match canonical examples
  - [ ] Regression tests cover bond ladder, options, existing savings

**User Acceptance (Jony):**
- Manual smoke test on staging environment
- Verify deficit semantics match business requirements (Option A vs Option B)
- Approve dividend growth strategy (constant vs escalating)

## Open Questions for Jony

1. **Deficit Semantics Confirmation**
   - Option A: Dividends offset deficit first, residual reinvests (McManus's proposal)
   - Option B: Withdrawals triggered regardless, dividends fully reinvest
   - **Recommendation:** Option A (matches real-world behavior - dividends used for spending before triggering withdrawals)

2. **Dividend Growth Rate Application**
   - Should dividendByAccount values remain constant across all years?
   - Or apply account.dividend_growth_rate escalation (e.g., 3% annual increase)?
   - **Recommendation:** Constant for MVP, escalation in Phase 2 (simpler logic, easier testing)

3. **Account Mapping Strategy**
   - Rely on fuzzy name/type matching (current approach)?
   - Or add explicit `dividendAccountId` field to link accounts?
   - **Recommendation:** Fuzzy matching for MVP (no data model changes), explicit IDs if prod issues arise

4. **Plan Page UX - Yield Controls**
   - Remove yield input entirely for accounts with real dividend data?
   - Or keep visible but disabled with tooltip "Using real data"?
   - **Recommendation:** Hide for cleaner UX, add banner explaining auto-calculation

## Implementation Phases

**Phase 1: Simulation Engine (McManus lead, Redfoot test)**
- Implement reinvestment logic with mass conservation
- Test 10 simulation test cases
- Gate: All simulation tests green + code review by Keaton

**Phase 2: Cash Flow Page (Fenster lead, Redfoot test)**
- Implement monthly/yearly toggle
- Test 5 page component test cases
- Gate: All page tests green + code review by Keaton

**Phase 3: Sankey Visualization (Fenster lead, Redfoot test)**
- Implement 3 dividend + 3 reinvestment nodes
- Test 5 Sankey test cases
- Gate: All Sankey tests green + visual inspection

**Phase 4: Plan Page Integration (Fenster lead, Redfoot test)**
- Implement dividend banner and hide yield controls
- Test 3 plan page test cases
- Gate: All plan page tests green + manual smoke test

**Phase 5: Regression Testing (Redfoot lead)**
- Run full 519 baseline test suite
- Fix any broken tests (bond ladder, options, savings)
- Gate: Zero regressions + performance benchmarks met

## Success Criteria

**Test Metrics:**
- 30+ new test cases added (10 simulation + 5 page + 5 Sankey + 5 plan + 5 integration)
- 519/519 baseline tests still passing (zero regressions)
- 100% TypeScript coverage for new code (no `any` types)
- Zero console errors or warnings in manual smoke test

**Quality Metrics:**
- Code review approved by Keaton (architecture)
- Test review approved by McManus or Fenster (coverage)
- User acceptance approved by Jony (business logic)
- Performance benchmarks met (< 500ms page load)

**Documentation:**
- Test plan reviewed and approved (this document)
- Implementation checklist updated in McManus's design
- History.md updated with learnings from this feature

---

## Appendix: LURVG Validation Patterns (from redfoot/history.md)

**Learnings from Previous PRs:**
- Use `screen.getByTestId('account-tab-{type}')` for account navigation (PR #371)
- RLS seed strategies: separate test users with isolated data (PR #375)
- Broker form testids: `broker-select`, `account-type-select`, `cash-balance-input` (PR #379)
- Chart rendering: wait for canvas element + `toBeInTheDocument()` (PR #381)
- Multi-currency: verify exchange rate applied with `.toBeCloseTo(expected, 2)` (PR #394)
- Toggle components: check `aria-pressed` attribute for a11y (PR #399)
- Sankey node IDs: use descriptive prefixes to avoid collisions (PR #400)
- Deficit handling: verify withdrawals triggered with `withdrawals_details.length > 0` (PR #437)

**Vitest Patterns:**
- Use `describe('Feature', () => { it('scenario', () => { ... }) })` structure
- Helper functions: `baseItem()`, `accountSettings()`, `simulate()` wrapper
- Decimal precision: `.toBeCloseTo(expected, 2)` for monetary values (avoid floating-point errors)
- Mass conservation: `expect(sum(income)).toBeCloseTo(sum(savings), 2)`

**React Testing Library Patterns:**
- Render with providers: `render(<Component />, { wrapper: TestProviders })`
- User interactions: `await user.click(screen.getByRole('button', { name: 'Monthly' }))`
- Accessibility checks: `expect(button).toHaveAttribute('aria-pressed', 'true')`
- Async queries: `await screen.findByText('Expected Text')` for async rendering

---

**END OF TEST PLAN**
