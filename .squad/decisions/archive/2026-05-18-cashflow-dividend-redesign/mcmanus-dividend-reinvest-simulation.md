# Dividend Reinvestment Simulation Design

**Author**: McManus (Data/Finance Dev)
**Date**: 2025-06-09
**Status**: Design / Pre-implementation
**Related**: Dividend inventory work (2026-05-11, 2026-05-13)

## Problem Statement

The current financial planning simulation uses **synthetic yield-driven dividends** computed from `account.value * yield/100`. This produces:
- Single aggregate "Dividend Income" entry in income_details
- No per-account visibility into dividend sources
- No automatic reinvestment modeling
- Disconnection from real dividend data in the system

We need to **replace this with real per-account dividend data** from `getDividendSummary()` (IBKR, Schwab, IRA accounts) and model:
- 3 distinct dividend income streams (one per account)
- 3 corresponding automatic reinvestment outflows
- Proper cash-flow Sankey visualization showing both sides of the dividend cycle

This is **design-only work**—implementation by Redfoot (Test/Code Implementation).

---

## Section 1: Replace Dividend Source

### 1.1 Input Contract

**Current state** (simulation.ts lines 566-598):
```typescript
// AccountManager.processGrowthAndIncome()
const dividend = grossDividend(account); // Uses yield or fixed amount
```

**New contract**:
```typescript
interface PlanSimulationInput {
  // ... existing fields ...
  dividendByAccount?: {
    ibkr: number;      // Annual dividend in USD
    schwab: number;    // Annual dividend in USD
    ira: number;       // Annual dividend in USD
  };
}
```

**Data source**: `getDividendSummary()` from dividends/actions.ts (line 1211-1239)
- Returns `{ by_account: { ibkr, schwab, ira } }`
- Values are USD-converted via `convertCurrency(amt, p.currency ?? 'USD', 'USD')`
- Values are in major units (USD, not cents)
- Sourced from `dividend_accruals.gross_rate * position_qty` (forward annual)

**Caller responsibility** (cash-flow/page.tsx):
```typescript
const dividendSummary = await getDividendSummary();
const result = await runPlanSimulation({
  // ...
  dividendByAccount: dividendSummary.by_account,
});
```

### 1.2 Account Mapping Strategy

**Challenge**: by_account keys are 'ibkr', 'schwab', 'ira' (lowercase strings), but AccountManager.accounts have `name`, `type`, `owner` fields with no guaranteed standard naming.

**Recommended mapping**:
```typescript
function mapDividendToAccount(
  accountKey: string,
  accounts: Account[]
): Account | null {
  // Strategy 1: Exact name match (case-insensitive)
  const byName = accounts.find(
    a => a.name.toLowerCase() === accountKey.toLowerCase()
  );
  if (byName) return byName;

  // Strategy 2: Type-based fallback for IRA
  if (accountKey === 'ira') {
    const byType = accounts.find(a => a.type === 'retirement');
    if (byType) return byType;
  }

  // Strategy 3: Fuzzy match for IBKR/Schwab
  // (e.g., "Interactive Brokers" contains "ibkr")
  const fuzzy = accounts.find(
    a => a.name.toLowerCase().includes(accountKey)
  );
  if (fuzzy) return fuzzy;

  return null; // No match
}
```

**Alternative**: Add explicit `dividendAccountId` field to Account interface for user configuration.

### 1.3 Fallback Behavior

**When by_account key has no matching plan account**:
- **Option A**: Create synthetic "Dividend - {accountKey}" entry (no account.value, just income)
- **Option B**: Skip that dividend source entirely (log warning)
- **Option C**: Aggregate unmapped dividends into "Other Dividend Income"

**Recommendation**: Option A with warning—user visibility is critical for debugging.

**When dividendByAccount is undefined**:
- Fall back to legacy yield-based computation (backward compatibility)
- Log INFO message: "Using legacy yield-based dividends; consider providing dividendByAccount"

