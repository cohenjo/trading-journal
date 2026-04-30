# 05 — Backend strategy

**Author:** Hockney (Backend Dev)  
**Requested by:** Jony Vesterman Cohen  
**Status:** Proposed  
**Recommendation:** **C. Hybrid** — Supabase/Vercel for the interactive app, FastAPI retained as a compute and integration worker.

## Executive summary

Move the durable database to Supabase Postgres and let the Vercel/Next.js app talk to it directly for user-facing CRUD and read paths through Server Actions, the Supabase client, and Row Level Security (RLS). Keep Python/FastAPI, but narrow its mission: broker integrations, PDF/file parsing, backtests, market-data sync, options analytics, and other heavy or Python-native jobs. Those jobs can run locally in Docker at first and later move to Fly Machines, Render Cron, Cloud Run Jobs, or a small hosted FastAPI worker without changing the UI contract.

This matches the stated preference: low hosting cost, low always-on backend burden, and the ability to keep heavy compute in Docker while the UI reads stable, denormalized **cooked** tables.

## End-state options

### A. Frontend-direct: no backend service

**Shape:** Vercel hosts the Next.js app. Server Actions and the Supabase client replace FastAPI for normal application operations. Supabase Auth issues JWTs. Supabase RLS protects tables. Heavy logic moves to Postgres functions, Supabase Edge Functions, or scheduled local jobs that write back to Postgres.

**Pros**

- Lowest operational cost: no always-on API container.
- Lowest latency for basic CRUD because Server Actions can read/write Supabase directly.
- Fewer custom auth surfaces: Supabase Auth + RLS become the enforcement point.
- Works well for table-shaped screens: finances, plans, insurance, positions, dashboards.
- Avoids running a public Python service until it is clearly needed.

**Cons**

- Highest dependency on correct RLS. A bad policy can expose private financial data.
- Python-native code must be rewritten or wrapped elsewhere.
- Complex file imports, broker SDKs, yfinance caching, and backtests do not fit neatly in Server Actions.
- Postgres functions are excellent for set-based transformations, but poor for complex Python libraries and external APIs.
- Server Actions should not become a hidden backend full of business logic without observability and tests.

**Use when:** the app is mostly authenticated CRUD over Postgres and data transformations are SQL-friendly.

### B. Hosted FastAPI

**Shape:** Keep the current FastAPI application and deploy it to Render, Fly, or Railway. Vercel talks to FastAPI; FastAPI talks to Supabase Postgres using a backend/service-role connection and validates Supabase JWTs.

**Pros**

- Familiar: preserves the current FastAPI + SQLModel + Alembic structure.
- Best compatibility with existing Python services and endpoint contracts.
- Central place for validation, rate limiting, logging, secrets, and third-party integrations.
- Can use service-role privileges safely server-side when RLS would be awkward.
- Easier to shield the frontend from schema churn.

**Cons**

- More moving parts: Vercel + Supabase + API host + worker scheduling.
- Free/cheap hosts may sleep; first request can be slow or fail a long-running job.
- Public API requires hardening: CORS, JWT verification, rate limits, request size limits, structured audit logs.
- Duplicates some Supabase features if the API mainly proxies CRUD.
- The API container can become a bottleneck for reads that Supabase/PostgREST can serve directly.

**Use when:** the backend is the product boundary, business logic is not SQL-friendly, or a public API is a deliberate product surface.

### C. Hybrid: frontend-direct for product data, FastAPI for compute and integrations

**Shape:** Vercel/Next.js uses Supabase directly for authenticated CRUD and read models. FastAPI remains, but only for heavy compute and integrations: Schwab sync, future IBKR, PDF imports, complex backtests, market-data jobs, options analytics, and one-off maintenance jobs. FastAPI can run as local Docker today and as a hosted worker later. It writes to raw, compute, and cooked tables; the UI reads cooked tables and OLTP-style tables through RLS.

**Pros**

