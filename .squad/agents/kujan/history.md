# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary (Feb-Apr 2026)

**Initial Environment Audit:**
- `.gitignore` already covered `.env`, `node_modules/`, `.venv/`, `trading-journal-data/`, `reports/`, `.DS_Store`, IDE dirs
- Added missing entries for `.aspire/`, `.next/`, `.copilot/`
- `.copilot/mcp-config.json` contains MCP server configs with API key env var refs — must stay gitignored
- `.aspire/settings.json` is local Aspire dev settings — gitignored
- Aspire SDK packages bumped to 13.1.2

**Q1 Decisions:**
- Financial Precision & Type Safety (Feb 23)
- Security Hardening (Feb 23)
- Testing & QA planning (Feb 23)
- API Documentation & DevOps planning (Feb 23)

**Testing Infrastructure Sprint (Apr 10):**
- **CI Pipeline (squad-ci.yml):** Frontend job (npm ci → lint → tsc → vitest), Backend job (uv sync → ruff → mypy → pytest + PostgreSQL service), Docker build validation, Playwright E2E tests
- **Pre-commit Hooks:** Trailing whitespace, end-of-file-fixer, check-yaml, ruff (Python), reject-env-files, detect-private-key, no-commit-to-branch (main)
- **Docker Health Checks:** PostgreSQL pg_isready, Backend curl /health, Frontend curl http://localhost:3000, proper depends_on with service_healthy conditions
- **Dependabot Configuration:** npm updates (weekly Monday 9 AM, max 5 PRs), Python updates (weekly), docker images (weekly)
- **4 commits, production-grade pipeline deployed**

**Key Infrastructure Decisions:**
- PostgreSQL service container for backend integration tests
- npm and pip caching for faster CI runs
- Playwright chromium tests for E2E validation

---

## Learnings

📌 **Supabase Local Dev Runbook (2026-05-01 — supabase-01-local-dev.md):**
- CLI auth key naming changed: newer versions output `Publishable`/`Secret` (`sb_publishable_...`/`sb_secret_...`) instead of `anon key`/`service_role key` — always copy from `supabase status`, never hardcode.
- Mailpit (not Inbucket) is the mail catcher label in current `supabase start` output; both refer to port 54324.
- `?statement_cache_size=0` is only needed for the prod transaction-mode pooler (port 6543), NOT local direct (54322) or remote direct (5432) — confirmed from prior runbook work.
- `supabase login` / PAT only required for remote platform operations (`link`, `db push`); local stack works fully offline.
- No native down-migration support in Supabase CLI — manual undo migrations are the documented pattern.

📌 **Supabase Remote Provisioning Runbook (2026-05-02):** Free plan caps at **2 active projects** per org (verified from pricing.md) — dev + prod only unless org upgrades to Pro. PITR is Pro-only add-on at $100/month per 7-day window; free tier has zero automated backups. Region `eu-central-1` (Frankfurt) confirmed valid exact AWS region ID. Free-tier projects pause after 1 week of inactivity; data is preserved on pause (⚠️ verify resume-on-request behavior). Transaction pooler (port 6543) requires `?statement_cache_size=0` for SQLAlchemy/asyncpg; direct connections (port 5432) do not.

## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Supabase Runbook Delivery (2026-05-01):**
- **CLI Workflow Confirmed:** `supabase init` → local stack with `supabase start` → migrations via `supabase migration new` → test with `supabase db reset` → link remote with `supabase link` → deploy with `supabase db push`
- **Local Dev Stack:** Docker-based with Postgres (54322), API (54321), Studio (54323), Inbucket mail catcher (54324)
- **PgBouncer Gotcha:** SQLAlchemy requires `?statement_cache_size=0` ONLY for transaction-mode pooler (port 6543), NOT for local direct connections (port 54322) or remote direct (port 5432)
- **RLS Pattern:** `is_household_member(hid uuid)` security definer function + policies on every user-data table
- **OAuth Flow:** Google → Supabase `/auth/v1/callback` → app `/auth/callback` — both redirect URIs must be configured
- **Migration Safety:** Always test locally (`supabase db reset`) before remote push; no native down-migration support (manual undo migrations required)
- **Free-Tier Watchpoints:** 500 MB DB, 50k MAU, 5 GB egress, 7-day backup retention, project auto-pause after ~7 days inactivity (all marked for verification)
- **Region Choice:** `eu-central-1` (Frankfurt) recommended for Israel-based dev; cannot change post-creation
- **Runbook Location:** `docs/design-hosting/setup-supabase.md` (498 lines, references TJ-001/004/005/007)

