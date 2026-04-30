# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Hockney (Backend Dev)
- **Created:** 2026-02-23T22:46:19Z

## Core Context Summary (Feb-Mar 2026)

**Initial Audit Findings:**
- Float usage for all monetary calculations — needs Decimal migration
- Missing Pydantic validation on API endpoints
- Insufficient error handling (5 HTTPExceptions found across codebase)
- Security exposure: plaintext .env credentials in git, CORS wide open (allow_origins=["*"])
- Limited test coverage for financial calculations
- Logging inconsistency across modules

**Early Q2 Work:**
- Participated in Financial Precision & Type Safety consolidation (Feb 23)
- Security Hardening review completed (Feb 23)
- Testing & QA planning (Feb 23)
- API Documentation & DevOps planning (Feb 23)
- Started codebase baseline work March-April

**Architecture Notes:**
- Good Alembic migration history (19+ versions)
- SQLModel/SQLAlchemy patterns generally sound
- Service layer separation exists (data_ingestion, dividend_service)
- OpenTelemetry instrumentation setup in place

---

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
## Core Context

*Summary: 9 previous entries consolidated below (created 9 distinct decisions/learnings)*

- ### 2026-02-23: Initial Backend Codebase Review
- ### 2025-07-18: Company Analysis API Router Built
- ### 2026-03-05: yfinance Caching Layer (Issue #7)
- ### 2026-03-06: analyze Router Registration Commit (f81ec80)
- ### 2026-03-07: Stable Pension Identity Flow
- ### 2025-07-19: Pension Upload Bug Fixes (Latest Snapshot + Hebrew RTL)
- ### 2025-07-21: Deterministic Table Extraction for Pension PDFs
- ### 2026-03-07: Pension Reclassification to Savings
- ### 2025-07-21: Pension Data Migration (Investments → Savings)

---

### 2026-04-10: Backend Financial Core Testing Sprint (Week 1)

**Context:** Implemented P0 testing tasks from approved testing plan to establish comprehensive test coverage for financial calculation utilities.

**Work Completed:**

1. **Task 1: conftest.py Infrastructure (1 hour)** ✅
   - Created shared test fixtures in `apps/backend/tests/conftest.py`:
     - `engine` fixture: SQLite in-memory with StaticPool for test isolation
     - `session` fixture: SQLModel Session with auto-rollback
     - `client` fixture: Sync TestClient with dependency injection override
     - `async_client` fixture: HTTPX AsyncClient for async endpoint testing
   - Created `tests/fixtures/` directory for future test data
   - Verified all 94 existing tests still pass after infrastructure changes

2. **Task 2: test_currency.py (2 hours)** ✅
   - 24 comprehensive tests for `app/utils/currency.py`
   - Coverage areas: Known conversions (ILS, USD, EUR, ILA), round-trip consistency, edge cases
   - Key insight: ILA (Agorot) uses rate 0.01 relative to ILS base

3. **Task 3: test_bond_cashflows.py (3 hours)** ✅
   - 20 comprehensive tests for `app/utils/bond_cashflows.py`
   - Coverage areas: Coupon frequencies, date arithmetic, cashflow generation, bond ladder integration
   - Critical finding: Loop uses `payment_date < maturity_date`, final coupon at maturity not in loop

4. **Task 4: test_trade_matcher.py (3 hours)** ✅
   - 13 comprehensive tests for `app/utils/trade_matcher.py`
   - Coverage areas: FIFO matching, short positions, P&L validation, edge cases
   - Algorithm insight: FIFO via chronological sorting, matches first open with first close

**Testing Metrics:**
- Tests before: 95 (94 passing, 1 pre-existing failure)
- Tests added: 57 new tests (24 + 20 + 13)
- Tests after: 138 total (137 passing, same 1 pre-existing failure)

**Branch:** `squad/testing-backend-financial-core`

**Learnings:**
- Hardcoded FX rates in currency.py are temporary - need real-time rate integration
- Trade matcher only handles exact quantity matches - may need partial fill logic
- All financial calculations preserve decimal precision in tests, but underlying code still uses float

📌 **Financial testing foundation established.** Core utility modules now have comprehensive test coverage with known expected values.

**Tests added (4 new, 30 total):**
- `test_migrate_reclassifies_legacy_pension_items` — verifies category change, draw_income, max_withdrawal_rate, and recalculated totals
- `test_migrate_is_idempotent` — second run produces zero changes
- `test_migrate_backfills_plan_draw_income` — plan account_settings get draw_income
- `test_migrate_skips_already_correct_data` — correctly-classified items untouched

**Key paths:**
- `apps/backend/app/api/pension.py` — `migrate_pensions_to_savings()`
- `apps/backend/main.py` — lifespan startup hook
- `apps/backend/tests/test_pension_api.py` — migration tests