- Keeps hosting cost low without discarding the Python backend investment.
- Keeps secrets and broker SDKs out of the browser and out of Vercel Server Actions.
- Lets heavy jobs run where they are most convenient: local Docker now, hosted jobs later.
- Gives the UI stable tables/materialized views instead of long API calls.
- Supports a gradual migration: endpoint-by-endpoint, not a big-bang rewrite.
- Separates product latency from compute latency: the app can stay fast while jobs run asynchronously.

**Cons**

- Requires discipline about boundaries: CRUD must not drift back into FastAPI by habit.
- Requires job observability: run tables, status, logs, retry/failure states.
- Requires careful write ownership to avoid Server Actions and workers racing over the same tables.
- RLS still matters for frontend-direct tables; service-role worker writes must be audited.

**Recommendation:** choose **C. Hybrid**. It preserves the current local-Docker compute direction and makes Supabase/Vercel useful immediately. FastAPI should stop being the default path for every screen and become the place for jobs that are actually backend-shaped: broker auth, data ingestion, file parsing, backtesting, and expensive analytics.

## Data layering: raw / compute / cooked

Use naming and ownership to make the data pipeline obvious.

### `raw_*` tables — direct ingestion

Raw tables store source-shaped facts with minimal transformation.

Examples:

- `raw_manual_trades`: manual trade entries from the UI.
- `raw_schwab_transactions`: Schwab export/API rows.
- `raw_market_bars`: source OHLCV bars, keyed by symbol/source/timeframe/timestamp.
- `raw_broker_positions`: broker position snapshots.
- `raw_pdf_extracts`: parsed pension/insurance/dividend PDF payloads, with source file metadata.

Rules:

- Append-first where possible; never silently overwrite source evidence.
- Include `source`, `source_account_id`, `source_file_id` or `external_id`, `ingested_at`, and `ingestion_run_id`.
- Keep raw columns close to source format, even if ugly.
- RLS can allow user reads for audit screens, but normal UI should not depend on raw tables.

### `compute_*` tables — intermediate results partitioned by `run_id`

Compute tables store intermediate job output and diagnostics.

Examples:

- `compute_backtest_trades(run_id, ...)`
- `compute_option_greeks(run_id, ...)`
- `compute_trade_matches(run_id, ...)`
- `compute_daily_pnl(run_id, ...)`
- `compute_sync_warnings(run_id, severity, message, payload)`

Rules:

- Every compute table includes `run_id`, `user_id`, `created_at`, and enough parameters to reproduce the run.
- Prefer partitioning or partial indexes by `run_id` for large backtests.
- Keep failed/partial runs for debugging; do not publish them to cooked tables.
- A `compute_runs` table should track `queued/running/succeeded/failed`, job type, parameters, started/finished timestamps, row counts, and error summaries.

### `cooked_*` tables and materialized views — UI read models

Cooked tables are denormalized, aggregated, RLS-protected read models for the UI.

Examples:

- `cooked_portfolio_summary`
- `cooked_daily_pnl`
- `cooked_positions_current`
- `cooked_dividend_dashboard`
- `cooked_ladder_overview`
- `cooked_backtest_results`
- `cooked_analysis_cache`

Rules:

- UI reads should prefer cooked tables/materialized views over recomputing from raw on every request.
- Cooked rows should include `as_of`, `source_run_id`, and `staleness`/`refreshed_at` metadata when useful.
- Server Actions can write OLTP tables such as plans, insurance policies, manual trade entries, and notes; workers publish derived state into cooked tables.

### Refresh strategy

Use three refresh modes, selected by workload:

| Refresh mode | Best for | Notes |
|---|---|---|
| On-write triggers | Small deterministic rollups, cache invalidation flags, `updated_at`, light daily summaries | Keep trigger logic simple. Do not run heavy analytics in triggers. |
| Scheduled refresh | Daily P&L, market sync, dividend dashboard, current positions, materialized views | Best default for cooked models. Use `compute_runs` and alert on stale outputs. |
| Hand-cranked refresh | Backtests, one-off imports, expensive PDF parsing, ad hoc recomputes | Trigger from UI/admin action or CLI; publish only after success. |

