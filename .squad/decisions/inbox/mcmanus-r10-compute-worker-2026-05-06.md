# McManus R10 — Compute Worker Framework (TJ-011)

_Author: McManus (Data/Finance Dev)_
_Date: 2026-05-06_
_Round: 10_
_PR: squad/64-compute-worker-framework (#303)_

---

## Context

TJ-011 (Issue #64) implements the raw→compute→cooked pipeline for the trading journal.
Per Keaton-arch R8 sequencing, this is Wave 2 (L size, medium risk) and unblocks #73
(Dashboard reads cooked tables) and #80 (Docker worker healthcheck).

---

## Key decisions

### 1. Framework approach: extend existing, don't replace

**Finding:** The worker framework was already substantially built:
- `app/worker/job_queue.py` — `JobQueuePoller` with `public.compute_jobs` queue
- `app/worker/registry.py` — `JOB_HANDLERS` dict + `JOB_SCHEDULES`
- `app/worker/runtime.py` — APScheduler entrypoint
- `app/worker/scheduler.py` — `register_cron` / `register_interval` helpers

**Decision:** Add `pnl_daily` as a new handler in the existing registry. No new framework
layer needed. The `JobQueuePoller` handles retries (up to 3 attempts), failure recording,
and success marking out of the box.

**Rationale:** Keaton's R8 audit noted "zero code" for the compute worker — that predated
the actual code that exists now. Adding on top is the correct approach; a new framework
would duplicate and conflict.

### 2. Queue terminology: `compute_jobs` (not `compute_runs`)

The issue description uses `compute_runs` with `status='queued'`, but the existing
migration (`20260503161310_add_compute_jobs.sql`) and code use `public.compute_jobs`
with `status='pending'`. These are the same table. The `compute.pnl_runs` table is the
per-job computation-run audit log. **No schema rename is required.**

### 3. Reference pipeline: `pnl_daily`

Handler: `app/worker/handlers/pnl_daily.py`
Queue key: `"pnl_daily"`

Pipeline steps:
1. Open `compute.pnl_runs` row (running)
2. Read `raw.broker_trade_events` for household + optional date window
3. Aggregate into daily P&L buckets (simplified FIFO — see note below)
4. Write to `compute.daily_pnl_intermediates`
5. **Reconciliation gate**: `len(raw_events) == sum(trade_counts)` — cooked write blocked on failure
6. Upsert `cooked.daily_performance` (ON CONFLICT DO UPDATE on PK)
7. Mark `compute.pnl_runs` succeeded
8. Upsert `public.household_refresh_state`

**P&L model note:** The current aggregation is a simplified cash-flow model
(sells = positive, buys = negative). Wash-sale treatment, splits, and corporate
actions are deferred to TJ-020 (#73) enhancements. The model is intentionally
simple to validate the framework end-to-end; the reconciliation gate (step 5)
ensures correctness at the count level.

### 4. Idempotency mechanism

Two layers:
- **Cooked layer**: `ON CONFLICT (household_id, date, currency) DO UPDATE` on
  `cooked.daily_performance`. Re-running the same job overwrites with fresh values;
  no duplicate rows.
- **Input hash**: `_input_hash(household_id, from_date, to_date, raw_count)` stored
  in `household_refresh_state.last_input_hash`. Future optimization: skip re-run if
  hash matches (not enforced yet — left as a 🟡 future guard for Fenster/dashboard
  staleness indicator work in #73).

### 5. `household_refresh_state` table

New migration: `20260506001200_household_refresh_state.sql`

Schema:
```sql
public.household_refresh_state (
    household_id        uuid  PK,
    job_type            text  PK,
    last_run_id         uuid,
    last_succeeded_at   timestamptz,
    last_failed_at      timestamptz,
    last_error          text,
    last_input_hash     text
)
```

Access: service_role write; authenticated SELECT via `is_household_member()` RLS.
This table feeds the TJ-020 staleness badge in the dashboard (#73).

### 6. Observability

- Structured logs via `logging.getLogger(__name__)` — consistent with all other handlers.
- `compute.pnl_runs`: full audit trail (status, timestamps, error, params).
- `public.compute_jobs`: queue visibility for authenticated users (existing RLS policy).
- `public.household_refresh_state`: per-household last-success for dashboard staleness.
- No new telemetry library added (OpenTelemetry already in `pyproject.toml`).

### 7. Failure semantics

- Any exception in `handle_pnl_daily` is caught at the caller (`JobQueuePoller._process_job`).
- The handler itself catches exceptions to record `pnl_runs` failure and update
  `household_refresh_state.last_failed_at` before re-raising.
- Cooked rows are **never written** if an exception occurs before the reconciliation pass.
- The poller re-queues the job (status → pending) until `attempts >= MAX_ATTEMPTS=3`,
  then marks it permanently failed.

---

## Integration guide for Hockney and Fenster

### Adding a new compute job (e.g., `options_pnl_daily`)

1. Create `app/worker/handlers/your_job.py` with a `handle_your_job(payload, *, session_factory)` function.
2. Register it in `registry.py`: `JOB_HANDLERS["your_job"] = handle_your_job`.
3. Enqueue via `INSERT INTO public.compute_jobs (household_id, job_type, payload) VALUES (...)`.
4. The existing poller picks it up automatically within `WORKER_POLL_INTERVAL_SECONDS`.

**For Hockney (#63 / trade CRUD):** After writing trades to `raw.broker_trade_events`,
enqueue a `pnl_daily` job for the household to trigger a refresh. A Supabase trigger
(INSERT on raw.broker_trade_events) can do this automatically — add it in TJ-010 or TJ-011
follow-up.

**For Fenster (#73 / dashboard staleness):** Read `public.household_refresh_state`
for the household. `last_succeeded_at` is the freshness timestamp. `last_failed_at`
and `last_error` surface failure state. The `_freshness_seconds` pattern from
`cooked.daily_performance_live` view provides UI-ready freshness.

---

## Open questions for the Lead

1. **Trigger vs. cron for `pnl_daily`:** Should we auto-enqueue `pnl_daily` on
   `raw.broker_trade_events` INSERT (Supabase trigger) or rely on a cron schedule?
   Trigger is more responsive but adds Supabase function complexity. Recommend
   cron for MVP, trigger as follow-up.

2. **P&L model accuracy:** The current simplified model is a placeholder. TJ-020
   should specify the exact formula (FIFO vs LIFO, wash-sale rules, etc.) before
   the dashboard reads these cooked values for production display.

3. **`compute_jobs` vs `compute_runs` terminology:** Issue #64 body says `compute_runs`
   but the table is `compute_jobs`. Should the table be renamed for consistency with
   the issue spec? (Low risk, requires migration.)
