# Compute Worker Framework

_Owner: McManus (Data/Finance Dev) — TJ-011_

---

## Overview

The compute worker implements the **raw → compute → cooked** data pipeline for the trading journal. It runs as a long-lived Python process (Docker container) that:

1. **Polls** `public.compute_jobs` for queued jobs every N seconds (default: 5 s).
2. **Claims** a batch of `pending` rows (SELECT FOR UPDATE SKIP LOCKED).
3. **Dispatches** each job to a registered handler.
4. **Records** success or failure back to `compute_jobs` and `compute.pnl_runs`.
5. **Publishes** cooked rows only after reconciliation passes.
6. **Updates** `public.household_refresh_state` with last-run metadata.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Worker Process (Docker)                  │
│                                                          │
│  APScheduler                JobQueuePoller               │
│  ─────────────              ─────────────────            │
│  Cron / Interval jobs  ─►   poll_once()                  │
│  (market sync, bonds)       │                            │
│                             ▼                            │
│                       dispatch handler                    │
│                       (JOB_HANDLERS dict)                 │
│                             │                            │
│                             ▼                            │
│                       pnl_daily / options_metrics / …    │
└──────────────────────────────────────────────────────────┘
         │                                   │
         ▼                                   ▼
  raw.broker_trade_events         cooked.daily_performance
  raw.market_data_quotes          cooked.dashboard_summary
                                  compute.pnl_runs
                                  public.household_refresh_state
```

### Key modules

| Module | Responsibility |
|--------|---------------|
| `app/worker/runtime.py` | Entrypoint — starts scheduler, registers all jobs, blocks on SIGTERM/SIGINT |
| `app/worker/scheduler.py` | APScheduler singleton; `register_cron`, `register_interval` helpers |
| `app/worker/job_queue.py` | `JobQueuePoller` — claims `compute_jobs`, dispatches, records outcome |
| `app/worker/registry.py` | `JOB_HANDLERS` dict + `JOB_SCHEDULES` list |
| `app/worker/handlers/pnl_daily.py` | **Reference pipeline** — raw trades → daily P&L → cooked rows |

---

## Job lifecycle

```
compute_jobs row:
  pending ──► running ──► done
                     └──► failed  (re-queued if attempts < MAX_ATTEMPTS=3)

compute.pnl_runs row:
  running ──► succeeded
         └──► failed

cooked rows: written ONLY after reconciliation passes in the handler.
```

---

## How to register a new job

### 1. Write a handler

Create `apps/backend/app/worker/handlers/your_job.py`:

```python
from app.worker.handlers.pnl_daily import JobPayload, JobResult, SessionFactory

def handle_your_job(
    payload: JobPayload,
    *,
    session_factory: SessionFactory | None = None,
) -> JobResult:
    """Describe what this job computes."""
    household_id = payload["household_id"]  # always present
    # ... read raw_*, write compute.*, reconcile, write cooked.*
    return {"rows_written": n}
```

**Contract:**
- Accept `payload: dict[str, object]`. `household_id` and `compute_job_id` are always injected.
- Return `dict[str, object]` on success.
- Raise any exception on failure — the poller catches it, increments `attempts`, requeues.
- Write cooked rows only after your own reconciliation check.
- Update `public.household_refresh_state` so dashboards can show staleness.

### 2. Register the handler

In `apps/backend/app/worker/registry.py`:

```python
from app.worker.handlers.your_job import handle_your_job

JOB_HANDLERS: dict[str, JobHandler] = {
    ...
    "your_job": handle_your_job,
}
```

### 3. Enqueue jobs from the API or a cron schedule

**Via `compute_jobs` table (triggered from API or Supabase trigger):**
```sql
insert into public.compute_jobs (household_id, job_type, payload)
values (:household_id, 'your_job', '{"from_date": "2025-01-01"}'::jsonb);
```

**Via APScheduler (background schedule):**
```python
# In registry.py
JOB_SCHEDULES.append(JobSchedule(
    job_id="your_job_daily",
    kind="cron",
    cron_expr="0 3 * * *",
    handler=run_your_job_scheduled,
))
```

---

## Reference pipeline: `pnl_daily`

**Job type:** `pnl_daily`
**Handler:** `app/worker/handlers/pnl_daily.py`

**Payload keys:**
| Key | Required | Description |
|-----|----------|-------------|
| `household_id` | ✅ | UUID — injected automatically by the queue poller |
| `from_date` | ❌ | ISO-8601 date — earliest trade date (default: all) |
| `to_date` | ❌ | ISO-8601 date — latest trade date (default: today) |
| `currency` | ❌ | Currency label (default: `USD`) |

**Pipeline steps:**
1. Open `compute.pnl_runs` row (status=`running`)
2. Read `raw.broker_trade_events` scoped to household + date range
3. Aggregate into daily buckets → insert into `compute.daily_pnl_intermediates`
4. Reconcile: assert `len(raw_events) == sum(trade_counts)` across all days
5. On pass: upsert `cooked.daily_performance` rows (ON CONFLICT DO UPDATE)
6. Mark `compute.pnl_runs` as `succeeded`; upsert `household_refresh_state`

**Idempotency:**
Re-running with the same inputs produces the same output via the `ON CONFLICT DO UPDATE` upsert on `cooked.daily_performance(household_id, date, currency)`.

---

## Running locally

```bash
# Start the worker
cd apps/backend
uv run python -m app.worker.runtime

# Or via worker_main.py shim
uv run python worker_main.py

# Environment variables
WORKER_LOG_LEVEL=DEBUG          # default: INFO
WORKER_TIMEZONE=UTC             # default: Asia/Jerusalem
WORKER_POLL_INTERVAL_SECONDS=5  # default: 5
DATABASE_URL=postgresql://...   # required
```

---

## Running tests

```bash
cd apps/backend
uv run pytest tests/test_pnl_daily_handler.py -v
uv run pytest tests/test_worker_job_queue.py -v
```

---

## Observability

- **Structured logs**: all handlers use `logging.getLogger(__name__)`. Log lines include `run_id`, `household_id`, row counts, and reconciliation status.
- **`compute.pnl_runs`**: queryable audit trail for every P&L run — status, start/finish timestamps, error messages.
- **`public.household_refresh_state`**: per-household/job_type last-success timestamp; used by TJ-020 dashboard staleness indicators (#73).
- **`public.compute_jobs`**: queue table; `status`, `attempts`, `error`, `result` visible to authenticated users (member SELECT policy).

---

## Deployment

Defer to TJ-027 (#80) for Docker healthcheck and restart configuration.
The worker entrypoint is `worker_main.py` (`python worker_main.py`).
Connection to Supabase Postgres is via `DATABASE_URL` (direct Postgres, TLS required in production).

---

## Adding cooked domain columns (TJ-020)

The `cooked.daily_performance` table currently stores P&L data in `performance_payload jsonb`.
TJ-020 (#73) will add typed columns alongside the payload. The `pnl_daily` handler's `_publish_cooked` function should be updated at that point to write both the payload and the typed columns.