The practical default: write raw immediately, run compute asynchronously, and publish cooked rows only when the run succeeds.

## Scheduled and heavy computation execution options

### 1. Local Docker connected to Supabase

**Shape:** Keep the current backend/worker container locally. It connects to Supabase Postgres over TLS, reads raw tables, writes `compute_*`, and publishes `cooked_*`.

**Where the schedule can live**

- **Host cron:** simple and reliable on an always-on machine; calls `docker compose run worker ...` or an HTTP endpoint.
- **Docker healthcheck/loop:** easy to bundle but harder to observe and easy to accidentally run duplicate loops.
- **In-app APScheduler:** good for Python-native schedules and job metadata, but only reliable while the container and host are awake.

**Reliability concerns**

- Laptop sleep pauses jobs and can miss market windows.
- IP-based DB allow lists are painful if the machine moves networks.
- Secrets must live in local env/secret storage, never committed.
- Long jobs need idempotency because local networks and laptops are not reliable schedulers.

**Good fit now:** local/manual backtests, PDF parsing, development syncs, and low-frequency personal jobs where missing a run is acceptable.

### 2. GitHub Actions cron

**Pros**

- Free or already paid for, observable, easy logs.
- Simple encrypted secrets.
- Good for small scheduled scripts that can be retried manually.
- No always-on service.

**Cons**

- Six-hour job limit.
- Runner IP is not stable.
- Public-ish hosted runner; do not put broker desktop sessions or sensitive local files there.
- Schedules can be delayed and are not guaranteed to run exactly at market close.

**Good fit:** daily P&L recompute, dividend cache refresh, simple yfinance/market-data snapshots, stale cooked-table checks.

### 3. Fly Machines, Render Cron, Cloud Run Jobs

**Pros**

- Better reliability than a laptop.
- Proper scheduled jobs, logs, retries, and resource sizing.
- Can run the same Docker image used locally.
- Cloud Run Jobs are especially clean for finite batch jobs; Fly Machines are good for on-demand workers.

**Cons**

- More setup: container registry, IAM/secrets, network egress, deployment automation.
- Costs are low but non-zero.
- Broker integrations may still be awkward if they require desktop/TWS-style sessions.

**Good fit later:** daily scheduled syncs, long backtests, production-grade cooked-table refreshes, and anything the UI depends on being fresh.

### Workload recommendation

| Workload | Recommended execution | Why |
|---|---|---|
| Complex backtest | Local Docker now; Fly Machine or Cloud Run Job later | Expensive, parameterized, hand-cranked; publish results only on success. |
| Schwab/market data sync | GitHub Actions cron for simple API sync; hosted job if freshness matters | Observable and cheap; move hosted if market-close reliability becomes important. |
| Future IBKR sync | Keep/delete public API on hold; local Docker initially | IBKR/TWS connectivity is local-session sensitive and should not be a public UI dependency yet. |
| PDF parse/import | FastAPI/worker job, local or hosted | Python PDF tooling and validation belong in a worker, not Server Actions. |
| Daily P&L recompute | GitHub Actions cron or Supabase scheduled function for SQL-only; worker if Python logic is needed | Small, scheduled, easy to observe; output to `cooked_daily_pnl`. |
| Analyze/yfinance cache refresh | GitHub Actions cron or hosted worker | Avoid UI request latency and API throttling. |
| Manual CRUD screens | Next.js Server Actions + Supabase RLS | No need for FastAPI proxy. |

## Existing API surface inventory and target disposition

This is a quick inventory from `apps/backend/app/api/*.py` and `apps/backend/main.py`. Current protected routers are mounted under `/api` or their own `/api/...` prefixes.

