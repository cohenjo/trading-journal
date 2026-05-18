# Keaton Review — Cash-Flow Dividend Redesign Implementation

**Verdict**: REJECT

**Scope reviewed**: commits 6f5fd5d, 09cd6c1, 9c42238, 514f16d on branch squad/cashflow-dividend-redesign

## Critical findings (blockers)
1. **Current-year mapped accounts still double-count synthetic yield dividends.** `skipAccountIds` only applies inside `processGrowthAndIncome()` for `year > currentYear`. On projection year 0, `calculatePlanSimulation()` still calls `currentDividendPayouts()`, so a mapped account can emit both `Dividend: {account}` and `Dividend - {ACCOUNT}`. I reproduced this with a single `IBKR` account at 5% yield plus `dividendByAccount.ibkr = 12000`: year 0 emitted `$5,000` synthetic + `$12,000` real dividends, `total_dividend_income` became `17000`, and the account ended at `117000` instead of `112000`. This is a financial-correctness blocker.
2. **IRA mapping is not the approved type-based fallback and silently misses common real accounts.** The implementation maps IRA by `name.includes('ira')`/`'leumi'` and, in simulation, oddly prefers `type === 'Pension'` before falling back to name matching. It does **not** map a normal `type: 'IRA'` account unless the name itself contains `ira`. I reproduced this with `{ name: 'Retirement', type: 'IRA' }`: the year emits `Dividend - IRA` and `Dividend Reinvest - IRA`, but the account balance never changes. The same name-only heuristic is used in `PlanAccountDetails`, so the UI lockout also fails on those accounts. This is silent under-modeling.

## Important findings (should fix before merge)
1. **`total_dividend_income` fallback is still wrong.** The recent fix covers the per-account path only. If `dividendByAccount` is absent or all zero, `income_details` correctly shows `Dividend Income`, but `total_dividend_income` still stays `0`. I reproduced this with `dividendTotal.annualTotal = 5000`. That breaks the documented backward-compat/all-zero fallback and is currently untested.
2. **The Sankey shape does not match the approved design.** Reinvestment destination nodes do get the new accent color, but the graph still routes them through `Inflows -> Net Savings -> Dividend Reinvest - X`. The approved design was direct `Dividend - X -> Dividend Reinvest - X` edges. Current tests only assert node presence/color, so this topology regression would ship unnoticed.
3. **Approved tax default #6 is still not implemented.** Real per-account dividends are added to `grossIncome` and `taxableIncome`, but they never increase `tax_paid`. Test 9 only checks that no `type: 'tax'` row exists; it does not validate the approved “all dividends taxed equally” behavior.
4. **The `@ts-expect-error` comments in `plan/page.tsx` and `cash-flow/page.tsx` are stale.** `PlanSimulationInput` already includes `dividendByAccount`, so these suppressions should be removed. They now hide future call-site drift in two critical entry points.
5. **The new tests are useful, but they miss the real edge cases that matter most.** Missing coverage: (a) year-0 double-count on mapped accounts, (b) IRA type-only mapping, (c) `dividendByAccount = { ibkr: 0, schwab: 0, ira: 0 }` fallback, and (d) Sankey link topology / monthly scaling of nested arrays passed into Sankey.

## Nits (optional)
1. The plan implementation ships an inline per-account banner inside `PlanAccountDetails`, not the page-level consolidated banner from the approval doc. That is workable, but it is a design drift that should be either explicitly accepted or aligned.
2. The `dividendAutoAccounts` prop chain is noticeable (`page -> PlanEditor -> PlanModal -> PlanAccountDetails`), but I would not introduce context for this alone. It is still narrow and local.

## What's solid
- The monthly/yearly toggle is correctly local state only; no `localStorage` persistence slipped in.
- `displayData` does scale the nested arrays used by Sankey (`income_details`, `expense_details`, `savings_details`, `withdrawal_details`), not just the top-line summary fields.
- The reinvestment math for the tested partial-deficit scenario is sound, and the post-implementation test fixes (USD pinning, removing salary from the growth test, year-0 expectation correction) are correct.
- `CashFlowSankey.test.tsx` properly mocks `ResponsiveSankey`, and the suite state I reviewed matches the branch: `npx vitest run --reporter=dot 2>&1 | tail -10` => `710/713` with `3` pre-existing failures.
- I did not find a new session/household leak in this change set; `getDividendSummary()` and `getLadderIncome()` remain household-scoped server actions.

## Final
Block
