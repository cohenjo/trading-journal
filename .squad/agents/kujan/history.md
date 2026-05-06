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
