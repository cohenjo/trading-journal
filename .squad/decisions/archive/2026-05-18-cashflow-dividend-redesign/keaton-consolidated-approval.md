# Cash Flow Dividend Redesign — Consolidated Approval Document

**Author:** Keaton (Lead)
**Date:** 2026-05-18
**Status:** Awaiting Jony's Approval
**Input:** 5 design documents (Keaton architecture, Fenster UI, McManus simulation, Hockney backend audit, Redfoot test plan)

---

## 1. Executive Summary

We're shipping three interconnected features for the cash flow planning tool:

1. **Monthly/Yearly Toggle** — View financial data as monthly averages (÷12) or annual totals
2. **Real Per-Account Dividends** — Replace synthetic yield-driven dividends with actual data from `getDividendSummary()` broken down by IBKR/Schwab/IRA accounts
3. **Dividend Reinvestment Visualization** — Show 3 dividend income streams + 3 corresponding reinvestment outflows in Sankey diagram

**Key insight:** Hockney confirmed no backend changes needed — `getDividendSummary().by_account` already returns fresh real dividend data. This is a frontend-only enhancement surfacing existing data.

**Impact:** Replaces ~15 lines of synthetic dividend logic with real position-based forecasts; adds ~300-400 LOC frontend (toggle UI + simulation logic + Sankey rendering).

---

## 2. Scope

### Files Changed (by owner)

**Frontend (Fenster):**
- `apps/frontend/src/app/plan/cash-flow/page.tsx` — Toggle state, monthly display transform
- `apps/frontend/src/components/CashFlow/CashFlowSankey.tsx` — Per-account dividend nodes (no structural changes, relies on new income_details entries)
- `apps/frontend/src/app/plan/page.tsx` — Replace yield config UI with "Auto from real positions" banner

**Simulation (McManus + Keaton):**
- `apps/frontend/src/app/plan/simulation.ts` — Disable synthetic dividends, inject 3 per-account income entries, compute reinvestment with mass conservation

**Backend (Hockney):**
- **NONE** — Data pipeline complete (IBKR Flex Query accruals + Yahoo yields + CSV imports). `getDividendSummary()` already returns `by_account: { ibkr, schwab, ira }` in USD.

**Tests (Redfoot):**
- `apps/frontend/src/app/plan/__tests__/simulate.test.ts` — Extend with 10 new cases (surplus, deficit, partial reinvest, mass conservation)
- `apps/frontend/src/app/plan/cash-flow/__tests__/page.test.tsx` — New file, 5 cases (toggle state, monthly transform)
- `apps/frontend/src/components/CashFlow/__tests__/CashFlowSankey.test.tsx` — New file, 5 cases (3 nodes, colors, zero-filtering)

---

## 3. Data Contract — Agreed

### Interface Change (Keaton + McManus converged)

**Current:**
```typescript
interface PlanSimulationInput {
  dividendTotal?: { annualTotal: number };
}
```

**New (backward-compatible):**
```typescript
interface PlanSimulationInput {
  dividendTotal?: {
    annualTotal: number;        // Keep for fallback
    by_account?: {
      ibkr: number;              // USD annual forward estimate
      schwab: number;
      ira: number;
    };
  };
}
```

### Call-Site Changes

**cash-flow/page.tsx (line 26-36):**
```typescript
// Before:
setDividendTotal({ annualTotal: data.total_forward_annual });

// After:
setDividendTotal({
  annualTotal: data.total_forward_annual,
  by_account: data.by_account,  // { ibkr, schwab, ira }
});
```

**plan/page.tsx (line 42):**
```typescript
// Same change — pass by_account when available
```

**Fallback:** When `by_account` is undefined, simulation uses `annualTotal` (single aggregate node, current behavior). No breaking change.

---

## 4. Simulation Rules — Agreed (McManus + Keaton)

### 4.1 Surplus Year (expenses < income)
- Emit **3 income entries** in `income_details`:
  - `{ name: "Dividend - IBKR", type: "dividends", subtype: "ibkr", gross: 12000, value: 12000 }`
  - `{ name: "Dividend - Schwab", type: "dividends", subtype: "schwab", gross: 8000, value: 8000 }`
  - `{ name: "Dividend - IRA", type: "dividends", subtype: "ira", gross: 5000, value: 5000 }`
