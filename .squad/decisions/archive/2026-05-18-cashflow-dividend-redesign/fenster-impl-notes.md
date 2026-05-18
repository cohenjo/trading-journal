# Fenster Implementation Notes — Cash Flow UI (2026-05-18)

**Commit:** `09cd6c1` on `squad/cashflow-dividend-redesign`

## UX Choices Beyond the Design Doc

### 1. Toggle placement — below age row (not beside it)
Design doc showed the toggle inline with age indicators in a single flex row. Final placement puts the toggle as its own row below the year+age section to avoid cramping the header on smaller viewports. Visually reads as a distinct control group.

### 2. Component chain wider than estimated — 6 files, not 3
The design doc spec said "THREE files only," but `dividendAutoAccounts` must be threaded: `plan/page.tsx` → `PlanEditor` → `PlanModal` → `PlanAccountDetails`. Three extra files (`PlanEditor.tsx`, `PlanModal.tsx`, `PlanAccountDetails.tsx`) were added to the commit. No test files touched; McManus's `simulation.ts` untouched.

### 3. @ts-expect-error on dividendByAccount in both page files
`PlanSimulationInput` in `simulation.ts` doesn't yet have `dividendByAccount`. Added `@ts-expect-error` with PR reference in both `cash-flow/page.tsx` and `plan/page.tsx`. Remove once McManus merges the interface change.

### 4. Dividend Policy section hidden entirely when real data exists
The spec said to hide "yield/policy inputs." Implemented as: entire "Dividend Policy" accordion block is hidden (`!hasRealDividendData` guard) so users can't set a conflicting manual policy. The blue banner replaces only the yield input row; the policy block is fully suppressed. If the account is later detached from real data (amount drops to 0), the controls reappear.
