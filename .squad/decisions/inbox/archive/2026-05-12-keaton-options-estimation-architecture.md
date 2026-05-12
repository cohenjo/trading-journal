# Options Income Estimation — Architecture Decisions

**Date:** 2026-05-12
**Author:** Keaton (Lead)
**Issues:** #428, #429, #430, #431, #432

## Decisions

### 1. Projection lives in a server action, not a backend API

The estimation function `getOptionsIncomeEstimation()` lives in `apps/frontend/src/app/options/actions.ts` as a `"use server"` action — co-located with `getOptionsYearlyCashFlow()`. This follows the established dividends pattern where projections are computed in Next.js server actions, not in the Python backend.

**Rationale:** All existing income projections (dividends, bonds) are computed in the frontend server actions layer. Adding a new backend endpoint would create an inconsistent pattern.

### 2. Negative baselines are projected forward (not floored at zero)

If the 3-year average of options income is negative (net losses), the projection carries the negative forward with growth. This honestly represents the trajectory.

**Rationale:** Flooring at zero would hide real loss trends. Users need accurate projections for financial planning.

### 3. Reuse existing settings (`optionsGrowthRate`, `optionsFinalYear`)

The SettingsContext already has `optionsGrowthRate` (default 5%) and `optionsFinalYear` (default 2064). The estimation engine uses these — no new settings fields needed.

**Note:** The user mentioned "default 2% growth" but the existing setting defaults to 5%. McManus should verify with Jony whether to change the default or keep 5%.

### 4. Summary page: actuals win over projections for overlapping years

When merging historical actuals from `getOptionsYearlyCashFlow()` with projections from the estimation engine, actuals take precedence for any overlapping year. This prevents double-counting.

### 5. Plan page: options income is an optional additive income line

The plan simulation engine accepts options projections as an optional input. When absent, the plan works exactly as before (backward compatible). Options income appears in `income_details` as `{ name: "Options Income", type: "options" }`.