---

## Section 2: Per-Account Income Entries

### 2.1 Income Details Structure

**Current state** (simulation.ts line 882-888):
```typescript
income_details.push({
  name: 'Dividend Income',
  type: 'dividend' as const,
  amount: convertedDividend,
});
```

**New structure**:
```typescript
// For each dividend source (ibkr, schwab, ira):
income_details.push({
  name: `Dividend - ${accountName}`,  // e.g., "Dividend - IBKR"
  type: 'dividend' as const,
  amount: convertedDividendAmount,
});
```

### 2.2 Naming Convention

- **Format**: `"Dividend - {Account Name}"`
- **Examples**:
  - `"Dividend - IBKR"`
  - `"Dividend - Schwab"`
  - `"Dividend - IRA"`
- **Unmapped sources**: `"Dividend - {accountKey}"` (e.g., "Dividend - ibkr")

### 2.3 Currency Conversion

**Context**: simulation.ts lines 242-247 define `convert(amount, fromCurrency, toCurrency)` helper.

**getDividendSummary amounts are USD**. If `settings.mainCurrency === 'ILS'`:
```typescript
const usdAmount = dividendByAccount[accountKey];
const convertedAmount = convert(usdAmount, 'USD', settings.mainCurrency);
```

**Add to grossIncome**:
```typescript
const yearIncome = { gross: 0, net: 0, details: [] };
// For each dividend source:
yearIncome.gross += convertedAmount;
yearIncome.details.push({
  name: `Dividend - ${accountName}`,
  type: 'dividend',
  amount: convertedAmount,
});
```

---

## Section 3: Reinvestment Outflow Semantics

### 3.1 Surplus vs Deficit Logic

**Surplus year** (`yearIncome.net >= plannedExpenses`):
- All dividends reinvest to their source accounts
- No withdrawals needed

**Deficit year** (`yearIncome.net < plannedExpenses`):
- Dividends used to cover spending gap **first**
- Only residual dividends reinvest
- If dividend income insufficient, trigger withdrawals from accounts

**Calculation**:
```typescript
const deficit = plannedExpenses - yearIncome.net;
const totalDividends = sum(dividendByAccount);

if (deficit <= 0) {
  // Surplus: full reinvestment
  reinvestableAmount = totalDividends;
} else if (deficit >= totalDividends) {
  // Large deficit: no reinvestment
  reinvestableAmount = 0;
  remainingDeficit = deficit - totalDividends;
  // Trigger withdrawals for remainingDeficit
} else {
  // Partial reinvestment
  reinvestableAmount = totalDividends - deficit;
}
```

### 3.2 Proportional Reinvestment Formula

When `reinvestableAmount < totalDividends`, distribute proportionally:
```typescript
for (const [accountKey, dividendAmount] of dividendByAccount) {
  const proportion = dividendAmount / totalDividends;
  const reinvestAmount = reinvestableAmount * proportion;

  account.value += reinvestAmount; // Add to account balance

  // Record in savings_details:
  savings_details.push({
    name: `Dividend Reinvest - ${accountName}`,
    type: 'reinvestment',
    amount: reinvestAmount,
  });
}
```

### 3.3 Interaction with processDeficit()

**Current withdrawal logic** (simulation.ts lines 628-665):
```typescript
accountManager.processDeficit(deficit, settings.mainCurrency);
```

**Modified flow**:
1. Compute `totalDividends` from dividendByAccount
2. If `deficit <= totalDividends`:
   - Reduce reinvestableAmount
   - Do NOT call processDeficit()
3. If `deficit > totalDividends`:
   - Zero reinvestment
   - Call `processDeficit(deficit - totalDividends, ...)`

**Critical**: Dividends offset deficit **before** withdrawals—this preserves account balances.

---

## Section 4: Mass Conservation Invariants

### 4.1 Surplus Year Balance Equation

```
sum(dividend income entries) == sum(reinvestment outflow entries)
```

