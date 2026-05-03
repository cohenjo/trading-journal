# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z


## 2026-05-03: Security incident — Supabase key rotation checklist — PR #158

Prepared rotation runbook in response to GitHub secret-scanning alert #1 (service-role key leaked in `.squad/decisions.md`).

**Deliverables:**
- `docs/security/rotation-checklist-2026-05-03.md` — full runbook: project identification, rotation steps for Jony, Vercel/GH Actions/local env update checklist, smoke-test commands
- `.gitignore` — added `!docs/security/` exception to track security runbooks alongside `docs/design-hosting/`

**Key findings:**
- **One** Supabase project visible via MCP: `zvbwgxdgxwgduhhzdwjj` (prod only — no dev/staging)
- **Leaked credentials confirmed in `.squad/decisions.md`** (git-tracked): `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` — flagged for Rabin
- All `.env.example` files clean (placeholder values only)
- `apps/frontend/.env.local` correctly gitignored by both root `.gitignore` (`.env.*`) and `apps/frontend/.gitignore` (`.env*`)
- Vercel CLI not authenticated in this environment — Jony must update env vars via Dashboard

**Parallel tracks:** Rabin (audit/git-history decision) · Kujan (`.gitignore` + pre-commit hardening)

**Smoke test status:** NOT_RUN — awaiting Jony's manual rotation in Supabase Dashboard

## 2026-05-02: E2E test-user provisioning helper (GH #145) — PR #154

Implemented the full E2E provisioning stack on branch `squad/145-test-user-helper`.

**Deliverables:**
- `apps/frontend/e2e/helpers/provision-test-user.ts` — `provisionTestUser()` (ephemeral + shared-user CI modes) + `teardownTestUser()` (FK-aware explicit cleanup via RPC)
- `apps/frontend/e2e/scripts/seed-test-user.ts` — one-shot CLI provisioning script; `--teardown` flag supported. Uses dynamic `await import()` inside `main()` to avoid tsx/CJS hoisting of `SUPABASE_URL` before env is loaded.
- `apps/frontend/e2e/auth/user-lifecycle.spec.ts` — 6 `@auth`-tagged E2E tests (5 pass, 1 skips gracefully without dev server)
- `supabase/migrations/20260502140000_e2e_reset_test_user.sql` — SECURITY DEFINER `e2e_reset_test_user(p_email text)` SQL function; applied to prod Supabase
- Updated `playwright.config.ts` — replaced silent-swallowing `require('dotenv')` try/catch with inline `.env.local` parser (dotenv not installed in this package)
- Updated `apps/frontend/package.json` — added `test:e2e:seed` + `test:e2e:seed:teardown` scripts
- Updated `apps/frontend/e2e/fixtures/test-user.ts` — replaced `deleteE2eUser` with `teardownTestUser` import

**Key schema discoveries:**
- `households` has `created_by` column, NOT `owner_id`
- No FK cascade from `auth.users → household_members`; teardown must explicitly delete household data before deleting the auth user
- `tg_household_members_delete_guard` (BEFORE DELETE) and `tg_household_members_guard` (BEFORE UPDATE) triggers block removing the last active owner row — fires even for service_role
- Fix: `SET LOCAL session_replication_role = replica` inside SECURITY DEFINER function disables non-ALWAYS triggers for the current transaction

**CI env vars required:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_E2E_ALLOW_PROD=true` (project ref `zvbwgxdgxwgduhhzdwjj` has no dev hint in URL). Optional shared-user mode: `E2E_TEST_USER_EMAIL` + `E2E_TEST_USER_PASSWORD`.

**Seed verified live:** user `e2e+playwright@trading-journal.test` + household created in <2s against real Supabase.

## 2026-05-02: Prod migration verify + unblock — migration was NOT applied; applied now + backfill ran + EXECUTE revoked

Migration `20260502120000_auto_provision_household_on_signup` was absent from prod Supabase (last applied was `20260501022922`). Applied via MCP `apply_migration` (trigger function + backfill). Backfill created households for all existing users without one (including Jony). Security advisor flagged `handle_new_user_household()` callable by `anon`/`authenticated` — immediately revoked EXECUTE on both roles via `execute_sql`. Also added REVOKE to migration file on disk. Issue #145 (E2E test-user provisioning helper) is queued for next session.

## Recent Learnings

📌 **Household auto-provisioning gap (2026-05-02):** When the finances POST flow migrated from FastAPI to a Next.js Server Action (PR #140), the household provisioning that the Python layer had been doing implicitly was silently dropped. `resolveHouseholdId()` returned null because no `household_members` row existed for users who signed up via Supabase Auth directly. Fix: `supabase/migrations/20260502120000_auto_provision_household_on_signup.sql` — adds `trg_auth_users_create_household` AFTER INSERT trigger on `auth.users` (SECURITY DEFINER, same pattern as `trg_auth_users_create_profile` in migration 20260430130400) + idempotent backfill. Lesson: every DB-level invariant (household membership, profile existence) must live in a trigger, not application code, once the application layer is no longer the sole write path.

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

---

📌 **Migration dry-run fix (2026-05-02):** Backfill section of `supabase/migrations/20260502120000_auto_provision_household_on_signup.sql` was referencing `auth.users.raw_user_meta_data` (Supabase-hosted column only), causing shadow DB CI dry-run to fail. Simplified backfill CTE to use only standard columns: `coalesce(u.email, 'My Household')`. Trigger function keeps full `raw_user_meta_data` fallback chain since it fires on real auth.users in production. Lesson: shadow DB does not expose `auth.users.raw_user_meta_data`; backfill migrations must use only standard Postgres columns (id, email, etc.).

📌 Team update (2026-05-02T09:03:04Z): Household provisioning (PR #142) — trigger chain caveat. trg_households_add_creator (existing) already inserts household_members owner row; don't re-insert in upstream `handle_new_user_household()` or backfill (causes constraint violations). Document trigger ownership: each trigger owns one side effect, never duplicate. — Coordinator