📌 **Runbook Split & Free-Tier Topology Fix (2026-04-30):**
- **Critical Finding:** Free-tier topology corrected to 2 projects (dev/preview shared + prod) — was 3 in original design. Verified against live Supabase pricing; switching from 3 to 2 saves $25/mo and stays within Hobby budget.
- **Architecture Impact:** Dev and preview environments now share a single remote project. Mitigations: per-PR seed reset (cheap) or upgrade to Pro when team grows.
- **Runbook Split:** Combined setup-supabase.md (498 lines) split into 3 deep-dives: supabase-01-local-dev (202), supabase-02-remote (315), supabase-03-auth-rls (385).

📌 **Encrypted pg_dump Backup Infrastructure (TJ-009, 2026-05-02):**
- Delivered `.github/workflows/nightly-backup.yml` — cron 03:00 UTC, `pg_dump --format=custom --compress=9`, `age -r $AGE_PUBLIC_KEY` encryption, 90-day artifact retention, workflow_dispatch, concurrency guard, failure → auto GH issue with `priority:critical,squad:kujan` labels.
- Delivered `scripts/restore-from-backup.sh` — `set -euo pipefail`, age decrypt → pg_restore `--clean --if-exists --no-owner --no-privileges --single-transaction`, row-count verification on 3 tables, cleanup trap removes plaintext dump on exit.
- Delivered `docs/design-hosting/operations/backup-and-restore.md` — strategy, one-time setup, quarterly drill runbook, 3 DR scenarios (accidental delete / project deleted / key lost), cost estimate ($0 for small DB), limitations.
- Key learnings: `pg_dump` requires direct URL port 5432 (NOT pooler port 6543); age `-r` for encrypt, `-i` for decrypt; GH artifact retention hard cap is 90 days; `auth.users` hashes ARE included in pg_dump — treat backups as highly sensitive; lost age private key = permanent data loss with zero recovery path.

📌 **CI/CD Scaffolding — TJ-008 (2026-05-01):**
- **Toolchain Confirmed:** Frontend uses npm + Node 20 (package-lock.json); backend uses uv (uv.lock) + Python 3.11; no pnpm in use.
- **Workflows Created:** `pr-frontend.yml` (lint/typecheck/build/vitest), `pr-backend.yml` (ruff/mypy-optional/pytest+postgres), `pr-supabase-migrations.yml` (supabase db lint + shadow DB dry-run), `branch-protection-status.yml` (rollup reference).
- **Strategy A enforced:** Zero deploy workflows — Vercel git integration owns all deploys; GH Actions is PR-validation only.
- **mypy skip logic:** No `[tool.mypy]` section in pyproject.toml detected; typecheck job auto-skips with notice if config absent.
- **RLS smoke test deferred:** Documented as inline TODO in migration workflow; requires ~50 lines SQL scripting — tracked for follow-up.


📌 **Secrets & Env Var Inventory (TJ-002 / GH #55, 2025-01-01):**
- Grepped `apps/frontend/src/`, `apps/backend/app/`, `docker-compose.yml`, `.github/workflows/` — confirmed 28 vars (10 🔴 secret, 16 🟡 config, 2 🟢 public). `NEXT_PUBLIC_API_URL` is the only frontend env var currently in code; Supabase vars are runbook-documented but not yet wired in frontend.
- `SUPABASE_SERVICE_ROLE_KEY` confirmed as the critical guard — must never carry `NEXT_PUBLIC_` prefix; CI guard documented.
- Delivered: `docs/design-hosting/operations/secrets-and-env-vars.md` (full inventory + naming convention + storage matrix + rotation runbooks), `.env.example` at repo root.
- `.gitignore` already had `!.env.example` negation — no gitignore change required.
- GH #55 commented with full summary (28 vars, 10 🔴 secrets, links to doc and .env.example).
**Blockers:**
- Backend `/health` endpoint may not exist yet — health check will fail until implemented
- Frontend health check assumes Next.js responds on port 3000 root
- E2E tests depend on `tests/` directory structure (may need adjustment)

**Next Actions:**
- Hockney should add `/health` endpoint to backend for Docker health checks
- Redfoot should validate CI pipeline configuration quality
- Team should run `pre-commit install` locally to activate hooks

📌 Team update (2026-04-10T08:19:59Z): Testing Sprint Phase 1-3 Complete — Phase 2 DevOps review: CI broken (critical blocker), pre-commit hooks missing, PostgreSQL integration needed Phase 1 (not Phase 2), Docker health checks required. Phase 3 implementation: 5 commits delivered: squad-ci.yml fixed, .pre-commit-config.yaml created, docker-compose.yml health checks added, dependabot.yml configured, all validation passing. Infrastructure P0 complete. Branch squad/testing-ci-infrastructure ready for merge. All CI/CD, pre-commit, health checks verified working. Orchestration, session logs, decisions merged. — Scribe (Team Orchestration)
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md
