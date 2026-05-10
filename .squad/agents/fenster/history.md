## 2026-05-09 — #340 follow-up: stock_positions dedup (bypass-API antipattern)

**Issue:** `/trading/accounts` showed duplicate rows for the same ticker — e.g. `ABR` appeared 4× with stale 2022/2023/2024 quantities. Root cause: `getStockPositions()` in `actions.ts` fetched **all** `stock_positions` rows ordered by ticker with no latest-snapshot filter. Flex imports store year-end snapshots (2022/2023/2024/2025) as separate rows, so 55 tickers × avg 3.4 snapshots ≈ 213 raw rows were rendered verbatim.

**Bypass-API antipattern identified:** The page server action queries Supabase directly instead of calling Hockney's FastAPI endpoint `GET /api/accounts/positions` (which already applies `DISTINCT ON`). This creates a dual query path that can silently diverge. Decision: fix the frontend data layer now (Option A), flag Option B (switch to API) as future consolidation work.

**Fix applied (Option A — TS-side dedupe):**
- Added `dedupeLatestSnapshot()` helper in `actions.ts`: iterates rows and keeps the entry with the **latest `as_of_date`** per `(account_id, ticker)` composite key, then re-sorts alphabetically by ticker.
- Applied at the end of `getStockPositions()` before returning — covers both `flex` and `manual` (Schwab/LeumiIRA) sources defensively.

**Before/after row count:** before ≈ 213 rows rendered → after: 55 unique rows (matches Hockney's API output).

**Multi-part verification applied:**
- 5 new unit tests in `actions.test.ts` (Vitest): ABR×4 dedup, total-count uniqueness, DBK passthrough, manual source dedup, alphabetical sort. All 377 tests green.
- Tests would FAIL on `main` before this fix.

**Commit:** `7e6bcfe` on `origin/main`.

**Pattern established — dedup key:**
```ts
const key = `${row.account_id}:${row.ticker}`;
if (!existing || row.as_of_date > existing.as_of_date) map.set(key, row);
```

**Future work:** Option B (route page through `GET /api/accounts/positions`) would eliminate the dual-path entirely — recommended when API consolidation is on the roadmap.

---

## 2026-05-09 — #340 follow-up: account label rename

Renamed tab display labels to match Jony's finalized directive:
- `ibkr: "IBKR"` → `ibkr: "InteractiveBrokers"`
- `ira: "IRA (Hishtalmut)"` → `ira: "LeumiIRA"`
- `schwab: "Schwab"` (unchanged)

Internal `account_type` codes stay as tech identifiers (ibkr, schwab, ira).

**Files touched:**
- `apps/frontend/src/app/trading/accounts/page.tsx` — central `TAB_LABELS` mapping (3-line change)
- `apps/frontend/src/components/trading/accounts/__tests__/AggregatePortfolioFooter.test.tsx` — test fixture names

**Test results:** 364/364 green (no regressions).

**Commit:** 06c4984 (pushed to origin/main).

---

- Upsert uses `onConflict: 'date'` (PK). RLS blocks cross-household updates at DB level.


### Pattern established

This is the **template for all 32 MOVE endpoints**. See decision note at:
`.squad/decisions/inbox/fenster-finances-server-action.md`

### Build/test results

- `npm run test`: 8/8 new tests pass. 3 pre-existing Pension test failures (unrelated).
- `npm run lint`: 0 errors in changed files. All other lint errors are pre-existing.
- `npm run build`: ✅ succeeds with env vars set.

---

## 2026-05-10 — ✅ Frontend Bug Fixes: Bonds Page + Accounts Page + Dividends

**Commit:** `11e7760` on `main` | **Tests:** 378 pass (+1 new)

**Bug 1 — Bond holdings sort:** `listBondHoldings()` in `apps/frontend/src/app/holdings/actions.ts` changed from maturity-only sort to `ticker ASC nullsFirst:false` then `maturity_date ASC`. Null tickers sort last; deterministic for all rows.

**Bug 2 — CUSIP column showed row ID:** `BOND_HOLDING_SELECT` now includes `cusip`; `BondHolding` interface gets `cusip: string | null`; `normalizeHolding()` populated; render changed from `{h.id}` → `{h.cusip ?? ""}`. Confirmed DB has correct CUSIPs (e.g., `91282CJZ5`).

**Bug 3 — Coupon × 100 (387.5% bug):** `(h.coupon_rate * 100).toFixed(2)` → `Number(h.coupon_rate).toFixed(3)`. Removed `/ 100` on save. Default new-row value `0.04` → `4.0`. DB stores in percentage units (4.25 = 4.25%). Files: `apps/frontend/src/app/holdings/page.tsx`, `apps/frontend/src/app/holdings/actions.ts`.

**Bug 4 — Accounts page title:** `<h1>` renamed from "Trading Accounts" → "Stock Positions" in `apps/frontend/src/app/trading/accounts/page.tsx` (page only renders equity; bonds at `/holdings`).

**Bug 5 — Dividends getDividendAccounts() returned []:** `dividend_accounts` table sparsely seeded for household. Fix: explicit `.eq('household_id', householdId).is('deleted_at', null)` filter; falls back to `trading_account_config.name` when result empty. Three trading accounts (InteractiveBrokers id=1, Schwab id=71, LeumiIRA id=72) now populate dividend tabs. File: `apps/frontend/src/app/dividends/actions.ts`.

**Sacred files untouched:** `buildYearlyIncomeData.ts`, `StackedIncomeBarChart.tsx`, `dedupeLatestSnapshot()` ✅

**Decisions filed:** `fenster-frontend-bugs-2026-05-10.md` (processed by Scribe)

---

### 2026-05-10: Manual Position CRUD UI on Stock Positions Page (Fenster-2)

**Commit:** `6adf8e7`
**Date:** 2026-05-10
**Files:** `apps/frontend/src/app/trading/actions.ts`, `apps/frontend/src/app/trading/accounts/page.tsx`, `AddPositionModal.tsx`, `StockPositionsTable.tsx`, `CSVImportButton.tsx`, and related tests

Delivered full inline CRUD management for Schwab and LeumiIRA manual accounts. Added `updateStockPosition()` and `importManualPositionsCsv()` server actions. New Next.js multipart proxy route at `/api/accounts/[accountId]/positions/import` for CSV upload. Components: Edit modal with pre-fill, two-step inline delete confirmation, CSV import button. Guard: `isManualAccount` flag hides mutate UI on Flex accounts (IBKR). 9 new tests; 387/387 green. Sacred functions (`dedupeLatestSnapshot`, `buildYearlyIncomeData`, `StackedIncomeBarChart`) untouched per constraints (#340, #342, #343).