**Example**:
- Income: Dividend - IBKR ($10K) + Dividend - Schwab ($5K) + Dividend - IRA ($3K) = $18K
- Savings: Reinvest - IBKR ($10K) + Reinvest - Schwab ($5K) + Reinvest - IRA ($3K) = $18K

### 4.2 Deficit Year Balance Equation

```
sum(dividend income) == sum(reinvestment outflows) + dividends_used_for_spending
```

**Example** (deficit = $15K, total dividends = $18K):
- Income: $18K dividends
- Used for spending: $15K (not reinvested)
- Savings: $3K reinvestment ($1.67K IBKR, $0.83K Schwab, $0.50K IRA per proportion)
- Withdrawals: $0 (no need to tap accounts)

**Example** (deficit = $25K, total dividends = $18K):
- Income: $18K dividends
- Used for spending: $18K (fully consumed)
- Savings: $0 reinvestment
- Withdrawals: $7K from accounts (via processDeficit)

### 4.3 Test Invariants

For Redfoot to implement:
```typescript
describe('Dividend reinvestment mass conservation', () => {
  it('surplus year: income == reinvestment', () => {
    const result = runPlanSimulation({ ... });
    const year = result.yearly_snapshots[0];

    const dividendIncome = year.income_details
      .filter(d => d.type === 'dividend')
      .reduce((sum, d) => sum + d.amount, 0);

    const reinvestment = year.savings_details
      .filter(s => s.name.startsWith('Dividend Reinvest'))
      .reduce((sum, s) => sum + s.amount, 0);

    expect(dividendIncome).toBeCloseTo(reinvestment, 2);
  });

  it('deficit year: partial reinvestment + spending use', () => {
    const result = runPlanSimulation({ ... }); // High expenses
    const year = result.yearly_snapshots[0];

    const dividendIncome = year.income_details
      .filter(d => d.type === 'dividend')
      .reduce((sum, d) => sum + d.amount, 0);

    const reinvestment = year.savings_details
      .filter(s => s.name.startsWith('Dividend Reinvest'))
      .reduce((sum, s) => sum + s.amount, 0);

    const withdrawals = year.withdrawal_details
      .reduce((sum, w) => sum + w.amount, 0);

    const deficit = year.expenses.total - year.income.net;

    // Dividends cover part of deficit, withdrawals cover the rest
    expect(dividendIncome + withdrawals).toBeGreaterThanOrEqual(deficit);
    expect(reinvestment).toBeLessThan(dividendIncome); // Not full reinvestment
  });
});
```

---

## Section 5: Tax Treatment

### 5.1 Gross vs Net Amounts

**getDividendSummary returns GROSS dividends** (`forward_dividend_annual` from dividend_accruals.gross_rate).

**Current tax application** (simulation.ts line 567):
```typescript
const tax = dividend * (account.dividend_tax_rate / 100);
const netDividend = dividend - tax;
```

### 5.2 Tax Rate Application

**Option A**: Per-account tax rates
- Use `account.dividend_tax_rate` for each matched account
- Unmapped sources: use plan-level default (e.g., 25%)

**Option B**: Single plan-level rate
- Add `dividendTaxRate` field to PlanSimulationInput
- Apply uniformly to all dividend sources

**Recommendation**: Option A (per-account) for accuracy, with plan-level fallback:
```typescript
const taxRate = account?.dividend_tax_rate ?? settings.default_dividend_tax_rate ?? 25;
const grossDividend = dividendByAccount[accountKey];
const tax = grossDividend * (taxRate / 100);
const netDividend = grossDividend - tax;

yearIncome.gross += grossDividend;
yearIncome.net += netDividend;
```

### 5.3 Reinvestment Source

**Question**: Do we reinvest gross or net dividends?

**Real-world answer**: **Net** (after tax). Taxes are paid, only net amount available for reinvestment.

