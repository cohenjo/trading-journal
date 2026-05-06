# Fenster R12 — Dashboard Cooked Tables (TJ-020 / #73)

_Author: Fenster (Frontend Dev)_
_Date: 2026-05-05_
_PR: #322 — squad/73-dashboard-cooked-tables_

---

## Decisions made

### 1. Cooked tables consumed by the dashboard

Read from the three cooked tables introduced in `20260430140300_cooked_tables.sql`:

| Table | Used for |
|-------|---------|
| `cooked.daily_performance` | PnL curve (last 90 days, DESC) |
| `cooked.dashboard_summary` | Net Worth / Daily P&L / YTD KPI row (most recent `period='day'` row) |
| `public.household_refresh_state` | Staleness calculation (job_type = `pnl_daily`) |

**Not used:** `cooked.position_history` — position snapshot view is out of scope for this wave; deferred to Wave 4 (Redfoot / TJ-021).

### 2. Freshness thresholds (confirmed from issue #73)

Issue #73 acceptance criteria explicitly states: *"Stale threshold configurable (default: data older than 24 hours)"*. Thresholds in `STALE_THRESHOLD_MS`:

| State | Condition |
|-------|-----------|
| 🟢 fresh | `last_succeeded_at` within 24 h, no active job |
| 🔄 refreshing | `compute_jobs` row with `status IN ('pending', 'running')` for this household |
| 🟡 stale | `last_succeeded_at` > 24 h ago, or never ran, no active job |
| 🔴 failed | `last_failed_at` > `last_succeeded_at` (most recent run failed) |

**Deviation from mission brief:** The mission brief suggested 5 min / 60 min thresholds. The issue body takes precedence (24 h). If sub-day staleness granularity is needed in future, raise a follow-up.

### 3. Refresh trigger UX

- "Refresh Now" button in the dashboard header (always visible).
- Server-side rate limit: **30 seconds** minimum gap between user-triggered refreshes (from mission brief; issue does not specify a rate limit).
- Also blocks if an active `compute_jobs` row exists for the household.
- Surfaces rate-limit error inline below the button (no modal/toast).
- On success, immediately re-fetches the snapshot to update the badge.

### 4. Empty-cooked-table / first-run handling

When both `cooked.daily_performance` and `cooked.dashboard_summary` return no rows for the household (`isFirstRun = true`):
- Show a friendly empty state: "Crunching your data — first refresh in progress".
- Fall back to legacy `public.dailysummary` for the PnL curve (backward compat).
- Dashboard does not crash or show blank content.

### 5. FastAPI endpoints left in place

No FastAPI dashboard endpoints were touched. Deprecation follows the `#287 / #294 / #308` pattern — to be removed in a future wave by Hockney.

---

## Follow-up issues to consider

- `cooked.position_history` surface in a positions panel (Wave 4, Redfoot).
- Configurable stale threshold in user Settings (currently hardcoded 24 h).
- Auto-poll: re-fetch snapshot while `freshnessStatus === 'refreshing'` until job completes (could use Supabase Realtime subscription on `compute_jobs`).
