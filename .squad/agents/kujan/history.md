# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

## Recent Focus (2026-05-01 onwards)

- Supabase branching vs 2-project model evaluation (Pro-only; free tier = 2-project)
- E2E CI webserver fixes (Chromium-only, ghc timing)
- E2E CI workflow wiring (smoke/auth/full nightly; deployment-triggered)
- Secret scanning hardening (gitleaks, .gitignore, pre-commit, GitHub push protection)
- E2E safety admin check (single-Supabase opt-in for personal projects)

**Key decisions merged in reskill pass (2026-05-05):**
- TJ-019: Local Docker compute backend + tunnel (cloudflared recommended)

**For detailed historical context, see `history-archive.md`.**

📌 **Team update (2026-05-05T18:32:37Z):** TJ-019 local Docker compute backend + tunnel decision merged into shared decisions. Reskill pass complete. — Scribe (wind-down)

📌 Team update (2026-05-06): FLEX backfill chunking pattern (monthly chunks) + checkpoint resume now in backfill_options.py — useful precedent for #65 (Postgres backfill) and multi-chunk import work — decided by Hockney

📌 Team update (2026-05-06): Transport retry pattern for external HTTP APIs — two-tier strategy (short backoff for network hiccups, long backoff for app throttle). Useful for any external API integration. See decisions.md entry from 2026-05-06. — decided by Hockney

📌 **Team update (2026-05-06T18:32:23Z):** Session lifetime bug pattern discovered in Flex backfill: SQLAlchemy Sessions must not be held open across slow external API calls (IBKR Flex can take 0-25 min during retry storms). Postgres pooler timeout closes idle connections after ~10 min. **Pattern applies broadly to any IBKR/Flex/external-API integration; flagged for all infrastructure/database work.** Architectural fix: Decouple fetch from Session lifetime (fetch API data first outside Session, then open Session only for DB operations). See decisions.md for details. — flagged by Hockney

## 2026-05-06T23:37 — Docker stack rebuild (Jony request)

### Summary
Rebuilt worker and backend images with latest main code and brought up the full Docker stack against production Supabase data (U2515365, 2022-2025 trades).

### Actions Taken
1. ✅ Verified Docker daemon running
2. ✅ Rebuilt `worker` and `backend` images with `--pull` (fresh base layers)
   - Build successful, dependencies (uv.lock from 2026-05-06) current
   - Images: `trading-journal-worker` and `trading-journal-backend`
3. ✅ Brought up full stack (`docker compose up -d`)
   - `db` (local postgres): healthy
   - `otel-collector`, `prometheus`, `ib-gateway`: running
   - `worker`: healthy (heartbeat file actively written, polling loop running)
   - `backend`: up but unhealthy (schema mismatch, see note below)
   - `frontend`: port 3001 conflict with local process (VS Code workspace); non-critical for worker task

### Current State
- **Worker:** ✅ Healthy, running, heartbeat active
- **Backend:** Container up; REST API functional on `:8000`; healthcheck failing due to schema
- **Database:** Local postgres + Supabase pooler connection (DATABASE_URL → pooler)
- **Observations:** Worker and backend attempting to use `compute_jobs.next_retry_at` column which doesn't exist in production Supabase schema

### Schema Gap Identified
Recent migrations exist but not applied to production:
- `20260503161310_add_compute_jobs.sql` — creates the table
- `20260506000001_compute_jobs_backoff.sql` — adds `next_retry_at` + updates retry logic (attempts ≤ 5)

Both worker and backend poll `compute_jobs` with `next_retry_at` in WHERE clause → `UndefinedColumn` error.

**Prerequisite:** Supabase migrations must be applied before worker can successfully poll the queue.

### Learnings & Gotchas
- Rebuild used `--pull` to ensure fresh base layers (Debian 13 + Python 3.11); uv dependency sync is stable.
- Worker healthcheck is based on heartbeat file freshness + DATABASE_URL env var check—independent of queue polling success.
- Frontend port conflict (3001) doesn't block worker; skipped manual intervention as non-essential.
- Flex backfill code merged to main; worker stack is ready to resume classifications once migrations applied and Hockney's lifecycle/roll fixes land.

### Next Steps (for team)
1. Apply `supabase/migrations/20260503*.sql` and `20260506*.sql` to production Supabase.
2. Verify worker resumes polling `compute_jobs` without `UndefinedColumn` errors.
3. After Hockney's classifier fixes merge, re-run classification jobs against 2022-2025 trade data.


📌 Team update (2026-05-07): Docker stack rebuilt and healthy. Worker polling compute_jobs queue. Coordinator applied schema migration to Supabase production (compute_jobs.next_retry_at). Ready for backend to re-run classification jobs post-merge.

## 2026-05-09T13:30 — Docker compose trim + pre-commit workflow change (Issues #336, #337)

### Summary
Trimmed docker-compose.yml to worker-only and removed no-commit-to-branch pre-commit hook per Jony's request.

### Actions Taken

