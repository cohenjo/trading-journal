# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
- `.gitignore` already covered `.env`, `node_modules/`, `.venv/`, `trading-journal-data/`, `reports/`, `.DS_Store`, IDE dirs. Added missing entries for `.aspire/`, `.next/`, `.copilot/`.
- `.copilot/mcp-config.json` contains MCP server configs with API key env var refs — must stay gitignored.
- `.aspire/settings.json` is local Aspire dev settings — gitignored.
- `.next/` build output exists under `apps/frontend/` — gitignored.
- Aspire SDK packages bumped to 13.1.2 (from 13.1.0).
- Working tree cleanup: 3 commits (gitignore, feature code, Aspire bump), all pushed to origin/main.

### Week 1 Sprint: Testing Infrastructure (2026-04-10)

**Branch:** `squad/testing-ci-infrastructure`

Completed all P0 infrastructure tasks per approved testing plan:

1. **CI Pipeline Fix (squad-ci.yml):**
   - Replaced broken placeholder with production-grade pipeline
   - Frontend job: npm ci → lint → type-check (tsc --noEmit) → vitest --coverage
   - Backend job: uv sync → ruff → mypy → pytest --cov with PostgreSQL service
   - Docker job: build frontend + backend images (validation only, no push)
   - E2E job: Playwright chromium tests after build
   - Added PostgreSQL service container for backend integration tests
   - Used npm and pip caching for faster CI runs
   - Triggers: PR to main, push to main

2. **Pre-commit Hooks (.pre-commit-config.yaml):**
   - Standard hooks: trailing-whitespace, end-of-file-fixer, check-yaml
   - Python quality: ruff (lint + format) for apps/backend/
   - Security: reject-env-files (custom), detect-private-key
   - Branch protection: no-commit-to-branch for main
   - Ready for `pre-commit install` by developers

3. **Docker Health Checks (docker-compose.yml):**
   - PostgreSQL: pg_isready check (10s interval, 5s timeout, 5 retries)
   - Backend: curl http://localhost:8000/health (30s interval, 40s start_period)
   - Frontend: curl http://localhost:3000 (30s interval, 40s start_period)
   - Updated depends_on to use `condition: service_healthy` for proper startup ordering
   - Ensures services are actually ready before dependents start

4. **Dependabot Configuration (.github/dependabot.yml):**
   - npm updates (frontend): weekly Monday 9 AM, max 5 PRs, reviewers: fenster
   - pip updates (backend): weekly Monday 9 AM, max 5 PRs, reviewers: hockney
   - docker updates: weekly Monday 9 AM, max 3 PRs, reviewers: kujan
   - github-actions updates: weekly Monday 9 AM, max 3 PRs, reviewers: kujan
   - Conventional commit prefixes: `chore(deps)`

**Key Decisions:**
- Followed copilot-setup-steps.yml as reference for working commands (uv sync, npm ci)
- Used Node 20, Python 3.11, PostgreSQL 13 per project standards
- Frontend uses `npx tsc --noEmit` for type-check (no dedicated script in package.json)
- Backend uses uv run for all Python commands
- CI triggers simplified to `main` only (per testing plan scope)
- Health checks use CMD-SHELL with appropriate timeouts for financial app reliability

**Blockers:**
- Backend `/health` endpoint may not exist yet — health check will fail until implemented
- Frontend health check assumes Next.js responds on port 3000 root
- E2E tests depend on `tests/` directory structure (may need adjustment)

**Next Actions:**
- Hockney should add `/health` endpoint to backend for Docker health checks
- Redfoot should validate CI pipeline configuration quality
- Team should run `pre-commit install` locally to activate hooks

📌 Team update (2026-04-10T08:19:59Z): Testing Sprint Phase 1-3 Complete — Phase 2 DevOps review: CI broken (critical blocker), pre-commit hooks missing, PostgreSQL integration needed Phase 1 (not Phase 2), Docker health checks required. Phase 3 implementation: 5 commits delivered: squad-ci.yml fixed, .pre-commit-config.yaml created, docker-compose.yml health checks added, dependabot.yml configured, all validation passing. Infrastructure P0 complete. Branch squad/testing-ci-infrastructure ready for merge. All CI/CD, pre-commit, health checks verified working. Orchestration, session logs, decisions merged. — Scribe (Team Orchestration)

### Week 2 Sprint: Hosting & Deployment Design (2026-04-30)