- Emit **3 reinvestment entries** in `savings_details`:
  - `{ name: "Dividend Reinvest - IBKR", type: "reinvestment", amount: 12000 }`
  - `{ name: "Dividend Reinvest - Schwab", type: "reinvestment", amount: 8000 }`
  - `{ name: "Dividend Reinvest - IRA", type: "reinvestment", amount: 5000 }`
- **Invariant:** `sum(dividend income) == sum(reinvestment outflows)`

### 4.2 Deficit Year (expenses > income)
- **Phase 1:** Dividends offset deficit first
  - `reinvestableAmount = totalDividends - deficit`
  - If `reinvestableAmount < 0`, set to 0 (all dividends consumed for spending)
- **Phase 2:** Proportional reinvestment
  - Each account reinvests: `reinvestAmount = reinvestableAmount * (accountDividend / totalDividends)`
  - Example: Deficit $15K, dividends $25K → $10K reinvested (40% IBKR, 32% Schwab, 28% IRA proportional split)
- **Phase 3:** Withdrawals triggered only if `deficit > totalDividends`
  - `processDeficit(deficit - totalDividends)` withdraws from accounts by priority
- **Invariant:** `sum(dividend income) == sum(reinvestment outflows) + dividends_used_for_spending`

### 4.3 Account Mapping
- **Strategy:** Fuzzy name/type matching (McManus Section 1.2)
  - Exact name match (case-insensitive): `by_account.ibkr` → `account.name === "IBKR"`
  - Type match for IRA: `by_account.ira` → `account.type === "retirement"`
  - Fuzzy substring match: `by_account.ibkr` → `account.name.includes("ibkr")`
- **Unmapped sources:** Create synthetic "Dividend - {accountKey}" entry with no account balance impact (income-only node)
- **Future:** Add explicit `dividendAccountId` field if mapping issues arise in production

### 4.4 Tax Treatment
- **MVP:** All dividend income taxed equally (added to `taxableIncome`, applies plan-level `incomeTaxRate`)
- **Future:** Per-account `dividend_tax_rate` for qualified vs. ordinary distinction (deferred to Phase 2)

### 4.5 Backward Compatibility
- When `by_account` is missing or all values are zero, fall back to `annualTotal` (single aggregate dividend node)
- Existing plans with configured `dividend_yield` preserved for accounts without real data
- Synthetic dividend logic disabled only when `by_account` present for that account

---

## 5. UI Rules — Agreed (Fenster)

### 5.1 Monthly/Yearly Toggle
- **Location:** Right side of header, below age display (cash-flow/page.tsx line 139-147)
- **Style:** Pill toggle with slate-900/60 background, emerald-600 active state (matches page gradient)
- **Default state:** `'yearly'` on mount (no localStorage persistence in MVP)
- **Accessibility:** `aria-pressed` attribute, keyboard navigation, focus ring
- **Persistence:** None (local state only, resets on page reload) — see Open Question #1

### 5.2 Value Transformation
- **Where:** `useMemo` in `CashFlowPage` generates `displayData` object
- **Logic:** `displayValue = rawValue / (displayMode === 'monthly' ? 12 : 1)`
- **Applied to:** All summary cards + Sankey node values + links
- **Labeling:** Summary cards show "/ mo" badge when `displayMode === 'monthly'`

### 5.3 Sankey Shape
**Income nodes (3 new):**
- Names: `"Dividend - IBKR"`, `"Dividend - Schwab"`, `"Dividend - IRA"`
- Color: `#34d399` (emerald-400) — brighter than salary to differentiate investment income
- Filtering: Accounts with $0 forward dividend omitted (no zero-value nodes)

**Reinvestment sink nodes (3 new):**
- Names: `"Dividend Reinvest - IBKR"` (matches savings_details entry name)
- Color: `#7c7ef8` (bright indigo) — distinct from regular savings `#6366f1`
- Edges: Direct from income source to account sink, bypass "Net Savings" node
- Filtering: Zero reinvestment (e.g., `dividendReinvestRate = 0`) emits no sink nodes