| Current endpoint(s) | Current purpose | Target disposition |
|---|---|---|
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Local python-jose JWT auth and user lookup | **Move to Supabase Auth / Server Action.** Delete local password/JWT flow after migration; `me` becomes Supabase session/profile read. |
| `POST /api/metrics/page-load` | UI telemetry | **Move to Server Action** writing `raw_page_metrics` or use Vercel/Supabase analytics. |
| `POST /api/trades` | Manual trade creation | **Move to Server Action** writing `raw_manual_trades`/OLTP trades with RLS. Trigger lightweight invalidation. |
| `GET /api/day/{date}` | Day detail composed from trades, notes, bars, summaries | **Move to cooked view + Server Action read.** Use `cooked_day_details` or composed SQL function if shape is complex. |
| `GET /api/summary/latest-month`, `GET /api/summary/{year}/{month}` | Daily summaries | **Move to cooked table/materialized view.** Refresh scheduled/on-write. |
| `POST /api/ndx/sync/{date}` | NDX 1m sync | **Keep in FastAPI/worker.** It is a market-data ingestion job. |
| `GET /api/ndx/{date}` | NDX chart data | **Move to Server Action** reading `raw_market_bars` or `cooked_chart_bars`. |
| `GET /api/ladder/overview`, `GET /api/ladder/income` | Bond ladder read models | **Move to cooked tables/views.** UI reads `cooked_ladder_overview` / `cooked_ladder_income`. |
| `PUT /api/ladder/rungs/{rung_id}`, `POST /api/ladder/bonds` | Bond ladder mutations | **Move to Server Action** with RLS and validation. |
| `GET /api/holdings`, `PUT /api/holdings/{bond_id}`, `DELETE /api/holdings/{bond_id}` | Bond holdings CRUD | **Move to Server Actions** for CRUD; cooked views for dashboard reads. |
| `GET /api/bonds/scanner` | Bond candidate scanner | **Keep in FastAPI** if it calls external sources or complex Python. If static SQL, move to Postgres function later. |
| `GET /api/dividends/dashboard` | Dividend dashboard aggregation | **Move to cooked table/materialized view.** |
| `POST/PUT/DELETE /api/dividends/position...` | Dividend position CRUD | **Move to Server Actions** with RLS. |
| `GET /api/dividends`, `POST /api/dividends` | Dividend records read/write/import | **Move simple CRUD to Server Actions; keep bulk import/refresh in worker** if external fetch is involved. |
| `POST /api/dividends/projection` | Projection calculation | **Move to Postgres function** if set-based/simple; **keep in FastAPI** if Python finance logic remains complex. |
| `GET/POST/DELETE /api/dividends/accounts...` | Dividend account config/import | **Move account CRUD to Server Actions; keep import job in FastAPI/worker.** |
| `GET /api/options`, `POST /api/options` | Options records read/write | **Move CRUD to Server Actions** with RLS. |
| `POST /api/options/projection` | Options projection | **Keep in FastAPI** initially; later Postgres function only if formula is SQL-clean and well-tested. |
| `POST /api/tax-condor/recommend` | Tax condor recommendation via IBKR provider | **Delete/hold IBKR-related public endpoint.** Reintroduce as worker-only when IBKR is active. |
| `POST /api/backtest/run`, `GET /api/backtest/years` | Backtest execution and year inventory | **Keep run in FastAPI/worker.** Move year inventory to Server Action/cooked metadata. |
| `GET /api/finances/price/{symbol}` | Price lookup | **Keep in worker or edge/cache layer**; avoid UI blocking on live third-party calls. |
| `GET /api/finances/latest`, `POST /api/finances/`, `GET /api/finances/history`, `DELETE /api/finances/{date_str}` | Finance snapshots CRUD/history | **Move to Server Actions** and cooked views. |
| `POST /api/plans/simulate` | Plan simulation | **Move to Postgres function** if deterministic and set-based; keep in FastAPI if complex Python model logic. |
| `GET/POST/PUT/DELETE /api/plans...` | Plan CRUD | **Move to Server Actions** with RLS. |
| `POST /api/pension/upload` | PDF upload and parsing | **Keep in FastAPI/worker.** Python PDF/AI extraction belongs outside Vercel/Supabase direct CRUD. |
| `GET /api/pension/reports`, `GET /api/pension/dashboard` | Pension report/dashboard reads | **Move to cooked tables/views** after worker writes parsed results. |
| `DELETE /api/pension/{pension_id}` | Pension delete | **Move to Server Action** if deleting logical records; worker can retain raw audit data. |
| `GET /api/analyze/fundamentals/{ticker}`, `/price-history/{ticker}`, `/technicals/{ticker}`, `/options/{ticker}`, `/synthesis/{ticker}`, `POST /growth-story/{ticker}` | yfinance/growth analysis and cached analytics | **Keep in FastAPI/worker** for external APIs, caching, and analytics. Publish durable outputs to `cooked_analysis_cache` where useful. |
| `GET /api/analyze/cache-stats` | In-memory cache stats | **Delete or replace** with worker/job observability tables. In-memory stats are less useful once jobs are scheduled. |
| `GET/POST/PUT/DELETE /api/insurance...` | Insurance policy CRUD | **Move to Server Actions** with RLS. |
| `GET /` | Health check | **Keep only if FastAPI remains hosted.** Not needed for local-only worker. |

