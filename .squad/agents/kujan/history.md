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

📌 **Startup & Access Runbook (2026-04-30 — vercel-06-startup-and-access.md):**
- **Critical gotcha:** `vercel pull` writes to `.vercel/.env.development.local` but `next dev` only reads from the project root. Must `cp .vercel/.env.development.local .env.development.local` before `npm run dev` or the app 500s with "Your project's URL and Key are required".
- **`vercel dev` alternative:** Using `vercel dev` instead of `npm run dev` reads `.vercel/` directly and avoids the copy step — but loses Turbopack.
- **Port conflict handling:** Next.js auto-selects next available port if 3000 is in use (e.g., 3002). Watch startup output for actual URL.
- **Dev deployment URL pattern:** `https://trading-journal-<hash>-cohenjos-projects.vercel.app` — deployment-protection-gated (returns 401 to unauthenticated). Access requires Vercel org membership.
- **`vercel ls` scope:** `--scope cohenjos-projects` required; listing without scope returns empty even if project is linked.
- **`vercel.json` fix:** `preferredRegion` nested inside `functions` is invalid — moved to top-level `regions: ["fra1"]`.
- **`.env` location:** Lives in main repo worktree (`trading-journal/.env`), not in coord worktree. Source path explicitly.
- **First deployment:** No prior deployments existed in cohenjos-projects scope; first deploy completed successfully with Next.js Turbopack build.
- **Vercel vuln scanner:** May flag current Next.js version as "vulnerable" even when it's latest — check advisories, don't block on scanner lag.

📌 **Supabase Local Dev Runbook (2026-05-01 — supabase-01-local-dev.md):**
- CLI auth key naming changed: newer versions output `Publishable`/`Secret` (`sb_publishable_...`/`sb_secret_...`) instead of `anon key`/`service_role key` — always copy from `supabase status`, never hardcode.
- Mailpit (not Inbucket) is the mail catcher label in current `supabase start` output; both refer to port 54324.
- `?statement_cache_size=0` is only needed for the prod transaction-mode pooler (port 6543), NOT local direct (54322) or remote direct (5432) — confirmed from prior runbook work.
- `supabase login` / PAT only required for remote platform operations (`link`, `db push`); local stack works fully offline.
- No native down-migration support in Supabase CLI — manual undo migrations are the documented pattern.

📌 **Supabase Remote Provisioning Runbook (2026-05-02):** Free plan caps at **2 active projects** per org (verified from pricing.md) — dev + prod only unless org upgrades to Pro. PITR is Pro-only add-on at $100/month per 7-day window; free tier has zero automated backups. Region `eu-central-1` (Frankfurt) confirmed valid exact AWS region ID. Free-tier projects pause after 1 week of inactivity; data is preserved on pause (⚠️ verify resume-on-request behavior). Transaction pooler (port 6543) requires `?statement_cache_size=0` for SQLAlchemy/asyncpg; direct connections (port 5432) do not.

## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Supabase Runbook Delivery (2026-05-01):** CLI flow (`supabase init` → `start` → `migration new` → `db reset` → `link` → `db push`). Local stack (Postgres 54322, API 54321, Studio 54323, Inbucket 54324). SQLAlchemy: `?statement_cache_size=0` only for pooler (port 6543), not direct (54322/5432). RLS: `is_household_member()` security definer + policies. OAuth: Google → `/auth/v1/callback` → app `/auth/callback`. Free-tier: 500MB DB, 50k MAU, 7-day backup, auto-pause @7d inactivity. Region: `eu-central-1` (Frankfurt). See `docs/design-hosting/setup-supabase.md` (498 lines).

📌 **Runbook Split & Free-Tier Topology Fix (2026-04-30):**
- **Critical Finding:** Free-tier topology corrected to 2 projects (dev/preview shared + prod) — was 3 in original design. Verified against live Supabase pricing; switching from 3 to 2 saves $25/mo and stays within Hobby budget.
- **Architecture Impact:** Dev and preview environments now share a single remote project. Mitigations: per-PR seed reset (cheap) or upgrade to Pro when team grows.
- **Runbook Split:** Combined setup-supabase.md (498 lines) split into 3 deep-dives: supabase-01-local-dev (202), supabase-02-remote (315), supabase-03-auth-rls (385).

📌 **Encrypted pg_dump Backup (TJ-009, 2026-05-02):** `.github/workflows/nightly-backup.yml` (cron 03:00 UTC, age encryption, 90-day retention, auto-issue on failure). `scripts/restore-from-backup.sh` (pg_restore with verification). `docs/design-hosting/operations/backup-and-restore.md` (strategy + 3 DR scenarios). Key notes: port 5432 (not pooler 6543), GH artifact cap 90d, `auth.users` hashes included (treat as sensitive), lost age key = permanent loss.

📌 **CI/CD Scaffolding — TJ-008 (2026-05-01):** Frontend npm Node 20, backend uv Python 3.11. Workflows: `pr-frontend.yml` (lint/tsc/vitest), `pr-backend.yml` (ruff/pytest+postgres), `pr-supabase-migrations.yml` (lint + shadow DB). Zero deploy — Vercel owns deploys. mypy auto-skips if absent. RLS smoke test deferred (TODO).


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

