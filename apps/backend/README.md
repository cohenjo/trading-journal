# Trading Journal Backend Worker

The backend is a private Python worker for Trading Journal computations. It is not a public web service and the Vercel frontend must not call it over HTTP. The frontend reads and writes Supabase tables, Auth, Storage, and Realtime only.

The worker runs in Docker on Jony's laptop, reads inputs from Supabase, executes the existing Python modules under `apps/backend/app/`, and writes computed outputs back to Supabase result tables. FastAPI may stay running for local `/health` liveness checks, but business routes are legacy/admin-only until Phase B removes or replaces them.

## What this backend does

- **Scheduled batch compute:** refresh pre-computable datasets on a timer and write result tables such as ticker analysis, bond scanner results, price cache rows, NDX data, and broker/trading snapshots.
- **Job queue compute:** poll Supabase job-request rows for user-triggered heavy work, run the Python computation, write results, and update job status.
- **Storage processing:** poll or react to Supabase Storage uploads, parse files such as pension PDFs, and write parsed rows/status to Supabase tables.
- **Local health:** expose `/health` inside the container, and optionally on `127.0.0.1:8000`, so the laptop operator can verify the worker is alive.

## Required environment

Copy the root `.env.example` or `apps/backend/.env.example` to a local `.env` and fill server-only values. Never commit real credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase Postgres direct or pooler connection string used by the worker for reads and writes. Use an elevated role only on the server-side worker and include `sslmode=require` for Supabase-hosted Postgres. |
| `DIRECT_DATABASE_URL` | Compose convenience | `docker-compose.backend.yml` maps this value into `DATABASE_URL`; set it to the Supabase direct or pooler URL. |
| `SUPABASE_URL` | Yes | Supabase project URL for Auth/JWKS checks and Storage client access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, server-only | Required only when worker code needs Supabase Storage access or privileged writes that cannot be performed with the database connection. This key bypasses RLS; never expose it to the browser and never prefix it with `NEXT_PUBLIC_`. |
| `SUPABASE_JWT_SECRET` | Optional | Fallback for local/manual JWT verification while legacy admin FastAPI routes still exist. Prefer JWKS via `SUPABASE_URL`. |
| `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | Local observability settings. |

The frontend does not need `NEXT_PUBLIC_API_URL`, and the backend does not need browser CORS configuration.

## Run the worker

From the repository root:

```bash
docker compose -f docker-compose.backend.yml up -d --build
docker compose -f docker-compose.backend.yml ps
curl http://127.0.0.1:8000/health
```

Stop it with:

```bash
docker compose -f docker-compose.backend.yml down
```

`docker-compose.backend.yml` binds the optional health endpoint to `127.0.0.1:8000` only. Do not expose this container through a public tunnel, router port, or Vercel rewrite.

## Scheduling model

Phase B should add an in-process scheduler, preferably APScheduler, during backend startup. Each scheduled job should be a small registration entry that declares:

1. A stable job id, for example `analysis_tickers_daily`.
2. Its cadence, for example daily after market close or hourly for `price_cache`.
3. The Python function under `apps/backend/app/` that performs the work.
4. The Supabase result table(s) it writes.
5. Freshness/error fields written with every run, such as `refreshed_at`, `status`, and `error_message`.

A new scheduled compute path should not add a frontend HTTP call. Add the job to the scheduler registry, create the result table with RLS in a migration, and update the frontend to read Supabase rows.

## Job queue table pattern

For user-triggered heavy work, Phase B should use a Supabase table such as `compute_jobs`:

1. A Next.js Server Action validates the user input and inserts a job row with `status = 'pending'`, `job_type`, `input_payload`, `requested_by`, and timestamps.
2. The backend polling worker wakes every 10 seconds, transactionally claims pending rows, and dispatches by `job_type`.
3. The worker runs the Python compute module, writes a result row such as `backtest_runs`, and marks the job `done` with the result id. Failures set `status = 'failed'` and an error summary.
4. The frontend subscribes to the job/result row with Supabase Realtime and renders pending, done, failed, or stale states.

To register a new job type in Phase B, add it to the worker's dispatch registry, document its payload schema near the worker code, create a result table with RLS, and remove any frontend `/api/*` dependency for that workflow.

## Offline behavior

When Jony's laptop is offline, asleep, or Docker is stopped:

- Scheduled result tables remain readable but become stale.
- Pending job rows remain queued until the worker is online again.
- Storage uploads remain in Supabase until the worker parses them.
- The frontend still loads because it talks only to Supabase; users see stale timestamps or pending statuses instead of backend connection failures.

This offline behavior is intentional and acceptable for the current operating model.

## Security notes

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It bypasses RLS and must never appear in frontend code, logs, screenshots, or committed files.
- Prefer scoped database roles or tightly scoped worker functions when practical.
- Enable RLS on every new exposed result table and grant only the roles required by the frontend read model.
- Business FastAPI endpoints are not a product integration surface. If retained temporarily, treat them as local/admin maintenance endpoints.