## Migration steps

### Phase 0 — freeze boundaries before moving infrastructure

1. Decide table ownership: UI-owned OLTP tables, worker-owned raw/compute/cooked tables, shared reference tables.
2. Add `user_id` and audit columns where needed before enabling Supabase RLS.
3. Create `compute_runs` and a minimal job status model so heavy jobs can be observed before the UI depends on them.
4. Turn off `echo=True` in production database engines; keep SQL logs structured and safe.

### Phase 1 — move local Postgres to Supabase

1. Create Supabase projects for `dev` and `prod` (or one dev project plus local Supabase until production hardening is done).
2. Run existing Alembic migrations against Supabase using the **direct** database connection, not the PgBouncer transaction pool.
3. Load a sanitized snapshot from local Postgres into Supabase.
4. Validate row counts and financial totals for core tables: trades, matched trades, daily summaries, finance snapshots, positions, plans, pensions, insurance.
5. Add Supabase RLS policies in migrations after data shape is confirmed.
6. Switch local FastAPI `DATABASE_URL` to Supabase in a controlled branch and smoke-test existing endpoints.

### Phase 2 — replace python-jose JWTs with Supabase JWTs

1. Add Supabase Auth to the frontend and create profile mapping if application-specific user metadata is needed.
2. For transitional FastAPI, replace local `python-jose` HS256 verification with Supabase JWT verification using Supabase JWKS / project JWT settings.
3. Remove local password registration/login endpoints from the user journey; keep them only behind a temporary migration flag if needed.
4. FastAPI should use the JWT `sub` as `user_id` and never trust a user id supplied by the client.
5. Service-role keys must only be used by trusted server/worker code. Browser and Server Actions should use user-scoped Supabase clients unless a privileged administrative action is explicitly required.

### Phase 3 — split CRUD from compute

1. Move read-only dashboard endpoints to cooked views/tables first. This lowers API traffic without changing write semantics.
2. Move simple CRUD endpoints to Next.js Server Actions: plans, insurance, holdings, dividend positions, finance snapshots, manual trades.
3. Keep file uploads, broker sync, backtests, options analytics, and analysis endpoints in FastAPI/worker.
4. Replace API fetches in the frontend with typed Server Actions one page at a time.
5. For every moved endpoint, delete or deprecate the FastAPI route only after the frontend no longer calls it and RLS tests exist.
6. Add job-trigger Server Actions for heavy workloads: they enqueue a `compute_runs` row; the worker picks it up and publishes cooked output.

### Phase 4 — operationalize workers

