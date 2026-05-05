# Hockney R7 — #188 Backtest migration decision drop

**Date:** 2026-05-05
**Author:** Hockney (Backend Dev)
**Issue:** #188 — TJ-018k: Migrate /api/backtest (years + run) to compute backend
**PR:** #294

---

## Port choice

### GET /api/backtest/years → TypeScript Server Action (Path A)

The `years` endpoint returns `list(range(2018, currentYear + 1))` — pure constant derivation, no DB, no pandas, no I/O. Ported to `getBacktestYears(): Promise<number[]>` in `actions.ts`. Logic is trivially portable; no parity risk.

### POST /api/backtest/run → Job queue (already done, PR #228)

The `run` endpoint invokes the full backtester subpackage (~870 LOC, scipy/numpy/pandas). Execution time is 5–60s. Kept as an async compute job per the decisions table (line 5415 of decisions.md). Worker: `run_backtest_job` in `backtest_handler.py`, registered in `registry.py`. The FastAPI compute backend processes this from the `compute_jobs` table.

---

## Edge cases handled

- **Boundary year**: `getBacktestYears` uses `getUTCFullYear()` (not local time) to avoid timezone-shift year drift around Dec 31.
- **Empty range guard**: returns `[]` if `currentYear < 2018` (defensive; unreachable in practice).
- **Synchronous fallback**: `yearsSince2018Sync()` in `page.tsx` provides the initial state before the Server Action promise resolves; SSR initial render is instant.
- **Cancellation**: `useEffect` returns a `cancelled` flag to prevent state update after component unmount.

---

## Test coverage

+4 unit tests for `getBacktestYears`:
1. Range start/end matches 2018 and current UTC year
2. Consecutive integers (no gaps)
3. Contains both launch year (2018) and current year
4. All values are integers (no float/NaN)

Total: 239 tests (up from 235).

---

## FastAPI endpoints

Both FastAPI endpoints (`GET /api/backtest/years`, `POST /api/backtest/run`) remain in place with `deprecated=True`. The frontend calls neither directly. Removal is a follow-up task (Hockney R8, after all TJ-018 migrations complete).

---

## Walkthrough cleanup

Removed stale `'Failed to fetch years'` allowed-console-error from `e2e/walkthrough/all-pages.spec.ts`. This allowance was added when the page still called FastAPI; it is no longer needed.
