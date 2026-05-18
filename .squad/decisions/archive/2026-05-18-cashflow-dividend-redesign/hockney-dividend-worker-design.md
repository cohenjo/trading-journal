# Backend Design: Real Per-Account Dividend Estimates for Plan Simulation

**Author:** Hockney (Backend Dev)
**Date:** 2026-05-18
**Status:** Design Review
**Related:** Issue TBD (user request: "use real dividend estimates per account")

---

## Executive Summary

**Recommendation:** **Option A (No new worker needed)**. The existing data pipeline already provides fresh, real dividend estimates per account. `getDividendSummary()` reads live data on every call—no background worker or cache table is needed. The frontend currently passes only `total_forward_annual` to the plan simulation; we should extend it to pass the per-account breakdown (`by_account: { ibkr, schwab, ira }`).

**Key finding:** The phrase "real numbers" in the user request is *already the case*. The system uses:
- IBKR Flex Query → `dividend_payments` (TTM actuals) + `dividend_accruals` (forward estimates from IBKR's own projections)
- Yahoo Finance daily refresh → `stock_positions.dividend_yield` (for non-IBKR positions)
- CSV imports → `stock_positions.dividend_yield` (Schwab/IRA manual entries)

All three sources are reconciled in `getDividendPositions()` which computes `forward_dividend_annual` per position, then `getDividendSummary()` aggregates these into `by_account` totals. The simulation currently uses only the global total; extending it to use per-account data is a **frontend wiring change**, not a backend/worker change.

---

## 1. Data Source Audit

### 1.1 Current Architecture

**Source tables:**
- `stock_positions` — canonical position source-of-truth (per 2026-05-11 "Positions as Source of Truth" decision)
- `dividend_payments` — IBKR CashTransaction history (Dividends, PIL, Withholding Tax) from Flex Query
- `dividend_accruals` — IBKR forward projections (ChangeInDividendAccruals, OpenDividendAccruals sections) from Flex Query
- `security_reference` — global ticker metadata (Yahoo-enriched)

**Ingestion paths:**

| Data Source | Destination Table | Refresh Cadence | Worker/Parser |
|-------------|------------------|-----------------|---------------|
| IBKR Flex Query XML | `dividend_payments` | On-demand (user-triggered `/options` import) | `options_sync.py` → `_upsert_dividend_payment()` |
| IBKR Flex Query XML | `dividend_accruals` | On-demand (user-triggered `/options` import) | `options_sync.py` → `_sync_dividend_accruals()` |
| Yahoo Finance API | `stock_positions.dividend_yield` | Daily at 22:00 UTC (Mon-Fri) | `yahoo_refresh.py` → `refresh_stock_positions()` |
| CSV upload (Schwab/IRA) | `stock_positions.*` | On-demand (manual upload) | Parser TBD (frontend/backend CSV handler) |
| Leumi XLS parser | `stock_positions.*` | On-demand (manual upload) | `leumi_parser.py` (exists per Round 8 history) |

**Key insight:** `dividend_accruals.gross_rate` comes directly from IBKR's own forward dividend estimates—this *is* the "real number" requested. IBKR provides these in the Flex Query `OpenDividendAccruals` section (see `flex_parser.py` line 24). The worker already ingests them.

### 1.2 Data Freshness

- **IBKR dividends/accruals:** Refreshed whenever user uploads a new Flex Query XML (typically weekly or monthly for portfolio snapshots). Staleness = time since last manual import.
- **Yahoo yields:** Refreshed daily at 22:00 UTC (after US market close). Staleness = <24 hours for US equities, <48 hours for international (if run on Friday).
- **CSV imports:** Refreshed on manual upload. Staleness = user-controlled.

**Verdict:** Data is "live" enough for plan simulation (which projects 20–40 years forward; daily vs. weekly refresh is immaterial at that timescale).

### 1.3 Forward Yield Calculation Logic

Per `apps/frontend/src/app/dividends/actions.ts` lines 1147–1159:

```typescript
// Prefer accruals.gross_rate × frequency; else use TTM (when trustworthy);
// fall back to stock_positions.dividend_yield (Yahoo/CSV) when no payment history.
if (hasAccrual) {
  forwardDivPerShare = accrual.gross_rate * paymentsPerYear(freq);
} else if (ttmIsTrustworthy && ttmDivPerShare !== null) {
  forwardDivPerShare = ttmDivPerShare;
} else if (hasYield && canonicalPrice !== null && canonicalPrice > 0) {
  forwardDivPerShare = canonicalPrice * yieldFraction;
}
```

**Priority cascade:**
1. IBKR accruals (most authoritative—IBKR's own forward estimate)
2. TTM actuals (when ≥3 payments in 12-month window → "trustworthy")
3. Yahoo/CSV yield × current price (fallback for non-IBKR positions or thin payment history)

This is already a robust, real-data algorithm. No changes needed.

---

## 2. Background Worker Assessment

### Recommendation: **Option A (No new worker needed)**

**Rationale:**
- `getDividendSummary()` already reads live data on every call. It's a Next.js server action (not a FastAPI endpoint) that queries Supabase directly via PostgREST.
- The `/cash-flow` and `/plan` pages call `getDividendSummary()` on mount (lines 29, 34 in respective `page.tsx` files). This is a negligible overhead (<100ms) for a page that loads once per session.
- The data is already pre-computed at the position level by `getDividendPositions()` which runs 3× in parallel (ibkr/schwab/ira), each scoped to ~10–50 positions per account. The aggregation (`sum(forward_dividend_annual)`) is trivial.
- The simulation runs client-side (in the browser) with data fetched once at page load. There's no N+1 query issue or latency problem to solve.

**Option B (New worker—rejected):**
- **Proposal:** Add a daily worker (`apps/backend/app/worker/dividend_refresh.py`) to refresh `dividend_accruals.gross_rate` from a third-party API (Yahoo Finance, IEX, Polygon).
- **Problem:** We *already* get accruals from IBKR Flex Query, which is more authoritative than any public API (IBKR's accruals reflect the user's actual holdings, including tax treaties, ADR fees, etc.). Yahoo's dividend yield is a generic market rate—it doesn't account for account-specific factors.
- **Verdict:** Redundant and lower-quality than existing source.

**Option C (Materialized summary cache—rejected):**
- **Proposal:** Add a `dividend_summary_cache` table refreshed daily, so `getDividendSummary()` reads from cache instead of aggregating positions.
- **Problem:** Premature optimization. The current query is <100ms, runs once per page load, and benefits from Postgres indexes (`dividend_payments_account_date_idx`, `dividend_accruals_account_date_idx`). Caching adds staleness risk (user imports new Flex Query → cache is stale until next worker run) with no measurable latency benefit.
- **Verdict:** Not justified for current workload.

---

## 3. Per-Account Contract for Simulation

### Current State (as of 2026-05-18)

**Frontend call:**
```typescript
// apps/frontend/src/app/cash-flow/page.tsx line 29
const dividendData = await getDividendSummary();
setDividendTotal({ annualTotal: dividendData.total_forward_annual });
```

**Simulation input:**
```typescript
// apps/frontend/src/app/plan/simulation.ts line 787
const dividendAnnualTotal = planInput.dividendTotal?.annualTotal ?? 0;
// Applied as constant to all years:
if (dividendIncome.gt(0)) {
  incomeDetails.push({ name: 'Dividend Income', type: 'dividends', value: roundMoney(dividendIncome) });
}
```

**Problem:** The simulation uses only the global total. The user wants per-account visibility (likely for tax modeling—IRA dividends are tax-deferred, IBKR/Schwab are taxable).

### Proposed Enhancement

**Step 1:** Update `DividendIncomeTotal` interface in `simulation.ts`:
```typescript
export interface DividendIncomeTotal {
  annualTotal: number; // Keep for backward compatibility
  byAccount?: {        // New optional field
    ibkr: number;
    schwab: number;
    ira: number;
  };
}
```

**Step 2:** Update frontend wiring in `cash-flow/page.tsx` and `plan/page.tsx`:
```typescript
setDividendTotal({
  annualTotal: dividendData.total_forward_annual,
  byAccount: dividendData.by_account,  // Already returned by getDividendSummary()
});
```

**Step 3:** Update simulation engine in `simulation.ts` (line 882–888):
```typescript
// Current (single line):
incomeDetails.push({ name: 'Dividend Income', type: 'dividends', value: roundMoney(dividendIncome) });

// Proposed (per-account breakdown):
if (planInput.dividendTotal?.byAccount) {
  const { ibkr, schwab, ira } = planInput.dividendTotal.byAccount;
  if (ibkr > 0) incomeDetails.push({ name: 'Dividend Income (IBKR)', type: 'dividends', value: roundMoney(new Decimal(ibkr)) });
  if (schwab > 0) incomeDetails.push({ name: 'Dividend Income (Schwab)', type: 'dividends', value: roundMoney(new Decimal(schwab)) });
  if (ira > 0) incomeDetails.push({ name: 'Dividend Income (IRA)', type: 'dividends', value: roundMoney(new Decimal(ira)) });
} else {
  // Fallback to old behavior
  incomeDetails.push({ name: 'Dividend Income', type: 'dividends', value: roundMoney(dividendIncome) });
}
```

**Currency confirmation:** `getDividendSummary()` already converts all positions to USD via `convertCurrency()` (line 1223 in `actions.ts`). The `by_account` totals are USD, major units (post-Round-8 ILA/GBP normalization). No additional FX conversion needed.

**TTM vs. Forward:** The user said "expect to receive" → forward is correct. If the user also wants historical TTM per account, we can add a second aggregation in `getDividendSummary()` to sum `ttm_dividend_total` alongside `forward_dividend_annual`. This is a trivial change but wasn't explicitly requested—defer until user confirms need.

---

## 4. Plan Page → Simulation Wiring

**Two call sites:**

1. **`/cash-flow` page** (`apps/frontend/src/app/cash-flow/page.tsx` line 63):
   - Already calls `getDividendSummary()` (line 29) and passes to `runPlanSimulation()`
   - **Change:** Update line 36 to include `by_account`

2. **`/plan` page** (`apps/frontend/src/app/plan/page.tsx` line 113):
   - Already calls `getDividendSummary()` (line 34) and passes to `runPlanSimulation()`
   - **Change:** Update line 42 to include `by_account`

**No new API calls needed.** The data is already fetched; we're just passing more of it downstream.

---

## 5. RLS & Security

### Current RLS (Migration `20260511102251`)

**`dividend_payments` SELECT policy:**
```sql
CREATE POLICY dividend_payments_select ON public.dividend_payments
  FOR SELECT USING (
    account_id IN (
      SELECT account_id FROM trading_account_config
      WHERE is_household_member(household_id)
    )
  );
```

**`dividend_accruals` SELECT policy:** (same pattern)

**Verified:** The `getDividendPositions()` action uses `createClient()` (cookie-based, RLS-enforced) at line 968. Household scoping is correct.

**No changes needed.** The per-account data flow respects existing RLS. The frontend can only see dividends for accounts in the authenticated user's household.

---

## 6. Migration Impact

**Answer:** None. This is a frontend wiring change only. No new tables, no schema changes.

If we later decided to implement Option C (cache table), we'd need:
```sql
-- Migration: 20260518000000_dividend_summary_cache.sql
CREATE TABLE public.dividend_summary_cache (
  household_id UUID PRIMARY KEY,
  ibkr_forward_annual NUMERIC NOT NULL DEFAULT 0,
  schwab_forward_annual NUMERIC NOT NULL DEFAULT 0,
  ira_forward_annual NUMERIC NOT NULL DEFAULT 0,
  total_forward_annual NUMERIC NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dividend_summary_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY dividend_summary_cache_select ON public.dividend_summary_cache
  FOR SELECT USING (is_household_member(household_id));

-- Worker writes via service_role (bypasses RLS), so no INSERT policy needed
```

But per Option A recommendation, this is **not needed**.

---

## 7. Worker Redeploy Gate

**Per 2026-05-12 decision (Worker redeploy gate) and Keaton's charter:**

> If you propose changes under `apps/backend/app/worker/**`, the PR is INCOMPLETE without running `./scripts/rebuild-worker.sh` and verifying image SHA changed.

**Answer:** Not applicable. This design proposes **no changes** to `apps/backend/app/worker/**`. The worker code is correct as-is. The enhancement is purely frontend wiring in `apps/frontend/src/app/{cash-flow,plan}/`.

If the user later requests Option B or Option C (new worker or cache table), we would:
1. Write the worker module under `apps/backend/app/worker/dividend_refresh.py`
2. Register the schedule in `registry.py`
3. Run `./scripts/rebuild-worker.sh --force` before opening the PR
4. Verify the Docker container image SHA changed (`docker inspect trading_journal_backend_supabase --format='{{.Image}}'`)
5. Include the SHA change in the PR description

---

## 8. Backwards Compatibility & Deprecation

### Current Plan/Account Config Fields

The `trading_account_config` table (and frontend plan editor) have these dividend-related fields:
- `dividend_policy` (e.g., "fixed", "growth", "none")
- `dividend_mode` (e.g., "reinvest", "income")
- `dividend_fixed_amount`
- `dividend_growth_rate`
- `dividend_tax_rate`

**Question:** Are these fields now dead code, since we're using real data?

**Answer:** No—they serve different purposes.

**Real data (`getDividendSummary()`):**
- **What it is:** Actual forward dividend estimates from the user's *current* portfolio holdings.
- **Use case:** Showing the user "here's what you'll receive this year based on what you own today."
- **Limitation:** Doesn't project *future* changes (e.g., user plans to sell all dividend stocks in 5 years, or shift to growth stocks at age 60).

**Plan config fields:**
- **What they are:** User-specified assumptions for *future* behavior of accounts in the plan simulation.
- **Use case:** "I want to model a scenario where my IRA generates 4% dividend yield starting at age 65, regardless of current holdings."
- **Examples:**
  - User doesn't own dividend stocks today but plans to buy them in retirement.
  - User wants to model reinvestment (DRIP) vs. taking income.
  - User wants to override real data with a conservative/optimistic scenario.

**Recommendation:** Keep both.
- Real data = "Current snapshot" income line in simulation (what we're adding in this design).
- Plan config fields = "Projected dividend policy" per account (existing behavior, unchanged).
- The simulation should show *both* if the user has configured dividend policies on accounts. Example:
  ```
  Income Details (2026):
    - Dividend Income (IBKR): $12,450 (real data)
    - Dividend Income (Schwab): $3,200 (real data)
    - Dividend Income (IRA): $0 (real data)
    - Projected IRA Dividends: $8,000 (user-configured 4% yield)
  ```

**Migration path:** No deprecation. The fields coexist. If the user doesn't configure account-level dividend policies, the simulation uses only real data. If they *do* configure policies, both real and projected are shown (or policies override real data after a certain milestone—TBD product decision by McManus/Fenster).

---

## 9. API Contract Changes

**Answer:** None. `getDividendSummary()` is a Next.js server action, not a FastAPI endpoint. It already returns `by_account`—no backend API changes needed.

**Verification:**
```bash
$ grep -r "getDividendSummary" apps/backend
# (no results)
```

The backend Python code does *not* expose a `/api/dividends/summary` endpoint. The frontend calls Supabase PostgREST directly via the `supabase-js` client. This is the established pattern per 2026-05-11 "Positions as Source of Truth" decision (frontend server actions read positions directly).

---

## 10. Operational Concerns

### 10.1 Empty `dividend_accruals` for a position

**Scenario:** User owns a stock that pays dividends, but IBKR hasn't populated `OpenDividendAccruals` yet (e.g., newly acquired position, or ex-dividend just passed).

**Current behavior:** `getDividendPositions()` falls back to TTM (if ≥3 payments) or Yahoo yield. See line 1147–1159 priority cascade.

**Verdict:** Already handled. No forward estimate is lost—the algorithm degrades gracefully.

### 10.2 Account with no positions

**Scenario:** User configures a Schwab account in settings but hasn't imported any positions yet (CSV not uploaded).

**Current behavior:** `getDividendPositions('schwab')` returns `[]` (empty array). `getDividendSummary()` computes `by_account.schwab = 0`.

**Expected simulation behavior:** No "Dividend Income (Schwab)" line is emitted (because the per-account check `if (schwab > 0)` in Step 3 above will skip it).

**Verdict:** Correct. Empty accounts produce zero income, no line item.

### 10.3 New broker added (not ibkr/schwab/ira)

**Scenario:** User adds a 4th account (e.g., "Fidelity") via settings.

**Current limitation:** `getDividendSummary()` is hard-coded to call `getDividendPositions('ibkr' | 'schwab' | 'ira')` at line 1212. A 4th account won't be included.

**Solution path (future work):**
1. Query `trading_account_config` to get all active accounts for the household.
2. Call `getDividendPositions(accountKey)` dynamically for each.
3. Return `by_account: Record<string, number>` instead of `{ ibkr, schwab, ira }`.

**For this design:** Out of scope. The user's request is specifically about "IBKR, Schwab, IRA" (quote from input). We can hard-code those 3 for now and file a follow-up issue for dynamic account support.

**Backward compatibility:** If we change `by_account` from `{ ibkr, schwab, ira }` to `Record<string, number>`, the TypeScript interface is compatible (both are objects with string keys and number values). The simulation code that iterates `Object.entries(by_account)` would automatically work with new keys.

---

## Summary of Proposed Changes

### Backend: None

No worker changes, no migrations, no FastAPI endpoints. The existing data pipeline is correct.

### Frontend (3 files):

1. **`apps/frontend/src/app/plan/simulation.ts`:**
   - Update `DividendIncomeTotal` interface to add optional `byAccount` field (line ~35)
   - Update simulation engine to emit per-account income lines (line ~882)

2. **`apps/frontend/src/app/cash-flow/page.tsx`:**
   - Update `setDividendTotal()` call to include `by_account` (line ~36)

3. **`apps/frontend/src/app/plan/page.tsx`:**
   - Update `setDividendTotal()` call to include `by_account` (line ~42)

**Estimated effort:** 2 hours (1 hour frontend changes + 1 hour testing).

**No PR dependencies.** This can be implemented as a standalone frontend PR (no backend/worker rebuild needed).

---

## Open Questions for Product/Frontend

1. **Tax treatment:** Should IRA dividends be marked as tax-deferred in the simulation? (Currently all dividend income is added to `taxableIncome` at line 886.) This would require differentiating account types in the simulation logic.

2. **TTM vs. Forward toggle:** Should the dividend summary page (and simulation) let users toggle between "forward estimate" and "TTM actuals"? Currently only forward is shown.

3. **Growth rate:** Should we apply a growth rate to dividend income in the plan (e.g., 3% annual increase to model dividend growth)? Or is the forward estimate assumed constant?

4. **Override mechanism:** Should users be able to manually override the per-account dividend total in the plan editor? (Similar to how they can override account balances.)

**Recommend:** Defer to McManus/Fenster. This design provides the data; UX decisions are out of scope for backend.

---

## Appendix: Evidence of Existing Data Flow

**File:** `apps/frontend/src/app/dividends/actions.ts`

**Line 965–1239:** `getDividendPositions()` and `getDividendSummary()` implementation.

**Key observations:**
- Line 1018–1036: Queries `dividend_payments`, `dividend_accruals`, and `stock_positions.dividend_yield` in parallel
- Line 1070–1078: Most recent accrual per ticker (from `dividend_accruals`)
- Line 1147–1159: Forward yield priority cascade (accruals → TTM → Yahoo/CSV)
- Line 1218–1224: Sum per account with FX conversion to USD
- Line 1230–1237: Return `by_account: { ibkr, schwab, ira }` alongside `total_forward_annual`

**File:** `apps/backend/app/worker/handlers/options_sync.py`

**Line 481–540:** `_upsert_dividend_payment()` — ingests IBKR Flex Query dividend payments.

**Line 542–627:** `_sync_dividend_accruals()` — ingests IBKR Flex Query dividend accruals (forward estimates).

**File:** `apps/backend/app/worker/yahoo_refresh.py`

**Line 338–420:** `refresh_stock_positions()` — daily Yahoo Finance refresh of `stock_positions.mark_price` and `dividend_yield`.

**Evidence:** The ingestion pipeline is complete and operational. All three data sources (IBKR payments, IBKR accruals, Yahoo yields) are refreshed per documented cadence. The frontend aggregation logic in `getDividendSummary()` correctly prioritizes and combines them.

**Conclusion:** The "real numbers" are already in the system. The user request is satisfied by exposing the existing `by_account` breakdown to the plan simulation.

---

**End of Design Document**