**Implementation**:
```typescript
const reinvestableNetDividends = totalNetDividends - Math.max(0, deficit);
// Distribute reinvestableNetDividends proportionally by net dividend amounts
```

---

## Section 6: Backward Compatibility & Deprecation

### 6.1 Deprecated Account Fields

When `dividendByAccount` is provided, these fields are **ignored**:
- `account.dividend_mode` ('percentage' | 'fixed')
- `account.dividend_yield` (percentage)
- `account.dividend_fixed_amount` (currency)

**Still used**:
- `account.dividend_tax_rate` (per-account tax calculation)
- `account.dividend_growth_rate` (future: escalate real dividends?)

### 6.2 Legacy Fallback

**When dividendByAccount is undefined/null**:
- Use existing `currentDividendPayouts()` and `grossDividend()` methods
- Maintain single aggregate "Dividend Income" entry
- No reinvestment modeling (current behavior)

**Code structure**:
```typescript
if (planInput.dividendByAccount) {
  // NEW: Real dividend logic
  processDividendsByAccount(planInput.dividendByAccount, yearIncome, accountManager);
} else {
  // LEGACY: Yield-based aggregate dividend
  const totalDividend = planInput.dividendTotal?.annualTotal ?? 0;
  const converted = convert(totalDividend, 'USD', settings.mainCurrency);
  yearIncome.gross += converted;
  yearIncome.details.push({ name: 'Dividend Income', type: 'dividend', amount: converted });
}
```

### 6.3 Feature Flag Consideration

**Optional**: Add `useDividendsByAccount` boolean flag to allow users to toggle between modes during transition.

**Not recommended initially**—rely on presence/absence of `dividendByAccount` field as implicit flag.

---

## Section 7: Account Growth Interaction

### 7.1 Total Return vs Price Growth

**Current growth application** (simulation.ts line 568):
```typescript
account.value = value * (1 + growth/100) - value * fees/100;
```

**Risk**: If user sets `account.growth` to **total return** (price appreciation + dividend yield), and we also add real dividends, this **double-counts** dividend income.

### 7.2 User Guidance

**When using real dividends**:
- User MUST set `account.growth` to **price growth only** (exclude dividend yield)
- Example: If historical total return is 10% (7% growth + 3% dividend yield), set growth = 7%

**Documentation needed**:
- Add tooltip/help text in UI: "When using real dividend data, set Growth to capital appreciation only (exclude yield)"
- Show warning if `dividendByAccount` is provided AND `account.dividend_yield > 0`

### 7.3 Growth Field Semantics

**Recommendation**: Do NOT change field semantics. Instead:
- Add `account.growth_includes_dividends` boolean flag (default: true for backward compat)
- If `dividendByAccount` provided AND `growth_includes_dividends === true`, log warning

**Alternative**: Rename field to `capital_growth_rate` in future migration (breaking change).

---

## Section 8: Currency Handling

### 8.1 USD → Main Currency Conversion

**getDividendSummary returns USD amounts**. Simulation uses `settings.mainCurrency` (USD or ILS).

**Conversion helper** (simulation.ts lines 242-247):
```typescript
function convert(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return amount;
  const rate = RATES[`${fromCurrency}${toCurrency}`];
  if (!rate) throw new Error(`No rate for ${fromCurrency}→${toCurrency}`);
  return amount * rate;
}
```

**Application**:
```typescript
for (const [accountKey, usdAmount] of Object.entries(dividendByAccount)) {
  const amount = convert(usdAmount, 'USD', settings.mainCurrency);
  // Use amount for income_details and reinvestment
}
```

### 8.2 RATES Constant

**Context**: RATES object likely defined near convert() helper (lines 240-250).

**Required rates**:
- `USDILS`: USD → ILS exchange rate
- `ILSUSD`: ILS → USD exchange rate (inverse)

**Fallback**: If mainCurrency not in RATES, throw error with helpful message.

---

## Section 9: First Year Handling

