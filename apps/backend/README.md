# Trading Journal Backend Worker

The backend is a private Python worker for Trading Journal computations. It is not a public web service and the Vercel frontend must not call it over HTTP. The frontend reads and writes Supabase tables, Auth, Storage, and Realtime only.

The worker runs in Docker on Jony's laptop, reads inputs from Supabase with a server-only privileged database connection, executes Python modules under `apps/backend/app/`, and writes computed outputs back to Supabase result tables.

## Required environment

Copy the root `.env.example` or `apps/backend/.env.example` to a local `.env` and fill server-only values. Never commit real credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Postgres direct or pooler connection string used by the worker for reads and writes. Use an elevated role only on the server-side worker and include `sslmode=require` for Supabase-hosted Postgres. |
| `DIRECT_DATABASE_URL` | Compose convenience | `docker-compose.backend.yml` maps this value into `DATABASE_URL`; set it to the Supabase direct or pooler URL. |
| `SUPABASE_URL` | Yes | Supabase project URL for Auth/JWKS checks and Storage client access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only | Required only when worker code needs Supabase Storage access or privileged writes that cannot be performed with the database connection. This key bypasses RLS; never expose it to the browser and never prefix it with `NEXT_PUBLIC_`. |
| `WORKER_TIMEZONE` | Optional | APScheduler timezone. Defaults to `Asia/Jerusalem`. |
| `WORKER_POLL_INTERVAL_SECONDS` | Optional | `compute_jobs` polling interval. Defaults to `5`. |
| `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | Local observability settings. |

## Adding a scheduled batch job

Scheduled jobs live beside the compute code. Register a `JobSchedule` in `app.worker.registry.JOB_SCHEDULES`, point it at a zero-argument handler, and have the handler read/write Supabase through the worker's privileged database connection. Result tables should include freshness fields such as `refreshed_at`, `source`, `status`, and `error`.

```python
from app.worker.registry import JOB_SCHEDULES, JobSchedule
from app.services.analysis.refresh import refresh_growth_stories


def refresh_growth_stories_job() -> None:
    """Refresh known ticker stories and upsert result rows."""
    refresh_growth_stories()


JOB_SCHEDULES.append(
    JobSchedule(
        job_id="analysis_growth_stories_daily",
        kind="cron",
        cron_expr="30 18 * * 0-4",
        handler=refresh_growth_stories_job,
    )
)
```

## Adding an on-demand job

On-demand jobs use `public.compute_jobs`. Pick a stable `job_type`, register a handler in `registry.JOB_HANDLERS`, and return a JSON-serializable result. The frontend inserts a job and subscribes to Realtime changes; it never calls the Python worker over HTTP.

```python
from app.services.backtester.runner import run_backtest
from app.worker.registry import JOB_HANDLERS, JobPayload, JobResult


def handle_backtest(payload: JobPayload) -> JobResult:
    """Run one user-requested backtest and return the result row id."""
    strategy_id = str(payload["strategy_id"])
    start_year = int(payload["start_year"])
    end_year = int(payload["end_year"])
    run_id = run_backtest(
        strategy_id=strategy_id,
        start_year=start_year,
        end_year=end_year,
    )
    return {"backtest_run_id": str(run_id)}


JOB_HANDLERS["backtest"] = handle_backtest
```

```ts
const jobId = await enqueueComputeJob('backtest', {
  strategy_id: strategyId,
  start_year: 2024,
  end_year: 2026,
});

const unsubscribe = subscribeToComputeJob(jobId, (job) => {
  if (job.status === 'done') {
    router.push(`/backtests/${job.result?.backtest_run_id}`);
  }
  if (job.status === 'failed') {
    setError(job.error ?? 'Backtest failed');
  }
});
```

## Local development

From the repository root:

```bash
docker compose -f docker-compose.backend.yml up -d --build
docker compose -f docker-compose.backend.yml ps
docker compose -f docker-compose.backend.yml logs -f backend
```

Stop it with:

```bash
docker compose -f docker-compose.backend.yml down
```

The compose worker publishes no ports. Do not expose this container through a public tunnel, router port, or Vercel rewrite.

## Offline behavior

When Jony's laptop is offline, asleep, or Docker is stopped:

- Scheduled result tables remain readable but become stale.
- Pending job rows remain queued until the worker is online again.
- Storage uploads remain in Supabase until the worker parses them.
- The frontend still loads because it talks only to Supabase; users see stale timestamps or pending statuses instead of backend connection failures.

## Security notes

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It bypasses RLS and must never appear in frontend code, logs, screenshots, or committed files.
- Prefer scoped database roles or tightly scoped worker functions when practical.
- Enable RLS on every new exposed result table and grant only the roles required by the frontend read model.
- Business FastAPI endpoints are not a product integration surface. If retained temporarily, treat them as local/admin maintenance endpoints.
