# Hockney — Bond Backend Drop-Box
**Date:** 2026-05-11T00:10:00+03:00
**Issues:** #356 (Bond Ladder API), #357 (Bond Interest Realized)
**Commit:** d47bd6e

---

## #356 — Bond Ladder API Contract (Final)

### Source of truth: `bond_holdings` table (18 IBKR flex rows)

`getLadderOverview()` and `getLadderIncome()` now read from **both** `bond_holdings` AND `ladder_bonds`, merging them (dedup by `id`). `bond_holdings` rows come first; manual `ladder_bonds` rows supplement.

**fetchHoldingBonds() mapping:**
```typescript
// bond_holdings → Bond
{
  id:               row.id,                              // flex PK e.g. "flex_U2515365_647589171_2026-05-08"
  ticker:           row.ticker,                         // IBKR ticker e.g. "AAPL 4 1/4 02/09/47"
  issuer:           row.issuer ?? row.ticker ?? row.id, // NULL for flex bonds → fallback to ticker
  currency:         row.currency ?? 'USD',
  face_value:       Number(row.face_value),
  coupon_rate:      Number(row.coupon_rate ?? 0) / 100, // *** CRITICAL: 4.25 → 0.0425 ***
  coupon_frequency: row.coupon_frequency ?? 'SEMI_ANNUAL', // NULL for flex → default SEMI_ANNUAL
  maturity_date:    String(row.maturity_date),          // ISO date string
  rung_id:          rungIdForYear(year),               // derived from maturity year
}
```

**Key invariant:** `bond_holdings.coupon_rate` = **PERCENTAGE** units (4.25 = 4.25%).
The `Bond` type and `generateCashflowsForBond` expect **decimal** (0.0425).
`fetchHoldingBonds` divides by 100. Fenster: do NOT multiply by 100 when displaying `bond_holdings.coupon_rate` — only use the `Bond.coupon_rate` field (already decimal) in calculations.

### Ladder data shape Fenster needs:
```typescript
// Bond type (unchanged from before, same interface)
type Bond = {
  id: string;           // "flex_U2515365_647589171_2026-05-08" for IBKR bonds
  ticker: string | null;
  issuer: string;       // fallback to ticker for IBKR flex bonds
  currency: string;     // 'USD'
  face_value: number;   // e.g. 10000
  coupon_rate: number;  // DECIMAL (0.0425, not 4.25) — safe to use in calculations
  coupon_frequency: string; // 'SEMI_ANNUAL' for IBKR bonds
  maturity_date: string;    // ISO date "2030-02-15"
  rung_id: string;          // "2030"
}
```

---

## #357 — getYearlyBondInterest API Contract (Final)

**Location:** `apps/frontend/src/app/summary/actions.ts`

```typescript
export async function getYearlyBondInterest(): Promise<Array<{ year: number; net_amount: number }>>
```

- Reads from `options_cash_events` WHERE `event_category = 'interest'`
- Filters in JS: `raw_payload->>'type' IN ('Bond Interest Received', 'Bond Interest Paid')`
- Groups by `EXTRACT(YEAR FROM event_date)`; sums `amount` (paid rows have negative amounts from IBKR)
- Rounds to 2 decimal places
- Excludes years with zero net activity
- Returns `[]` if unauthenticated or DB error
- RLS: `household_id = requireHouseholdId()` filter applied explicitly

**Note:** Replaced a pre-existing stub in `actions.ts` that read from a non-existent `bond_income_history` table. The new implementation reads from the correct `options_cash_events` table.

---

## Per-Year Bond Interest Totals (for Fenster sanity-check)

From confirmed DB query (mission brief):
```sql
-- Bond Interest Paid:     46 events, SUM(amount) = -1321.72
-- Bond Interest Received: 57 events, SUM(amount) =  5590.06
-- Net total (all years):               4268.34
```

Expected `getYearlyBondInterest()` output shape:
```typescript
[
  { year: 2024, net_amount: <tbd — run getYearlyBondInterest() against live DB> },
  { year: 2025, net_amount: <tbd> },
  { year: 2026, net_amount: <tbd> },
]
// Grand total of net_amount values should equal 4268.34
```