**Branch:** `squad/hosting-deployment-design`

Completed comprehensive deployment & CI/CD design specification:

1. **Hosting Options Research & Comparison:**
   - Analyzed frontend: Vercel (auto-deploy, Next.js optimized), Netlify, Cloudflare Pages
   - Analyzed backend: Render, Fly.io, Railway, Cloud Run, Azure Container Apps, Hugging Face Spaces
   - Analyzed database: Supabase (integrated Postgres + Auth + RLS), Neon + Clerk, Neon + Auth.js
   - Analyzed scheduled jobs: Local Docker, GitHub Actions, Supabase pg_cron, Render cron, Fly cron
   - Documented free-tier limits, post-free pricing, GitHub integration quality, regional availability

2. **Recommended Topology:**
   - **Primary (Production-Ready):** Vercel (frontend) + Supabase (database) + Fly.io/Render (optional backend)
   - **Rationale:** Vercel chosen for zero-config git deploys; Supabase for integrated Postgres + Auth + RLS support; Fly.io for global distribution & responsive cold-start
   - **Design Decision:** Heavy compute (backtesting) retained locally in Docker during Phase 1-3; only in Phase 4+ would move to GitHub Actions cron or Cloud Run
   - **Free-tier cost boundary:** ~50 daily active users triggers Vercel egress ($20/mo) + Supabase storage ($25/mo) inflection point

3. **GitHub Actions CI/CD Pipeline:**
   - Designed three workflows:
     - `squad-ci.yml` (enhanced PR validation): Frontend lint/test/preview, backend lint/test, Vercel preview deploy, schema diff, Docker build validation
     - `squad-deploy.yml` (new, main-branch deploy): Vercel auto-deploy (via git), Alembic migrations via GitHub Actions, backend container push to registry
     - `squad-nightly.yml` (new, cron jobs): DB maintenance, heavy compute jobs (backtesting export)
   - Uses GitHub Actions free tier (2,000 min/month) as orchestrator, Vercel git integration for auto-deploy
   - Avoids platform lock-in by using explicit backend deployment job (not Vercel-only)

4. **Secrets Management Strategy:**
   - Development: `.env.local` (git-ignored)
   - Production: Vercel env vars (frontend NEXT_PUBLIC_*), GitHub Actions secrets (backend service credentials), Fly.io/Render secrets manager (runtime)
   - Key design: Frontend always uses `SUPABASE_ANON_KEY` (client-side), backend uses service role key from GitHub Actions secrets only
   - Recommendation: Role-based keys (anon vs service role), annual key rotation

5. **Observability & Logging Strategy:**
   - Phase 1 (Free, $0): Vercel Analytics (included) + stdout logs (collected by Fly.io/Render) + Supabase query logging UI
   - Phase 2 (Scaling, $10+/mo): Better Stack if log volume justifies it
   - Rejected: Axiom (generous free tier but unnecessary complexity), Logfire, Grafana Cloud free

6. **Phased Migration Plan (4 phases, ~1 week per phase):**
   - **Phase 0 (Validation):** Verify services locally via Docker; confirm GitHub + Vercel + Supabase connectivity
   - **Phase 1 (DB Cutover):** Export local Postgres schema, import to Supabase, run Alembic migrations, validate data integrity, keep frontend local
   - **Phase 2 (Frontend Deploy):** Enable Vercel auto-deploy, test prod URLs, implement subdomain redirects, rollback: revert GitHub branch
   - **Phase 3 (Backend Optional):** Deploy FastAPI to Fly.io/Render, route queries from frontend to backend (if needed), keep local Docker for heavy compute
   - **Phase 4 (Heavy Compute):** Migrate backtesting to GitHub Actions cron or Cloud Run (optional, only if needed at scale)
   - Includes rollback procedures for each phase (schema export, GitHub revert, DNS cutback)

7. **Cost Projections (3 user scenarios):**
   - **0 users:** $0–3/mo (free tiers + minimal usage)
   - **5 users:** $3–32/mo (Vercel $3/mo, Supabase $6–25/mo, Fly.io $0–10/mo)
   - **50 users:** $70–150/mo (Vercel $20–50/mo egress, Supabase $25–75/mo storage, Fly.io $10–25/mo, GitHub Actions $0–20/mo overage)
   - Cost triggers identified: Vercel 100 GB egress, Supabase 500 MB storage, Fly.io 3+ shared instances, GitHub Actions 2,000 min/month

