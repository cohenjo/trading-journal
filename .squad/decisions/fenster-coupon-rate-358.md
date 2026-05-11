# Decision: Extract displayCouponRate() utility (#358)

**Date:** 2026-05-12
**Author:** Fenster (Frontend Dev)
**Issue:** #358

## Context

Bond coupon rates flow through two conventions in the codebase:

1. **Percentage** (`bond_holdings.coupon_rate`): DB-native unit — 4.25 means 4.25%.
   Used in `apps/frontend/src/app/holdings/page.tsx`.
2. **Decimal** (normalised by `getLadderOverviewByAccount` / `getLadderBondHoldings`):
   `bond_holdings.coupon_rate` ÷ 100 before populating the `Bond` type in Ladder components.
   Used in `apps/frontend/src/app/ladder/page.tsx` and `apps/frontend/src/components/Ladder/RungDetails.tsx`.

Bug-2 (previous sprint) was caused by accidentally applying `× 100` to a value already in percentage units, producing "387.5%" instead of "3.875%". The fix was inline. This refactor extracts a shared utility so regression is impossible.

## Decision

Created `apps/frontend/src/lib/bonds/coupon-rate.ts` containing:

- `displayCouponRate(raw, options?)` — formats a raw coupon-rate value for display.
  Accepts `kind: 'percentage' | 'decimal'` (default: `'percentage'`) and `decimals` (default: 3).
- `parseCouponRate(raw)` — parses an unknown input to a coupon-rate number or null.

All three call sites that previously inlined coupon formatting now use this utility:
- `holdings/page.tsx` — `displayCouponRate(h.coupon_rate)` (percentage kind, 3dp)
- `ladder/page.tsx` — `displayCouponRate(bond.coupon_rate, { kind: 'decimal' })` (3dp)
- `components/Ladder/RungDetails.tsx` — same as ladder page

## Test coverage

28 unit tests in `src/lib/bonds/__tests__/coupon-rate.test.ts`. All 519 tests pass.

## Impact

- No DB or backend changes.
- No dividends, summary, or accounts-tab code touched.
- Build: ✅ passes.
