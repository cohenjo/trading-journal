# McManus Implementation Deviation Note

**Author:** McManus (Data/Finance Dev)
**Date:** 2026-05-18
**Branch:** squad/cashflow-dividend-redesign
**Commit:** 6f5fd5d

## Summary

No architectural deviations from the approved spec. One minor optimization noted below.

## Minor Deviation: perAccountDividends pre-computed outside the loop

**Spec pseudocode** placed `const mainCurrency = ...` and `const ibkrAmount = convert(...)` inside the per-year projection loop.

**Implementation** computes `mainCurrency`, `perAccountDividends`, and `totalRealDividendsAnnual` **once before** the `for (year)` loop.

**Rationale:** The spec specifies these values are "constant across all simulation years" (default #4: no escalation). Computing them inside the loop is semantically equivalent but allocates new Decimal objects every year (70–95 allocations over a typical projection). Pre-computing once is strictly more efficient with zero behavior difference.

**Impact:** None — Redfoot test cases will pass identically. No backward-compat change.

## All 8 Defaults Applied As Specified

| Default | Decision | Applied |
|---------|----------|---------|
| #1 Toggle persistence | No | N/A (Fenster's scope) |
| #2 Reinvest naming | "Dividend Reinvest - IBKR" | ✅ |
| #3 Plan page | Hide yield controls + banner | N/A (Fenster's scope) |
| #4 Dividend growth | CONSTANT | ✅ |
| #5 Deficit | Dividends offset deficit BEFORE withdrawals | ✅ |
| #6 IRA tax | All dividends taxed equally | ✅ |
| #7 Account mapping failures | Silent synthetic node | ✅ |
| #8 Monthly toggle scope | ALL income/expense | N/A (Fenster's scope) |
