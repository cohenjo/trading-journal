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