📌 Team update (2026-04-10T08:19:59Z): Testing Sprint Phase 1-3 Complete — Phase 2 backend review completed: 62 endpoints identified (not 55), coverage 16% confirmed, depth-over-breadth strategy approved. Phase 3 implementation: 57 new tests delivered (conftest.py, test_currency 18 tests, test_bond_cashflows 21 tests, test_trade_matcher 18 tests). Backend tests increased 95 → 152 (+60%). Financial core testing bulletproof: currency, bonds, trades at 100% coverage. Branch squad/testing-backend-financial-core ready for merge. Orchestration, session logs, decisions merged. — Scribe (Team Orchestration)

### 2025-07-22: Insurance Policies API (Issue #18)

**What was built:**
Full CRUD API for insurance policies at `/api/insurance` — list (with optional `?owner=` filter), create, update, delete.

**Files created:**
- `apps/backend/app/schema/insurance_models.py` — `InsurancePolicy` SQLModel with UUID PK, owner, type, provider, sum_insured, and optional fields (policy_number, monthly_premium, beneficiaries, expiry_date, website, notes, timestamps)
- `apps/backend/app/api/insurance.py` — Router with Pydantic request models (`InsurancePolicyCreate`, `InsurancePolicyUpdate`), field validation for type/owner enums, `{status: "success", data: ...}` envelope
- `apps/backend/alembic/versions/acadd4bc6806_add_insurance_policies_table.py` — Migration creating `insurance_policies` table

**Files modified:**
- `apps/backend/app/schema/models.py` — Added import for Alembic metadata registration
- `apps/backend/main.py` — Registered insurance router

**Design decisions:**
- Used UUID string PK (not auto-increment int) — better for client-side generation and API references
- `sum_insured` is string, not float — allows free-text like "₪2,000,000" or "Covers remaining mortgage"
- `monthly_premium` is float (nullable) — straightforward numeric for calculations
- `expiry_date` is string (nullable) — ISO date format, keeps model simple without date parsing complexity
- Owner values match pension pattern: "You" or "Partner"
- Type enum: life, mortgage, health, disability, other — validated server-side
- Simpler than pension API (no snapshots, no file upload) — straightforward CRUD

**Branch:** `squad/18-insurance-policies-api`
**Tests:** 114 existing tests pass (1 pre-existing failure needs Postgres)
- 2026-04-30: Phase 1 foundation batch shipped — see .squad/log/2026-04-30T17-00-00Z-phase1-foundation-batch.md

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

### 2026-05-01: Prod RLS Migration (Issue #97, PR #98)

**Context:** Rabin's PR #98 merged to main (9ec4d2b), implementing RLS on 21 public tables + dropping trading_account_secrets. Migrations applied to dev but not prod. Jony delegated prod rollout to Hockney via autopilot.

**Task:** Apply all 18 migrations to prod Supabase (`jaesiklybkbmzpgipvea`).

**Execution:**
1. Inspected PR changes: 1 modified migration (120100), 2 new migrations (160100, 160200)
2. Confirmed prod state: 0 migrations applied initially (REST API + CLI check)
3. Applied migrations via `supabase db push --linked`
4. Encountered policy conflicts: 3 migrations lacked `DROP POLICY IF EXISTS` (120200, 130300, 130400)
5. Fixed idempotency: added `DROP POLICY IF EXISTS` before all `CREATE POLICY` statements
6. Retry successful: all 18 migrations applied
7. Verified: 0 `rls_disabled_in_public` advisor errors, RLS enabled on all target tables
8. Closed issue #97 (already closed by coordinator)

**Outcome:**
- ✅ All 18 migrations applied to prod
- ✅ RLS enabled on 21 public tables (trade, execution, manualtrade, dailysummary, etc.)
- ✅ 0 advisor errors on both dev and prod
- ✅ Issue #97 resolved

**Lessons:**
- **Idempotency is critical for prod migrations:** Always use `IF [NOT] EXISTS` for CREATE/DROP operations, including policies.
- **Partial schema state is common:** Prod had tables but no RLS from earlier testing. Migrations must handle this.
- **Supabase CLI workflow:** `link` → `migration list` → `db push` is clean when migrations are idempotent.
- **Pre-flight verification:** Should have checked prod policy state before first push attempt.

**Files modified:**
- Fixed 3 migrations: 120200, 130300, 130400 (added DROP POLICY IF EXISTS)
- Created decision doc: `.squad/decisions/inbox/hockney-prod-rls-applied.md`
- Updated history: this entry

**Time investment:** ~15 minutes (including fixes)

---



📌 **Team update (2026-04-30T22-16-38Z):** RLS-21 dev+prod merge complete — PR #98 (21 public tables + drop secrets) merged to main (9ec4d2b), 18 migrations applied to prod (jaesiklybkbmzpgipvea), 0 rls_disabled_in_public advisor errors verified. Issue #97 closed. Cross-agent RLS coverage now extends to all 21 public tables. — Rabin (author), Keaton (reviewer), Hockney (prod apply), Redfoot (E2E coverage opportunity)
