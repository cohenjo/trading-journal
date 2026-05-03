# ADR: TJ-019/TJ-020 frontend Supabase-only compute architecture

## Status

Accepted for Phase A. This replaces the TJ-019 tunnel-based backend exposure plan and becomes the canonical direction for TJ-020 implementation work.

## Decision

The Trading Journal frontend deployed on Vercel will only communicate with Supabase: tables, Auth, Storage, and Realtime. The frontend must not make HTTP calls to the Python backend, and there is no backend `NEXT_PUBLIC_API_URL`, browser CORS allow-list, tunnel, or public laptop endpoint in the target architecture.

The Python backend remains valuable, but its role changes from HTTP API to local worker. It runs in Docker on Jony's laptop, reads inputs from Supabase with a server-only credential or scoped database connection, executes existing compute modules under `apps/backend/app/`, and writes results back to dedicated Supabase result tables. FastAPI may continue to expose `/health` for local liveness checks; business endpoints are not frontend integration points and should be removed or made admin-only as Phase B proceeds.

## Rationale

- No tunnel is required, so Vercel never depends on reaching a laptop over a public URL.
- No browser CORS allow-list is required for the backend because browsers never call it.
- Jony's laptop is not publicly exposed, reducing the attack surface for a financial application.
- Supabase remains the source of truth: the frontend reads authenticated rows, subscribes to result changes, and uses Storage for user files.
- Existing Python computation code can be retained and moved behind worker orchestration without forcing an immediate rewrite.

## Backend operating modes

### Scheduled batch (default)

For data that can be precomputed, the backend runs on a timer, recomputes the dataset, and upserts/overwrites result tables in Supabase. APScheduler in the backend process is the preferred MVP because it keeps scheduling next to the Python compute code. Cron inside the worker container is acceptable if APScheduler introduces operational issues.

Examples: ticker analysis, growth stories, bond scanner results, price cache refreshes, NDX sync, and broker sync jobs.

### Job queue table (on-demand)

For user-triggered heavy compute, a Next.js Server Action inserts a row into a Supabase queue table such as `compute_jobs` with an input payload and `status = 'pending'`. The backend polls for pending jobs every 10 seconds for the MVP, claims one with a transactional status update, runs the Python computation, writes the result table row, and marks the job `done` or `failed`. The frontend subscribes to the job/result row via Supabase Realtime and never calls the backend directly.

LISTEN/NOTIFY or Supabase Realtime-triggered workers can replace polling later, but polling every 10 seconds is the canonical Phase B MVP.

## Tradeoff

When Jony's laptop is offline, asleep, or Docker is stopped, scheduled result tables become stale and pending jobs queue up. This is acceptable per Jony. The user-facing app continues to load because Vercel reads Supabase tables directly; stale timestamps and pending job statuses are visible data states, not HTTP outages.

## Endpoint classification

CRUD/read paths that have already moved or will move directly to Supabase tables are outside this compute matrix. The rows below classify the remaining FastAPI compute, external-data, and side-effect endpoints that must stop being frontend HTTP dependencies.

| Endpoint | Mode | Result table | Notes |
|---|---|---|---|
| `/api/plans/simulate` | Server Action preferred; job queue if profiling shows it is too heavy | n/a or `plan_simulations` | Math-only projection path using plan/finance inputs. Port to TypeScript Server Action first; fall back to queued Python worker if runtime or parity risk is too high. |
| `/api/options/projection` | Server Action | n/a | Analytics math over options income records. Keep computation colocated with the frontend action that reads Supabase rows. |
| `/api/tax-condor/*` and `/api/tax_condor/*` | Server Action | n/a | Math/recommendation workflow. If live IB data remains required, split live-data refresh into scheduled broker tables and keep recommendation math in a Server Action. |
| `/api/backtest` | Job queue (on-demand) | `backtest_runs` | Heavy, per-config compute. Server Action inserts a job; worker writes run status, metrics, and trades to `backtest_runs`. Lightweight metadata such as available years moves to a Server Action or market-data table read. |
| `/api/analyze/*` (yfinance, growth_story) | Batch (daily) | `analysis_tickers`, `analysis_growth_stories` | External yfinance/news-style data. Worker refreshes known/watchlisted tickers and writes freshness/error state. |
| `/api/bonds/scanner` | Batch (daily) | `bond_scanner_results` | External/curated bond universe. Worker refreshes daily; frontend filters Supabase rows. |
| `/api/finances/price` | Batch (hourly) | `price_cache` | External lookup/cache. Frontend reads latest price row and freshness. |
| `/api/ndx/sync` | Batch (daily after market close) | existing `ndx_*` tables | Worker syncs market data after close. Frontend reads existing NDX tables. |
| `/api/trading/sync` | Batch (frequent, with IB Gateway) | existing trading tables | IB-dependent laptop worker refreshes account summaries/positions, then propagates dependent dividend syncs as a follow-up worker step. |
| `/api/pension/upload` | Storage trigger / poll | parsed rows in pension tables | User uploads PDF to Supabase Storage. Worker polls Storage bucket for new files, parses, writes pension tables, and records parse status. |

The wildcard rows above intentionally cover the concrete FastAPI routes currently grouped under those routers, such as `/api/analyze/fundamentals/{ticker}`, `/api/analyze/price-history/{ticker}`, `/api/analyze/technicals/{ticker}`, `/api/analyze/options/{ticker}`, `/api/analyze/synthesis/{ticker}`, `/api/analyze/growth-story/{ticker}`, `/api/backtest/run`, `/api/backtest/years`, and `/api/trading/sync-to-dividends`.

## Phase B implementation requirements

- Every new result table in an exposed schema must have RLS enabled and policies matching its read/write model.
- Service-role keys remain server-only and must never use a `NEXT_PUBLIC_` prefix.
- Worker writes should include `refreshed_at`, `source`, and error/status fields so the frontend can represent stale or failed refreshes.
- Frontend migrations are complete only when no `/api/*` references remain for the endpoint being migrated.
- FastAPI business routes should become admin-only maintenance affordances or be removed after their worker replacement lands.

## Consequences

- PR #206's tunnel-based pivot is superseded.
- TJ-020 becomes the umbrella for Phase B scheduler, job queue, result table, and frontend migration work.
- Rabin should review service-role-key handling before any Phase B worker writes are merged.
