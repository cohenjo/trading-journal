# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z


## Recent Learnings

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Vercel runbook created (2026-05-01):**
- **CLI workflow:** `vercel link` from `apps/frontend/` establishes project binding; `.vercel/project.json` (gitignored) stores org/project IDs; `--cwd apps/frontend` flag needed for monorepo root commands.
- **Environment variable model:** Three targets (production/preview/development) with explicit `NEXT_PUBLIC_` prefix for browser-exposed vars. Critical: `SUPABASE_SERVICE_ROLE_KEY` must NEVER have public prefix to avoid RLS bypass leakage.
- **Preview deploy OAuth gotcha:** Most OAuth providers (including Google) don't support wildcard redirect URIs. Recommended pattern: static redirect proxy at stable domain (e.g., `https://auth.example.com/callback`) that captures original preview URL in signed state, completes auth, then redirects back. Alternative: per-PR allowlisting via automation (tedious).
- **Hobby plan constraints verified:** 100 GB/month bandwidth hard cap (site pauses on exceed), 120s function timeout, 1M invocation/month, strict no-commercial-use policy. User must confirm personal use or upgrade to Pro.
- **DNS records confirmed:** Apex domain A record → `76.76.21.21` (Vercel's anycast IP), WWW/subdomains CNAME → `cname.vercel-dns.com`. Let's Encrypt auto-provisions SSL.
- **CI/CD patterns:** Recommended to let Vercel git integration handle deploys; GitHub Actions runs tests/lint only. If GH Actions must control deploy, use `vercel pull` + `vercel build --prod` + `vercel deploy --prebuilt` with VERCEL_TOKEN/ORG_ID/PROJECT_ID secrets.
- **Server Actions + Supabase SSR:** Next.js 15 Server Actions run in Node runtime (Vercel serverless functions) with 120s timeout. Use `createServerClient` + cookies for user-scoped RLS enforcement. Heavy compute (>120s) must offload to local Docker worker via raw_* tables pattern.
- **Rollback + observability:** `vercel rollback <url>` promotes previous deployment. Hobby plan log retention ~1 hour to 1 day (verify current docs). Free webhook notifications to Slack/Discord available.

📌 **Vercel project setup runbook (2026-05-01):** Authored `docs/design-hosting/runbooks/vercel-01-project.md` — covers CLI install/auth, monorepo link (`apps/frontend/`), `vercel.json` with security headers, REST API project creation, env var wiring for all three target envs (production/preview/development), bulk import loop, local dev `.env.local` precedence, GitHub repo connection, and inspect/pull commands. Also added `.vercel` to repo `.gitignore`. ⚠️-flagged: `vercel git connect` interactivity and bulk `<` import unsupported in current CLI — documented loop workaround.

📌 **TJ-005 Supabase migrations (2026-04-30):** Authored 5 migration files under `supabase/migrations/` for GH #58. `130000` adds audit columns (`created_at`, `updated_at`, `deleted_at`) + `tg_update_timestamp()` trigger to 14 tables (12 household + 2 owner-private). `130100` adds `household_id` FK + index to 12 household tables. `130200` adds `owner_user_id` FK + index to `note` and `backtestrun`. `130300` is a sketch-only file deferring `trading_account_config` split to user decision (options A/B/C documented). `130400` is a destructive migration retiring `public.user` to `public.user_legacy` — awaiting auth migration sign-off. Cross-verified all table names against SQLAlchemy models; found 3 tables with pre-existing audit columns (guarded with IF NOT EXISTS). Two user decisions remain open: trading_account_config split strategy and timing of user table retirement. Follow-up comment posted on GH #58.
## Learnings

- Team initialized with shared focus on financial data integrity, security, and maintainable AI-assisted workflows.
### 2026-07: TJ-019 — Vercel Project Config + Setup Runbook (GH #72)

**Deliverables:** Created `apps/frontend/vercel.json` (framework, buildCommand, security headers, `preferredRegion: fra1` via functions config), `apps/frontend/.vercelignore`, updated `apps/frontend/next.config.ts` (added `images.remotePatterns` for Supabase CDN), and runbooks `vercel-04-project-link-and-env.md` + `vercel-05-deployment-flow.md`.
**Key decisions:** Used `functions.preferredRegion` instead of top-level `regions` (Hobby-incompatible per vercel-01); `SUPABASE_SERVICE_ROLE_KEY` scoped Production-only; `experimental.serverActions` not added (stable in Next.js 15); CSP header allows `*.supabase.co` for storage CDN and WebSocket realtime.
**User actions required:** Run `vercel login` + `vercel link` from `apps/frontend/`, add env vars via `vercel env add` per runbook §2, and assign custom domain via `vercel domains add`.
**Branch:** `squad/72-vercel-project-setup`
**PR:** Closes #72

### 2026-07: TJ-017 — Backend Supabase JWT Validation Middleware (GH #70)

**Deliverables:**
- `apps/backend/app/supabase_auth.py` — Core JWT validation: `SupabaseAuthSettings` (pydantic-settings), `JWKSCache` (async-safe, TTL, rotation), `SupabaseClaims`, `verify_supabase_jwt()`
- `apps/backend/app/dependencies.py` — FastAPI dep providers: `get_current_user`, `get_current_user_id`, `require_role()`
- `apps/backend/main.py` — Startup JWKS warm-up + `/health/auth` diagnostics endpoint
- `apps/backend/tests/test_supabase_auth.py` — 13 async unit tests (respx-mocked JWKS, real RSA keypairs)
- `apps/backend/README-supabase-auth.md` — Usage guide, env vars, migration plan
- `apps/backend/pyproject.toml` — Added `pydantic-settings>=2.7.0`, `pydantic[email]`, `respx>=0.21.0` (dev)

**Key decisions:**
- JWKS (RS256/ES256) is preferred path; HS256 secret fallback only on JWKS network failure
- `SUPABASE_URL` is canonical backend env var; `NEXT_PUBLIC_SUPABASE_URL` accepted as alias
- `SecretStr` for JWT secret — never logged; auth failures audit-logged at WARNING
- Existing `app/auth/` (local-user JWT) intentionally NOT removed — future cutover ticket
- Runtime dependency on PR #85 (auth.users table), not build-time

**Branch:** `squad/70-backend-jwt-validation`
**PR:** Closes #70

## Learnings

### 2026-05-01: Backend Endpoint Disposition Audit (TJ-006)

**Context:** Phase 3 migration requires classifying every backend endpoint as MOVE (Supabase direct), KEEP (heavy/batch), or DEPRECATE (replaced by Supabase Auth or obsolete).

**Audit results:**
- **67 total endpoints** across 19 routers
- **32 MOVE** — simple CRUD on single tables with household scoping
- **28 KEEP** — heavy compute (backtests, projections, AI analysis), third-party APIs (yfinance, IBKR), multi-table joins with complex business logic
- **7 DEPRECATE** — auth.py (replaced by Supabase Auth), options.py (XLSX storage deprecated), trading.py config endpoints (should use env vars/vault)

**Cross-cutting concerns identified:**
1. **Household ID injection:** 14 routers use `get_user_household_id(session, user_id)` pattern. MOVE candidates need RLS policies + Server Action household context. Medium-High migration complexity.
2. **Mixed routers:** 5 routers (analyze, dividends, finances, ndx, trading) have both MOVE + KEEP endpoints. Requires careful frontend routing to split calls during migration.
3. **JSON field mutations:** pension and dividend_accounts endpoints mutate `finance_snapshot.data` JSONB field. PostgREST supports JSONB operators but adds complexity.

**Disposition criteria refined:**
- **MOVE:** Single-table CRUD, simple queries, no external API, no multi-step transactions beyond RLS+triggers.
- **KEEP:** Backtests, projections, AI analysis (Copilot SDK), third-party API calls (yfinance, IBKR), CPU/memory-intensive work, multi-table joins with aggregation.
- **DEPRECATE:** Replaced by Supabase Auth, obsolete storage patterns (XLSX), config that should be env vars.

**Migration phasing:**
- **Phase 3A (1-2 weeks):** 20 low-hanging fruit endpoints (holdings, insurance, plans CRUD, summary, simple finances/dividends CRUD)
- **Phase 3B (1 week):** 5 partial migration endpoints (dividend_accounts list/create, backtest GET /years)
- **Phase 3C (2-3 weeks, defer):** 5 complex candidates (trades POST with summary recalc, day multi-table join, pension reports)
- **Phase 4 (ongoing):** 28 heavy/batch endpoints stay in FastAPI as local Docker worker

**Key insight:** Frontend-backend HTTP coupling is symptom of incomplete Phase 3. After MOVE migration, `NEXT_PUBLIC_API_URL` should only route to heavy compute endpoints (analyze, backtest, pension upload, plans simulate, trading sync). No round-trip for CRUD — frontend talks to Supabase directly via RLS.

**Deliverable:** `docs/design-hosting/endpoint-disposition.md` — full audit with per-router tables, complexity ratings, and migration recommendations.