Fenster: use this to sanity-check the chart rendering. The sum of all `net_amount` values should be ~4268.34.

---

## Schema Notes for Fenster

### bond_holdings columns (relevant to ladder display):
| column | type | notes |
|--------|------|-------|
| `id` | text | flex PK like `flex_U2515365_647589171_2026-05-08` |
| `ticker` | text \| null | IBKR ticker (encodes coupon+maturity for bonds) |
| `issuer` | text \| null | NULL for flex bonds; use ticker as display name |
| `currency` | text | 'USD' for all 18 live bonds |
| `face_value` | numeric | e.g. 10000 |
| `coupon_rate` | numeric \| null | **PERCENTAGE** units (4.25 = 4.25%) — display as-is |
| `coupon_frequency` | text \| null | NULL for flex bonds — treat as 'SEMI_ANNUAL' |
| `maturity_date` | date | ISO date |
| `cusip` | text \| null | e.g. '037833CH1' for AAPL |
| `accrued_interest` | numeric \| null | NULL for all 18 rows (portal not yet enabled) |

### options_cash_events columns (relevant to bond interest):
| column | type | notes |
|--------|------|-------|
| `household_id` | uuid | for RLS filter |
| `event_date` | date | use for YEAR extraction |
| `event_category` | enum | 'interest' bucket = bond interest + broker interest |
| `amount` | numeric | IBKR sets paid events as negative |
| `raw_payload.type` | text | 'Bond Interest Received' or 'Bond Interest Paid' |

---

## Tests Added & Pass Status

### Frontend (TypeScript/Vitest)
| File | Tests | Status |
|------|-------|--------|
| `apps/frontend/src/app/ladder/__tests__/bond-holdings-ladder.test.ts` | 10 | ✅ All pass |
| `apps/frontend/src/app/summary/__tests__/bond-interest.test.ts` | 8 | ✅ All pass |
| `apps/frontend/src/app/ladder/actions.test.ts` | 3 (existing) | ✅ Still pass |
| `apps/frontend/src/app/summary/actions.test.ts` | 3 (existing) | ✅ Still pass |

Note: `StackedIncomeBarChart.test.tsx` has 4 failures from Fenster's pre-existing changes (4th series added, tests not updated). NOT caused by my changes.

### Backend (Python/pytest)
| File | Tests | Status |
|------|-------|--------|
| `apps/backend/tests/test_bond_ladder_holdings.py` | 9 | ✅ All pass |
| `apps/backend/tests/test_bond_interest_yearly.py` | 15 | ✅ All pass |

---

## Gotchas

1. **Pre-existing stub replaced:** `summary/actions.ts` had a stub `getYearlyBondInterest()` reading from non-existent `bond_income_history` table. Removed and replaced with correct implementation reading from `options_cash_events`.

2. **coupon_rate / 100 is critical:** If any code path passes `coupon_rate=4.25` directly to `generateCashflowsForBond`, coupon amounts will be 100x too large ($21,250 vs $212.50 per semi-annual payment on $10k face).

3. **ladder_bonds still used for addLadderBond:** `addLadderBond()` still writes to `ladder_bonds`. These manually-added bonds are merged at read time. No schema changes needed.

4. **bond_holdings has no `coupon_frequency` for IBKR flex bonds:** All 18 live rows have NULL `coupon_frequency`. Default to 'SEMI_ANNUAL'. This is correct for US Treasury and corporate bonds.

5. **bond_holdings has NULL `issuer` for flex bonds:** IBKR ticker encodes the issuer (e.g. "AAPL 4 1/4 02/09/47"). The `fetchHoldingBonds` helper falls back to `row.ticker ?? row.id` for the `issuer` field.

6. **No `max_flex_snap` CTE needed here:** All 18 bond_holdings rows share the same `as_of_date='2026-05-08'`. Filter is `deleted_at IS NULL`. If future backfills add multiple snapshots, revisit.