### 2026-04-30 — YOLO Direct-Apply Round: TJ-001 Local Supabase Dev Runbook Finalization

**Requested by:** Jony Vesterman Cohen (Coordinator YOLO spawn)  
**Work:** Completed TJ-001 local Supabase development runbook with full Docker Compose setup, CLI workflow, migration strategy, RLS pattern guide, OAuth setup, and 12-item free-tier watchlist (all for team verification). PR #91 merged (commit 9cf168e).

**Key Insight:** Supabase CLI tooling is fast-evolving; key output labeling changed (anon key → publishable key); always verify against `supabase status` not docs.

📌 **PR Board Triage — Dependabot + Stale Draft (2026-07-25):**

**Requested by:** Jony Vesterman Cohen (autopilot)

**Context:** Full PR board cleanup post-Supabase+Vercel migration. 12 open PRs evaluated.

**Merged (8 PRs):**
- **#52** cachetools >=7.0.5→>=7.0.6 — safe minor, cachetools used in analyze endpoints
- **#51** pypdf >=6.10.0→>=6.10.2 — safe patch, pypdf in active use
- **#50** @eslint/eslintrc 3.3.1→3.3.5 — safe patch
- **#47** @playwright/test 1.57.0→1.59.1 — safe minor (1.x)
- **#46** bcrypt <4.1→<5.1 — safe range expansion; bcrypt IS still used via passlib/CryptContext in `app/auth/security.py` even after Supabase JWT migration. Local auth endpoints (register/login) still hash passwords with bcrypt.
- **#44** setup-python v4→v6 — only breaking change is Node 24 runner (v2.327.1+); GitHub-hosted runners support this; brings copilot-setup-steps.yml into alignment with other workflows already on v5
- **#28** react-dom 19.1.0→19.2.5 — safe minor within React 19 family already in use
- **#24** python-multipart >=0.0.22→>=0.0.27 — safe patch; required manual merge conflict resolution with pyproject.toml (pypdf update landed first)

**Deferred (3 PRs — needs human validation):**
- **#49** @types/node 20→25 — 5 major versions; must align with Node runtime target; test `npm run build && npm test` before merging
- **#48** jsdom 28→29 — major vitest test environment bump; run full test suite first
- **#45** upload-artifact v4→v7 — 3 major versions, affects 5 workflows; v5/v6 changelogs not reviewed

**Closed as obsolete (1 PR):**
- **#84** TJ-014 draft — docker-compose POSTGRES_* vars, Alembic env config, and `app/dal/database.py` are all dead post-Supabase migration. Root `.env.example` was already delivered by TJ-002 (PR #55). Left detailed comment explaining what was obsolete and why.

**Conflict resolution pattern:** Sequential dependabot merges modifying the same pyproject.toml require manual conflict resolution. Pattern: `gh pr checkout N → git merge origin/main → resolve → push --force-with-lease → gh pr merge --admin`. Trigger `@dependabot rebase` on other pending PRs before attempting their merges to minimize conflicts.

**Key Learnings for Future Triage:**
- Always grep for dep usage before closing bcrypt/passlib PRs — Supabase JWT replaced token _validation_ but local auth hashing is still alive.
- `@types/node` major bumps (following Node.js versions) should be validated against the project's target Node version in CI (currently Node 20).
- jsdom major bumps need full vitest suite run — it's the test DOM environment.
- upload-artifact major bumps need changelog review for each version in the jump range.
- setup-python major bumps are usually safe if the only change is the action's own Node runtime version.
- Dependabot PRs touching the same file (pyproject.toml, package.json) conflict cascade when merged sequentially — merge them in rapid succession or trigger `@dependabot rebase` proactively.

📌 Team update (2026-04-30T20:15:15Z): PR board cleanup triaged and merged into shared decisions. 8 merged (safe versions), 3 deferred with validation steps, 1 closed as obsolete. Decision now live in `.squad/decisions.md`.


📌 **Vercel Protection Bypass + BASE_URL Harmonization (2026-04-30 — squad/vercel-bypass-and-base-url):**
- **Bypass API:** Vercel REST API (`/v9/projects/{id}` PATCH) does NOT expose `protectionBypass` field — returns `bad_request: should NOT have additional property protectionBypass`. The feature must be enabled via the Vercel dashboard → Project Settings → Deployment Protection → Protection Bypass for Automation → Generate Token.
- **Manual step documented:** Runbook section 7.2 in `vercel-06-startup-and-access.md` walks through the one-time dashboard setup.
- **Secret location:** `trading-journal/.env` (gitignored), key `VERCEL_AUTOMATION_BYPASS_SECRET`. A placeholder has been pre-generated; replace with the token from the dashboard.
- **Playwright wiring:** `extraHTTPHeaders: { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '' }` added to `apps/frontend/playwright.config.ts` `use:` block.
- **Canonical env var:** `BASE_URL` (per Redfoot's decision). `PLAYWRIGHT_BASE_URL` kept as legacy alias in playwright.config.ts. The `baseURL` line updated to `process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'`.
- **New script:** `test:e2e:dev` added to `apps/frontend/package.json` targeting the pinned dev deployment URL.
- **Curl bypass test:** Returned 401 — expected until token is registered in Vercel dashboard.