### 9.1 Current Year Dividend Computation

**Current system** (simulation.ts line 808):
```typescript
if (projectionYear === settings.currentYear) {
  dividendAnnualTotal = accountManager.currentDividendPayouts();
}
```

**Problem**: `currentDividendPayouts()` uses yield-based calculation even when real data available.

### 9.2 New First Year Logic

**Use real dividends for current year too**:
```typescript
if (planInput.dividendByAccount) {
  // Use real dividends for all years (including current)
  processDividendsByAccount(planInput.dividendByAccount, yearIncome, accountManager);
} else if (projectionYear === settings.currentYear) {
  // LEGACY: yield-based for current year only
  const currentYearDividends = accountManager.currentDividendPayouts();
  // ... add to income
} else {
  // LEGACY: aggregate total for future years
  const totalDividend = planInput.dividendTotal?.annualTotal ?? 0;
  // ... add to income
}
```

### 9.3 Dividend Growth Projection

**Future enhancement** (not in initial scope):
- Use `account.dividend_growth_rate` to escalate dividendByAccount amounts in future years
- Formula: `futureYearAmount = year0Amount * (1 + growthRate/100)^years`
- For now: assume constant real dividends across all projection years

---

## Section 10: Test Requirements for Redfoot

### 10.1 Unit Tests (simulate.test.ts)

**Test cases to implement**:

1. **Basic 3-source dividend income**:
   - Input: dividendByAccount = { ibkr: 10000, schwab: 5000, ira: 3000 }
   - Assert: 3 income_details entries with correct names and amounts
   - Assert: sum(dividend income) === 18000 (USD)

2. **Surplus year full reinvestment**:
   - Input: Low expenses, dividendByAccount with 3 sources
   - Assert: 3 savings_details entries ("Dividend Reinvest - ...")
   - Assert: sum(reinvestment) === sum(dividend income)
   - Assert: account.value increases match reinvest amounts

3. **Deficit year partial reinvestment**:
   - Input: High expenses, deficit < total dividends
   - Assert: sum(reinvestment) === total dividends - deficit
   - Assert: proportional distribution across accounts
   - Assert: no withdrawals (dividends cover deficit)

4. **Deficit year no reinvestment**:
   - Input: Very high expenses, deficit > total dividends
   - Assert: sum(reinvestment) === 0
   - Assert: withdrawals === deficit - total dividends
   - Assert: dividends reduce deficit before withdrawals

5. **Currency conversion (ILS main currency)**:
   - Input: settings.mainCurrency = 'ILS', dividendByAccount in USD
   - Assert: income_details amounts are in ILS
   - Assert: reinvestment amounts are in ILS

6. **Account mapping**:
   - Input: Account with name "Interactive Brokers", dividendByAccount.ibkr = 10000
   - Assert: Maps to correct account (case-insensitive)
   - Assert: account.value increases by reinvestment

7. **Unmapped dividend source**:
   - Input: dividendByAccount.ibkr = 10000, no account with matching name
   - Assert: Income entry exists ("Dividend - ibkr")
   - Assert: No account.value increase (synthetic entry)
   - Assert: Warning logged

8. **Tax application**:
   - Input: dividendByAccount.ibkr = 10000, account.dividend_tax_rate = 25
   - Assert: gross income += 10000
   - Assert: net income += 7500
   - Assert: reinvestment based on net amount (7500)

9. **Legacy fallback**:
   - Input: dividendByAccount = undefined, dividendTotal = 20000
   - Assert: Single "Dividend Income" entry
   - Assert: No reinvestment entries
   - Assert: No per-account dividend details

10. **Multi-year projection**:
    - Input: 5-year projection, constant dividendByAccount
    - Assert: All 5 years show 3 dividend sources + 3 reinvestments (surplus scenario)
    - Assert: account.value compounds correctly with reinvestment

### 10.2 Integration Tests