1. Start with local Docker for heavy jobs, using Supabase secrets from local environment only.
2. Add GitHub Actions cron for small, deterministic refresh jobs.
3. Move reliability-sensitive jobs to Cloud Run Jobs/Fly/Render once the cost is justified.
4. Add stale-data indicators to cooked tables and UI cards so the user can see when a worker has not run.

## Connection pooling: Supabase PgBouncer implications

Supabase exposes a direct Postgres connection and a pooled PgBouncer connection. Use them differently:

- **Alembic migrations:** use the direct connection. Transaction-pool PgBouncer can break migration/session behavior.
- **Short-lived web/API traffic:** use PgBouncer transaction mode.
- **Long-running batch jobs:** prefer direct connection or a carefully sized application pool if transactions/session features are needed.

Current backend uses SQLModel with synchronous SQLAlchemy (`create_engine(DATABASE_URL, echo=True)`). For PgBouncer transaction mode:

- Keep application pools small; PgBouncer is already pooling.
- Set `pool_pre_ping=True` and consider `pool_recycle` for long-lived processes.
- Avoid session-level features: temp tables, session advisory locks, `LISTEN/NOTIFY` consumers, and `SET` state that must survive across transactions.
- Do not rely on prepared statements through PgBouncer transaction mode.
- If moving to `postgresql+asyncpg`, set prepared statement caches off, e.g. `connect_args={"statement_cache_size": 0}` and SQLAlchemy asyncpg `prepared_statement_cache_size=0` in the URL/dialect configuration.
- If moving to psycopg3, set `prepare_threshold=None` for pooled transaction-mode connections.
- Use the direct connection for jobs that need server-side cursors, long transactions, or migration-like behavior.

Recommended environment split:

```text
SUPABASE_DB_DIRECT_URL=postgresql://...          # Alembic, batch jobs needing session stability
SUPABASE_DB_POOL_URL=postgresql://...pgbouncer... # web/API short transactions
DATABASE_URL=$SUPABASE_DB_POOL_URL               # default app runtime after testing
```

## Local development story

There are three viable dev modes. Keep all three explicit rather than letting developers improvise.

### Option 1 — keep `docker-compose` local Postgres

**Best for:** offline development, fast tests, Alembic work, destructive migration testing.

- Keep local Postgres in Docker for unit/integration tests and migration rehearsal.
- Seed realistic but anonymized data.
- Do not make local Docker the only source of truth once Supabase is the production DB.

### Option 2 — shared Supabase dev project

**Best for:** auth/RLS integration and Vercel preview testing.

- Use a real Supabase dev project with real Auth and RLS policies.
- Keep data sanitized.
- Good for frontend-direct Server Actions because local mocks do not catch RLS mistakes.
- Risk: developers can collide on shared state unless user/project separation is clean.

### Option 3 — Supabase local (`supabase start`)

**Best for:** RLS/policy development without touching cloud data.

- Gives local Postgres, Auth, storage, and edge-function-like workflow.
- More moving parts than the current compose file, but closer to production Supabase behavior.
- Good target once the team commits to Supabase-native auth and RLS migrations.

**Recommendation:** keep current Docker Postgres for backend tests and migration rehearsal during the transition, add a Supabase dev project for auth/RLS and Vercel preview work, and evaluate `supabase start` after the first RLS policies stabilize. Do not use production Supabase as the daily dev database.

## Practical target architecture

1. **Vercel/Next.js** owns UI, auth session handling, Server Actions, and direct Supabase reads/writes for RLS-safe CRUD.
2. **Supabase Postgres** owns durable data, RLS policies, raw/compute/cooked layers, and SQL-friendly functions/materialized views.
3. **FastAPI worker** owns compute and integrations. It reads raw, writes compute, publishes cooked, and records `compute_runs`.
4. **Scheduler** starts local and cheap: local Docker for hand-cranked heavy jobs, GitHub Actions cron for simple refreshes. Move to hosted jobs only when reliability matters.

This gives the user a deployable web app without forcing every backend concern into Vercel or every CRUD request through a sleeping API container.