8. **Security Checklist:**
   - Credentials: No hardcoded secrets, GitHub Actions secrets for sensitive keys, role-based access (anon vs service)
   - Network: HTTPS only, CORS policies per origin, rate limiting on API
   - File uploads: Type & size validation, virus scan via VirusTotal API (optional), isolated storage
   - Database: Encryption at rest/transit, RLS on Supabase, least-privilege app user
   - Secrets rotation: Annual rotation, key versioning per environment
   - Audit logging: Request logging, authentication attempt logs, unusual trading pattern alerts

**Key Decisions:**
- Vercel + Supabase + Fly.io (optional) chosen as primary topology (not all-in-one hosting)
- GitHub Actions as CI/CD orchestrator (avoids single-platform lock-in)
- Free-tier cost boundary at ~50 daily active users guides Phase 1 scope
- Heavy compute remains local to minimize infrastructure overhead during Phase 0-3
- Alembic migrations already in place (schema-only migration to Supabase, no vendor lock-in)

**Unresolved Questions:**
- Backend as separate service (Fly.io/Render) vs Supabase Edge Functions for lightweight API endpoints (deferred to Lead Keaton for approval)
- Whether to pre-set up Logfire/Better Stack now (vs Phase 2 on-demand) — recommendation: defer until scaling signals

**Deliverables:**
- `docs/design-hosting/sections/04-deployment-cicd.md` (23KB specification)
- `docs/design-hosting/diagrams/04-deployment-topology.excalidraw` (visual 5-layer architecture)
- Phased migration plan with rollback procedures
- Cost models for 3 user scenarios
- Security checklist for deployment readiness

**Next Actions:**
- Keaton (Lead) to approve recommended topology
- Rabin (Security) to review secrets management strategy
- Fenster + Hockney to validate CI/CD workflow specs and prepare implementation
- Full team to review migration plan before Phase 1 cutover

### Deployability Review (2026-05-01)

**Task:** Sanity-check the unified design (design.md) synthesizing all sections for deployability.

**Findings Summary:**
- ✅ **APPROVED WITH CONDITIONS** — No deployment recommendations lost in synthesis.
- ✅ CI/CD pipeline ordering is correct: migrations before frontend deploy.
- ✅ Secrets layout sound: public keys in Vercel, service role in GitHub Actions only.
- ✅ Observability pragmatic for scale: Vercel Analytics + Docker stdout Phase 1, optional Better Stack Phase 2.
- ✅ Cost projections realistic: $0–3 solo, $3–15 household, $70–150 for 50 users.

**Issues Found:**
1. 🟡 **Local Docker ↔ Supabase reliability:** Design identifies laptop sleep + dynamic IP risks but lacks explicit retry/restart strategy. Needs FastAPI `pool_pre_ping=True` config + Docker healthcheck + process supervisor guidance.
2. 🟡 **Supabase free-tier pause:** Acknowledged as risk but no documented backup survival strategy during freeze. Needs: verify freeze policy, backup retention, recovery procedure, consider day-one `pg_dump` automation.
3. 🟡 **Connection pooling split:** Design correctly identifies need for both `SUPABASE_DB_DIRECT_URL` (Alembic/batch) and pooled URL (web traffic), but not fully wired in CI/CD sections. Needs GitHub Actions secrets config update.
4. 🟡 **Preview OAuth callback:** Three strategies proposed but none validated against real Supabase/Google behavior. Needs spike in Phase 1 (1–2 hours).
5. 🟡 **CLERK_SECRET_KEY residual:** GitHub Actions secrets table lists Clerk (not in design). Remove as it conflicts with Supabase-only auth choice.
6. 🟢 **Domain/DNS deferred:** Flagged as decision required before Phase 2 (not blocker, but timing matters for OAuth callback URL stability).

**Verification Required (Before Phase 2):**
- Supabase free-tier limits as of 2026-05
- Supabase project freeze + backup recovery behavior
- Google OAuth + preview deploy redirect URI strategy
- FastAPI + SQLModel + PgBouncer connection pooling
- Custom domain plan (affects OAuth config)

**Deliverable:** `docs/design-hosting/reviews/kujan-review.md` — Full detailed review with finding levels, out-of-date risk checklist, and recommendations.

📌 Team update (2026-04-30T15:00:37Z): Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.
