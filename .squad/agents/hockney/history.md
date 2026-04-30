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
