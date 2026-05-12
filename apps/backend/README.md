# Trading Journal Backend Worker

The backend is a private Python worker for Trading Journal computations. It is not a public web service and the Vercel frontend must not call it over HTTP. The frontend reads and writes Supabase tables, Auth, Storage, and Realtime only.

The worker runs in Docker on Jony's laptop, reads inputs from Supabase with a server-only privileged database connection, executes Python modules under `apps/backend/app/`, and writes computed outputs back to Supabase result tables.

## Required environment

Copy the root `.env.example` or `apps/backend/.env.example` to a local `.env` and fill server-only values. Never commit real credentials.

> **Important:** `DATABASE_URL` has no default. The backend **refuses to start** if it is missing or resolves to `localhost` outside of a local dev environment. See [Obtaining the Supabase pooler URL](#obtaining-the-supabase-pooler-url) below.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **Yes — no default** | Supabase transaction-mode pooler URL. Backend will not start without this. |
| `DIRECT_DATABASE_URL` | Compose convenience | `docker-compose.backend.yml` maps this value into `DATABASE_URL`; same format as `DATABASE_URL`. |
| `SUPABASE_URL` | Yes | Supabase project URL for Auth/JWKS checks and Storage client access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only | Required only when worker code needs Supabase Storage access or privileged writes that cannot be performed with the database connection. This key bypasses RLS; never expose it to the browser and never prefix it with `NEXT_PUBLIC_`. |
| `APP_ENV` | Optional | Set to `development` or `local` to allow localhost DATABASE_URL in dev. Defaults to production-mode validation. |
| `WORKER_TIMEZONE` | Optional | APScheduler timezone. Defaults to `Asia/Jerusalem`. |
| `WORKER_POLL_INTERVAL_SECONDS` | Optional | `compute_jobs` polling interval. Defaults to `5`. |
| `IB_GATEWAY_HOST` / `IB_GATEWAY_PORT` | Optional | IB Gateway TCP endpoint used by the scheduled trading sync health check and IBKR connection. Defaults to `127.0.0.1:4002`. Legacy `IB_HOST` / `IB_PORT` are also honored. |
| `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | Local observability settings. |

## Obtaining the Supabase pooler URL

The backend requires the **transaction-mode pooler** URL (PgBouncer, port 6543).

1. Open the [Supabase Dashboard](https://supabase.com/dashboard) → select your project
2. Go to **Project Settings → Database → Connection string**
3. Choose **Transaction mode** from the dropdown
4. Copy the connection string — it looks like:
   ```
   postgresql://postgres.{project-ref}:{password}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=require
   ```

**Gotchas:**
- Region prefix is `aws-1`, **not** `aws-0` (commonly assumed from copy-pasted snippets)
- Username contains a dot: `postgres.{project-ref}`
- `sslmode=require` is mandatory — omitting it causes GSSAPI negotiation errors
- Use port `6543` (pooler), **not** `5432` (direct) — `pg_dump` needs port 5432, but the worker uses the pooler

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

### Rebuilding the worker

After ANY change to `apps/backend/app/worker/`, `Dockerfile`, or `pyproject.toml`, you MUST rebuild the local Docker worker container:

```bash
./scripts/rebuild-worker.sh
```

A stale container will overwrite DB values with old code's logic and produce silent data corruption (see Round 8, May 2026). See `.copilot/skills/worker-redeploy/SKILL.md` for the full procedure, manual fallback, and verification checklist.



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