#### Issue #337 — Trim docker-compose
1. ✅ Analyzed architecture shift:
   - DB → Supabase (cloud)
   - Frontend → Vercel (cloud)
   - Backend → Subsumed by worker for compute jobs
   - Worker → Docker local, processes `compute_jobs` queue
   - IB Gateway → REMOVED (replaced with Flex queries: `apps/backend/scripts/flex_probe.py`, `flex_parser.py`)
   - OTEL collector → REMOVED (worker doesn't import opentelemetry; only API routes use it, but those run on Vercel)
2. ✅ Trimmed `docker-compose.yml`:
   - Removed: `db`, `backend`, `frontend`, `ib-gateway`, `otel-collector`, `prometheus`, `jaeger`, `grafana`
   - Kept: `worker` (polls `compute_jobs` every 5s, writes heartbeat to `/app/worker_heartbeat`)
   - Worker env: `DATABASE_URL` (Supabase), `WORKER_HEARTBEAT_FILE`, `WORKER_POLL_INTERVAL_SECONDS`
3. ✅ Deleted `docker-compose.backend.yml` (redundant)
4. ✅ Updated docs:
   - `README.md`: New "Running with Docker Compose" section (worker-only)
   - `docs/options-income-dashboard-design.md`: Removed `ib_gateway` from enum
   - `docs/design-hosting/operations/secrets-and-env-vars.md`: Replaced IB Gateway section with worker-only env vars
5. ✅ Verified:
   - `docker compose config` → validates successfully
   - `docker compose up -d worker` → boots in ~30s, builds deps, starts polling
   - Logs show: `INFO:apscheduler.executors.default:Job "_safe_poll_compute_jobs" executed successfully` every 5s
   - Worker status: `healthy` after startup period

#### Issue #336 — Drop no-commit-to-branch hook
1. ✅ Removed `no-commit-to-branch` hook from `.pre-commit-config.yaml`
2. ✅ Updated `CONTRIBUTING.md`:
   - Added "Development Workflow" section
   - Direct commits to `main` OK for low-risk changes (docs, config, single-file edits)
   - PRs recommended for multi-file/feature work
   - Worktrees encouraged for parallel work
   - Updated hooks table (removed `no-commit-to-branch`, kept all security hooks)
3. ✅ Verified:
   - `uv run pre-commit run --all-files` → passes (trailing whitespace fixed)
   - `grep -i 'no-commit'` on pre-commit output → no results (hook is gone)

### Current State
- **docker-compose.yml:** Worker-only. Clean, minimal.
- **Pre-commit hooks:** Security hooks active (gitleaks, private key detection, reject .env files, ruff). No branch blocking.
- **Commits pushed:**
  - `a1fb363` — chore(compose): trim to worker-only, remove db/frontend/backend/ib-gateway (Closes #337)
  - `01eaa08` — chore(pre-commit): remove no-commit-to-branch hook + document workflow (Closes #336)

### Learnings & Gotchas
- **OTEL usage:** Only `apps/backend/app/api/metrics.py` and `app/api/plans.py` import opentelemetry. Worker doesn't. Safe to remove otel-collector from compose.
- **IB Gateway references:** Removed from compose but still exist in worker handlers (`apps/backend/app/worker/handlers/options_margin_sync.py`) as fallback. Code checks `is_ib_gateway_available()` and skips gracefully if offline. No action needed; handlers will naturally stop trying once IB Gateway is never available.
- **Git index.lock issue:** Encountered during staging. Removed `.git/index.lock` to proceed. Likely VSCode git extension holding lock.
- **docs/ in .gitignore:** Ran into `ignored by .gitignore` error. Used `git add -f` to force-add specific doc files. Good pattern for tracked files in ignored directories.

### Next Steps
None. Both issues resolved. Worker is production-ready on Supabase.

📌 **Team update (2026-05-09):** Removed `no-commit-to-branch` hook (#336) + trimmed docker-compose to worker-only (#337). Hockney completed migration drift audit (#335, awaiting approval). Redfoot fixed E2E Playwright hook placement (#334). Fenster + McManus shipped stacked income chart (#338).

## 2026-05-09T14:00 — Nightly backup failure investigation (Issues #326, #329, #331, #333)

### Summary
Investigated 4+ consecutive days of nightly backup failures. Root cause identified: `SUPABASE_PROD_DB_URL` GitHub secret is empty or not set.

### Findings
- **Error:** `pg_dump: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory`
- **Meaning:** `pg_dump --dbname` receives an empty string; falls back to local Unix socket which doesn't exist on the runner.
- **Scope:** Every recorded run (9+, back to 2026-05-01) fails identically. Zero successful runs on record.
- **Workflow code:** Healthy. PGDG APT fix in #271 (2026-05-05) was correct; postgresql-client-15 installs fine. `ubuntu-22.04` is pinned, runner image is stable. No code fix needed.
- **Cause is operational:** Secret `SUPABASE_PROD_DB_URL` is missing/empty/stale in GitHub repo secrets.

### Actions Taken
1. ✅ Diagnosed root cause from failure logs (runs 25593201093 + 25418843233 + 25204644120)
2. ✅ Escalated on #333 with exact steps for Jony ([comment](https://github.com/cohenjo/trading-journal/issues/333#issuecomment-4413447955))
3. ✅ Cross-referenced #331, #329, #326 → pointing at #333

### Blocked On
Jony must set `SUPABASE_PROD_DB_URL` in GitHub Settings → Secrets → Actions with the Supabase **direct** connection URL (port 5432). Format: `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`. If project is paused, restore it at supabase.com/dashboard first.

### Next Steps
- Jony sets secret → manually triggers workflow → confirms success → closes #333 (and #326, #329, #331).