**Naming convention confirmed:** "Dividend - {ACCOUNT}" for income, "Dividend Reinvest - {ACCOUNT}" for outflows (see Open Question #2 for naming debate)

### 5.4 Plan Page Banner
- **When:** `by_account` is defined and any account has non-zero dividend
- **Content:** "Dividends auto-calculated from real positions: IBKR $12,000 • Schwab $8,000 • IRA $5,000"
- **Styling:** Info banner with blue/gray accent, not warning (non-intrusive)
- **Yield config UI:** Hide editable inputs for accounts in `by_account`, keep for others (preserve manual override for non-real-data accounts)

---

## 6. Sequencing

### Recommended Merge Order (Keaton)

**Option A: Stacked PRs (preferred for incremental risk)**
1. **PR #1: Simulation Engine** (`feat/dividend-by-account-simulation`)
   - Data contract change + reinvestment logic
   - 10 simulation test cases
   - Gate: All tests green + Keaton code review
   - Depends on: None

2. **PR #2: Cash Flow Toggle** (`feat/cash-flow-display-toggle`)
   - Toggle UI + monthly transform
   - 5 page component tests
   - Gate: Visual inspection + Keaton review
   - **Can merge independently** (no dependency on #1) — unlocks frontend team

3. **PR #3: Sankey Visualization** (`feat/dividend-sankey-nodes`)
   - Per-account dividend rendering (consumes #1's income_details)
   - 5 Sankey tests
   - Gate: Visual regression pass
   - Depends on: PR #1 merged to main

4. **PR #4: Plan Page Integration** (`feat/plan-page-real-dividends`)
   - Banner + hide yield controls
   - 3 plan page tests
   - Gate: Manual smoke test
   - Depends on: PR #1 merged

5. **PR #5: Regression Suite** (no new code, verification only)
   - Run baseline 519 tests + fix any breaks
   - Gate: Zero regressions
   - Depends on: PRs #1, #3, #4 merged

**Option B: Single PR (simpler for reviewer, higher risk)**
- One branch with all 5 phases
- Gate: All 30+ new tests + 519 baseline tests green in single review
- Pros: Atomic merge, easier git history
- Cons: Larger review surface, blocks frontend team if simulation blocked

**Recommendation:** **Option A (Stacked PRs)** — PR #2 can unblock Fenster immediately while McManus finalizes simulation logic in PR #1.

### Critical Path
```
PR #1 (Simulation) → PR #3 (Sankey) → PR #5 (Regression)
                  ↘ PR #4 (Plan Page) ↗

PR #2 (Toggle) — Independent, can merge first
```

---

## 7. Conflicts Resolved

### Conflict 1: Reinvestment Naming
- **Fenster:** Prefers "Reinvest: IBKR" (shorter, cleaner Sankey labels)
- **McManus:** Prefers "Dividend Reinvest - IBKR" (matches savings_details name pattern)
- **Resolution:** **McManus's naming** (consistency with existing savings entries, easier grep/debug). Open Question #2 asks Jony to confirm.

### Conflict 2: Toggle Persistence
- **Fenster:** No localStorage persistence (MVP simplicity)
- **Keaton:** Optional localStorage for user preference memory
- **Resolution:** **No persistence in MVP** (defaults to yearly on every load). Open Question #1 escalates to Jony.

### Conflict 3: Tax Treatment Complexity
- **McManus:** Per-account `dividend_tax_rate` for qualified vs. ordinary distinction
- **Keaton:** Single plan-level `incomeTaxRate` applied to all dividends (MVP simplicity)
- **Hockney:** Defer to frontend, not backend concern
- **Resolution:** **Plan-level tax in MVP**, per-account rates deferred to Phase 2. IRA tax-deferred status noted as future enhancement (Open Question #7).

### Conflict 4: Account Mapping Strategy
- **McManus:** Fuzzy name/type matching (no schema changes)
- **Hockney:** Add explicit `dividendAccountId` field for robustness
- **Resolution:** **Fuzzy matching in MVP** (see Section 4.3). If production mapping failures occur, add explicit ID field in Phase 2.

---

## 8. Open Questions for Jony (CRITICAL — Approval Gate)

### Q1: Toggle State Persistence
**Question:** Should monthly/yearly preference persist in localStorage for future sessions?
- **Default if no answer:** Does not persist, always defaults to yearly on page load
- **Options:** (A) No persistence (Fenster's design), (B) Persist to localStorage (restore last choice)
- **Impact:** 10 LOC localStorage wrapper if (B) chosen

### Q2: Reinvestment Naming Convention
**Question:** Use "Reinvest: IBKR" (short) or "Dividend Reinvest - IBKR" (explicit)?
- **Default if no answer:** "Dividend Reinvest - IBKR" (McManus's design, matches savings_details pattern)
- **Options:** (A) Explicit naming (current design), (B) Short naming (risk: label overlap in Sankey)
- **Impact:** String literals in simulation.ts, no logic change

### Q3: Plan Page Yield Controls UX
**Question:** For accounts with real dividend data, should we hide editable yield inputs or show them disabled?
- **Default if no answer:** Hide entirely, add banner explaining "Auto from real positions"
- **Options:** (A) Hide (cleaner), (B) Show but disabled with lock icon, (C) Show with override toggle
- **Impact:** (A) is implemented, (B)/(C) add ~30 LOC conditional rendering

### Q4: Dividend Growth Over Projection Years
**Question:** Should `by_account` dividends remain constant across 20-40 year projection, or escalate annually?
- **Default if no answer:** Constant (no escalation) — simpler, matches forward estimate snapshot
- **Options:** (A) Constant, (B) Apply per-account `dividend_growth_rate` (e.g., 3% annual increase)
- **Impact:** (B) adds ~20 LOC escalation loop in simulation.ts

### Q5: Deficit Semantics Confirmation
**Question:** In deficit years, should dividends offset the deficit before triggering account withdrawals?
- **Default if no answer:** Yes (dividends used for spending first) — McManus's Option A
- **Options:** (A) Dividends offset deficit first (realistic), (B) Withdrawals triggered regardless
- **Impact:** Already implemented per (A), switching to (B) inverts order (~15 LOC refactor)

### Q6: IRA Tax-Deferred Treatment
**Question:** Should IRA dividends be excluded from taxable income (tax-deferred account)?
- **Default if no answer:** No — all dividends taxed equally at plan-level rate (MVP simplicity)
- **Options:** (A) All taxable (current), (B) IRA dividends excluded from taxable income
- **Impact:** (B) adds ~10 LOC conditional in income tax calculation

### Q7: Account Mapping Failures — User Visibility
**Question:** If `by_account.ibkr` has no matching plan account, should we show a warning banner?
- **Default if no answer:** Silent fallback — create synthetic "Dividend - ibkr" income node (no account balance impact)
- **Options:** (A) Silent (current), (B) Warning banner "Unmapped dividend source: ibkr"
- **Impact:** (B) adds ~15 LOC banner component + state management

### Q8: Options Income Toggle Scope
**Question:** Should the monthly/yearly toggle also apply to options income in the Sankey, or only dividends?
- **Default if no answer:** Applies to ALL income/expense (options, salary, dividends, etc.)
- **Options:** (A) All (current design — simpler), (B) Dividends only (selective toggle)
- **Impact:** (B) requires per-node display mode override (~40 LOC complexity)

---

## 9. Risk Register

**Risk 1 (HIGH):** Double-counting dividends if user's `account.growth` includes dividend yield AND we add real dividends.
- **Mitigation:** Add tooltip/help text: "When using real dividend data, set Growth to capital appreciation only (exclude yield)." Document in plan page.

**Risk 2 (MEDIUM):** Sankey layout breaks with 6 new nodes (3 income + 3 reinvest) on small screens.
- **Mitigation:** Visual regression tests at 1024px, 768px, 375px. Add node grouping if overlap detected (Phase 2).

**Risk 3 (MEDIUM):** Regression in bond ladder/options income rendering if new dividend logic interferes with existing `income_details` structure.
- **Mitigation:** Redfoot's 5 regression test cases cover bond ladder, options, savings. Baseline: 519/519 tests passing.

---

## 10. Estimated LOC

**Frontend (Fenster):**
- Toggle UI + state management: ~60 LOC
- Monthly transform logic (useMemo): ~30 LOC
- Summary card updates: ~20 LOC
- Plan page banner: ~40 LOC
- **Subtotal:** ~150 LOC

**Simulation (McManus + Keaton):**
- Interface change: ~10 LOC
- Disable synthetic dividends: ~15 LOC
- Per-account income injection: ~50 LOC
- Reinvestment logic: ~80 LOC
- Account mapping helper: ~40 LOC
- **Subtotal:** ~195 LOC

**Tests (Redfoot):**
- Simulation tests: ~200 LOC (10 cases)
- Component tests: ~150 LOC (10 cases)
- Integration tests: ~100 LOC (5 cases)
- **Subtotal:** ~450 LOC

**Total:** ~300-400 LOC production code + ~450 LOC tests = **~795 LOC** (aligns with Keaton's 300-400 LOC estimate for frontend-only; simulation adds another ~200 LOC)

**Revised estimate:** ~400-500 LOC production code when including simulation logic.

---

## 11. Tests Planned

**Simulation Engine (10 cases, Redfoot + McManus):**
- Surplus year full reinvestment, deficit partial reinvestment, deficit full consumption, mass conservation invariants (4 cases)
- Zero account filtering, account mapping (fuzzy/type/unmapped), backward compat (3 cases)
- Tax calculation, currency conversion, first-year logic (3 cases)

**Cash Flow Page (5 cases, Redfoot + Fenster):**
- Toggle state updates, monthly transform correctness, summary card labels, empty state handling, zero values (5 cases)

**Sankey Component (5 cases, Redfoot + Fenster):**
- 3 dividend nodes rendered, 3 reinvestment nodes, zero-account filtering, color palette consistency, node ID collision prevention (5 cases)

**Plan Page (3 cases, Redfoot + Fenster):**
- Banner display, yield controls hidden, manual override preserved for non-real accounts (3 cases)

**Regression (5 cases, Redfoot):**
- Bond ladder income, options income, account contributions, backward compat (no by_account), current-year dividend logic (5 cases)

**Total:** 28 new test cases + 519 baseline tests = **547 tests expected**

---

## 12. Approval Checklist

### Pre-Execution
- [ ] **Open questions answered** (8 questions above) — or defaults accepted
- [ ] **Sequencing approved** (Option A stacked PRs vs. Option B single PR)
- [ ] **Naming conventions confirmed** (Reinvestment node labels, banner text)
- [ ] **Tax treatment approved** (plan-level rate in MVP, defer IRA tax-deferred to Phase 2)

### During Execution
- [ ] **PR #1 merged** (simulation engine + tests green)
- [ ] **PR #2 merged** (toggle + visual inspection pass)
- [ ] **PR #3 merged** (Sankey + visual regression pass)
- [ ] **PR #4 merged** (plan page + smoke test pass)
- [ ] **PR #5 verified** (zero regressions in 519 baseline tests)

### Post-Merge
- [ ] **User acceptance** (Jony tests in staging with real portfolio data)
- [ ] **Performance benchmarks met** (< 500ms page load, no chart lag)
- [ ] **History.md updated** (Keaton, McManus, Fenster, Redfoot log learnings)

---

## Ownership Summary

**Architecture & Review:** Keaton (this document, code review for all PRs)
**Simulation Logic:** McManus (simulation.ts changes, mass conservation tests) — Redfoot implements
**Frontend UI:** Fenster (toggle, Sankey, plan page) — Redfoot implements
**Backend Audit:** Hockney (confirmed no worker needed, data pipeline complete)
**Testing & Implementation:** Redfoot (28 test cases, 5 PRs, regression verification)

---

**Ready for Jony's approval when 8 open questions addressed.**