**Sankey diagram validation** (cash-flow/page.tsx):
- Run full simulation with dividendByAccount
- Assert: Sankey shows 3 "Dividend - {account}" income nodes
- Assert: Sankey shows 3 "Dividend Reinvest - {account}" outflow nodes
- Assert: Visual verification of dividend cycle

### 10.3 Edge Cases

1. **Zero dividend account**: dividendByAccount.schwab = 0
   - Assert: No income or reinvestment entry for Schwab (skip zero amounts)

2. **Negative deficit** (income > expenses):
   - Assert: Full reinvestment + additional savings from other income

3. **First year vs future years**:
   - Assert: No special-casing for currentYear when using dividendByAccount

4. **Missing by_account keys**:
   - Input: dividendByAccount = { ibkr: 10000 } (only one source)
   - Assert: Only 1 income + 1 reinvestment entry

---

## Implementation Checklist for Redfoot

**Phase 1: Core dividend replacement**
- [ ] Add `dividendByAccount?: { ibkr, schwab, ira }` to PlanSimulationInput interface
- [ ] Implement `mapDividendToAccount(accountKey, accounts)` helper
- [ ] Create `processDividendsByAccount()` function to replace yield-based logic
- [ ] Add per-account income_details entries with correct naming
- [ ] Apply currency conversion (USD → mainCurrency)
- [ ] Apply per-account tax rates (gross → net)

**Phase 2: Reinvestment logic**
- [ ] Calculate `reinvestableAmount` based on surplus/deficit
- [ ] Implement proportional distribution when partial reinvestment
- [ ] Add `account.value += reinvestAmount` for matched accounts
- [ ] Create savings_details entries ("Dividend Reinvest - {account}")
- [ ] Modify processDeficit() interaction (dividends offset deficit first)

**Phase 3: Backward compatibility**
- [ ] Preserve legacy yield-based path when dividendByAccount undefined
- [ ] Ensure no breaking changes to existing tests
- [ ] Add feature detection (if dividendByAccount provided, use new path)

**Phase 4: Testing**
- [ ] Implement 10 unit tests from Section 10.1
- [ ] Add integration test for Sankey visualization
- [ ] Test all edge cases from Section 10.3
- [ ] Validate mass conservation invariants (income == reinvest in surplus)

**Phase 5: Documentation**
- [ ] Update simulation.ts inline comments
- [ ] Add JSDoc for new functions
- [ ] Document user-facing changes (growth field semantics)
- [ ] Add UI help text about price growth vs total return

---

## Open Questions for User Review

1. **Account mapping**: Should we add explicit `dividendAccountId` field to Account interface, or rely on name/type matching?

2. **Unmapped sources**: Prefer synthetic entry (Option A) or skip entirely (Option B)?

3. **Tax rate**: Per-account (`account.dividend_tax_rate`) or single plan-level rate?

4. **Feature flag**: Explicit `useDividendsByAccount` boolean, or implicit based on field presence?

5. **Growth field**: Add `growth_includes_dividends` flag, or just documentation warning?

6. **Dividend growth**: Should dividendByAccount amounts escalate over projection years using `dividend_growth_rate`, or assume constant?

---

## References

**Files analyzed**:
- `apps/frontend/src/app/plan/simulation.ts` (main simulation engine)
- `apps/frontend/src/app/dividends/actions.ts` (getDividendSummary at line 1211)
- `apps/frontend/src/types/dividends.ts` (DividendSummaryResult interface)
- `apps/frontend/src/app/cash-flow/page.tsx` (caller passing dividendTotal)
- `apps/frontend/src/app/plan/__tests__/simulate.test.ts` (test patterns)

**Related work**:
- `.squad/agents/mcmanus/history.md` (dividend data inventory, 2026-05-11/13)
- Flex pipeline validation for IBKR dividend data
- Options income projection research

**Next steps**:
- User review of design decisions (6 open questions)
- Redfoot implementation following checklist
- McManus validation of mass conservation in final PR review
