# Hosting Design: Trading Journal

**Status:** Recommended — revised after Rabin/Redfoot/Kujan reviews  
**Author:** Keaton (Lead), revised by Hockney under reviewer-rejection protocol  
**Date:** 2026-05-01

---

## 1. Executive Summary

**The question:** How do we move the trading journal from a laptop-only Docker setup to a hosted service that Jony and his spouse can access from any browser, cheaply and securely?

**The answer:** Deploy the Next.js frontend on **Vercel**, use **Supabase** for Postgres + Auth (Google OAuth, Row Level Security), and keep the existing FastAPI/Python code as a **local Docker worker** that writes raw/compute/cooked tables. The UI reads household-scoped cooked tables through RLS. No always-on backend service is needed initially — CRUD goes through Next.js Server Actions, and heavy compute stays on Jony's machine. This is Hockney's "Hybrid (Option C)" architecture.

**Cost:** $0–3/month for solo use; $3–15/month for up to 5 household members; $70–150/month only if the app reaches 50 active users.

**Migration shape:** Four phases over 4–6 weeks. Phase 1 cuts over the database to Supabase and backfills household ownership columns. Phase 2 deploys the frontend to Vercel with Supabase Auth. Phase 3 migrates CRUD endpoints from FastAPI to Server Actions one-by-one. Phase 4 operationalizes local Docker workers and optional GitHub Actions cron jobs. Each phase has an independent rollback path.

---

## 2. Goals & Non-goals

### Goals

- Host the app on free or very-low-cost services so it's accessible from any browser.
- Support a small trusted audience: Jony + spouse, possibly a few invited people.
- Use Supabase for managed Postgres, RLS-backed authorization, and Google OAuth.
- Use Vercel for the Next.js frontend (best Next.js compatibility, preview deploys).
- Implement couples/household data sharing as a first-class auth concept.
- Keep heavy compute (backtests, broker sync, PDF parsing) local in Docker.
- Keep the migration reversible, cheap, and understandable.

### Non-goals

- Do not build a multi-tenant SaaS for public users in this phase.
- Do not resume IBKR integration as part of this work.
- Do not move heavy compute to cloud unless local Docker becomes painful.
- Do not require paid infrastructure before the app has real shared usage.
- Do not redesign every backend model — change only what's needed for hosted auth and sharing.

---

## 3. Recommended Architecture

![System Context](diagrams/01-system-context.excalidraw)

> **Note:** `.excalidraw` files open in [excalidraw.com](https://excalidraw.com) or the VS Code Excalidraw extension.

### Stack summary

| Layer | Technology | Runtime |
|---|---|---|
| Frontend | Next.js 15 App Router | Vercel (free tier) |
| Auth | Supabase Auth + Google OAuth | Supabase managed |
| Database | Supabase Postgres + RLS | Supabase managed |
| CRUD API | Next.js Server Actions | Vercel (same deploy) |
| Heavy compute | FastAPI + Python workers | Local Docker → Supabase |
| CI/CD | GitHub Actions + Vercel git integration | GitHub-hosted runners |
| Observability | Vercel Analytics + Supabase Logs + stdout | Free tier |

![Deployment Topology](diagrams/04-deployment-topology.excalidraw)

**Key architectural decision:** We adopt Hockney's **Hybrid (Option C)** as the single recommended path. Keaton's original Section 01 presented "Option A (Lean)" vs "Option B (Decoupled API)" as equal choices. The hybrid resolves this: the frontend talks directly to Supabase for CRUD (like Option A), while FastAPI continues to run heavy compute and integrations (preserving Option B's strengths). FastAPI is **not** hosted as a public API service initially — it runs as a local Docker worker writing to Supabase.

---

## 4. Component-by-component

### 4.1 Frontend (Vercel + Next.js 15)

- Vercel project root at `apps/frontend`; no custom adapter needed for Next.js 15.
- Use `@supabase/ssr` with `createBrowserClient` / `createServerClient` split; middleware refreshes sessions per request.
- Server Actions replace FastAPI for CRUD: manual trades, plans, insurance, dividends, finance snapshots.
- Default to Node runtime; use Edge only for `middleware.ts` session refresh.
- Auth-protected pages must use dynamic rendering (`dynamic = 'force-dynamic'` / no caching) and no public ISR for household data.
- Preview deploy OAuth: register one stable callback URL; do not rely on `*.vercel.app` wildcards.
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public); server-only secrets are never `NEXT_PUBLIC_`. Server Actions use user-scoped SSR clients by default, not service-role clients.
- Phase down `NEXT_PUBLIC_API_URL` as CRUD moves off FastAPI.

> See full section: [02 — Frontend Strategy](sections/02-frontend-strategy.md)

### 4.2 Auth & Security

- Supabase Auth with Google OAuth; replace existing `python-jose` / `passlib` JWT flow.
- Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`; no tokens in `localStorage`.
- Middleware validates/refreshes session; redirects unauthenticated users to `/signin`.
- Household sharing via `household_members` table with `owner` / `member` / `viewer` roles.
- Invite flow: owner sends email → signed single-use token → spouse signs in with Google → accept endpoint verifies token hash + email match → inserts membership.
- CSRF: no state changes over GET; check `Origin` header; CSRF tokens on Server Actions.
- FastAPI (if retained) verifies Supabase JWTs via JWKS endpoint; stops minting its own tokens.

> See full section: [03 — Auth, Sharing & Security](sections/03-auth-sharing-security.md)

### 4.3 Database (Supabase Postgres)

- Supabase free tier: assume 500 MB storage / low connection limits only until checked. Backups, pausing, and retention are plan-dependent.
- > ⚠️ User to verify against current Supabase docs: pricing limits, project pause behavior, backup retention during pause, and restore procedure before Phase 1 cutover.
- Add `household_id` to all family-financial tables; `owner_user_id` for personal-only tables (notes, backtests).
- Three logical schemas: `raw` (source facts), `compute` (job intermediates), `cooked` (UI read models).
- RLS enforced on all tables via `is_household_member(household_id)` helper function pattern.
- Global market/reference data (bars, tickers) readable by all authenticated users, writable only by service role.
- Backfill migration: create one personal household, stamp all existing rows, then add NOT NULL constraints.
- `numeric(18, 6)` for all monetary columns.

> See full section: [06 — Data Architecture](sections/06-data-architecture.md)

### 4.4 Backend / Heavy Compute

- FastAPI stops being the default path for every screen. It becomes a **worker** for: broker sync, PDF parsing, backtests, market-data jobs, options analytics.
- Workers run locally in Docker, connect to Supabase Postgres over TLS, and write `raw_*` → `compute_*` → `cooked_*` tables.
- `compute_runs` table tracks job `queued/running/succeeded/failed` status.
- ~20 CRUD endpoints move to Server Actions; ~10 compute/integration endpoints stay in FastAPI.
- Connection pooling: use PgBouncer transaction-mode pool URL for short-lived web traffic; use direct connection for Alembic and batch jobs. For SQLAlchemy/psycopg, set `pool_pre_ping=True`, connection timeouts, and `statement_cache_size=0` on pooled connections.

> See full section: [05 — Backend Strategy](sections/05-backend-strategy.md)

### 4.5 CI/CD & Deployment

- **PR validation:** frontend lint/typecheck/test + backend lint/typecheck/test + Docker build validation.
- **Main merge:** Vercel auto-deploys frontend; GitHub Actions runs `alembic upgrade head` against Supabase; optional backend container push to GHCR.
- **Nightly cron:** database maintenance, optional market-data refresh, stale cooked-table checks.
- Secrets in GitHub Actions secrets; Vercel dashboard for frontend env vars; never in committed files.

> See full section: [04 — Deployment & CI/CD](sections/04-deployment-cicd.md)

### 4.6 Observability

- **Phase 1 (free):** Vercel Analytics, Supabase Logs UI, Docker stdout, `compute_runs`, `household_refresh_state`, and owner-visible failure banners.
- **Phase 2 (optional):** Better Stack ($10/mo) for centralized logging; OpenTelemetry + Grafana Cloud if tracing needed.
- Cooked-refresh failures notify the household owner via email first, then a GitHub Actions summary / issue for unattended nightly failures.

---

## 5. Auth & Sharing

![Auth UX Flow](diagrams/02-auth-ux-flow.excalidraw)

### Household model

The app's existing "couples/shared" concept becomes a first-class **household** entity. Every family-financial row belongs to a household. Users join households through invites.

**Core tables:**

```sql
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create type public.household_role as enum ('owner', 'member', 'viewer');

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'viewer',
  invited_by uuid references auth.users(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (household_id, user_id)
);
```

### Invite flow

![Auth Sharing Flow](diagrams/03-auth-sharing-flow.excalidraw)

```sql
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email citext not null,
  role public.household_role not null default 'viewer',
  token_hash text not null,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint household_invites_role_not_owner check (role in ('member', 'viewer'))
);
```

1. Owner opens Settings → Household sharing and enters spouse email + role (`member` or `viewer`).
2. App creates a `household_invites` row with normalized `citext` email, hashed high-entropy single-use token, 7-day expiry, and audit fields.
3. Email sent (Supabase magic link if it can safely carry household context; otherwise custom signed link).
4. Spouse clicks link, signs in with the same verified email.
5. Accept endpoint verifies: token hash matches, not expired/revoked/accepted, email matches, household not deleted, user is not already an active member, and role is not `owner`.
6. Inserts `household_members` row and marks invite accepted — in one transaction.

Invite controls: owners can revoke pending invites; creation/acceptance is rate-limited; responses never reveal whether an email has an account; invite/accept/revoke events go to the audit trail. Reciprocal or duplicate invites are collapsed transactionally by `(household_id, email, accepted_at is null, revoked_at is null)` plus an accept-time check for existing membership.

### Household lifecycle and audit

- At least one active `owner` must remain in every non-deleted household.
- Leaving/removing a member sets `left_at`; it does not delete membership or user-authored shared rows.
- Owner-only endpoints handle invite revocation, role changes, member removal, restore, and hard delete. Role changes/removals run in a transaction and re-check the acting user's active owner role immediately before commit.
- Divorce/breakup offboarding: removed users immediately lose read/write/restore access; shared financial rows remain visible to active household members with `created_by`/`updated_by` retained for audit; private rows remain user-private or are exported/deleted per user request.
- Audit table records invites, accepts, revokes, role changes, removals/leaves, imports, soft/hard deletes, restores, and privileged worker/service-role actions. Financial data and tokens are redacted from logs.

### RLS pattern

All household-scoped tables use Rabin's corrected helper shape as the canonical migration starting point:

```sql
create or replace function public.household_role_for(hid uuid)
returns public.household_role
language sql
stable
security definer
set search_path = public
as $$
  select hm.role
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.household_id = hid
    and hm.user_id = auth.uid()
    and hm.left_at is null
    and h.deleted_at is null
  limit 1;
$$;

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.household_role_for(hid) is not null; $$;

create or replace function public.can_write_household(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.household_role_for(hid) in ('owner', 'member'); $$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select public.household_role_for(hid) = 'owner'; $$;

revoke all on function public.household_role_for(uuid) from public;
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.can_write_household(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.household_role_for(uuid) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.can_write_household(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

alter table public.trades enable row level security;
alter table public.trades force row level security;

create policy trades_select_active_household_members
on public.trades for select to authenticated
using (deleted_at is null and public.is_household_member(household_id));

create policy trades_insert_writers
on public.trades for insert to authenticated
with check (
  public.can_write_household(household_id)
  and created_by = auth.uid()
  and deleted_at is null
);

create policy trades_update_writers
on public.trades for update to authenticated
using (deleted_at is null and public.can_write_household(household_id))
with check (public.can_write_household(household_id));

create policy trades_select_deleted_for_owners
on public.trades for select to authenticated
using (deleted_at is not null and public.is_household_owner(household_id));
```

Add triggers/column grants so clients cannot mutate `household_id`, `created_by`, or audit fields after insert. FastAPI transitional endpoints must validate Supabase JWT signature, issuer, audience, expiry, and UUID `sub` before forwarding user-scoped work.

---

## 6. Data Architecture

![Data Flow](diagrams/05-data-flow.excalidraw)

![Data Model](diagrams/06-data-model.excalidraw)

### Raw → Compute → Cooked layering

| Layer | Purpose | Writer | Reader | Examples |
|---|---|---|---|---|
| `raw.*` | Source-shaped facts, minimal transformation | Local Docker workers, file imports | Workers (for compute); audit screens | `raw_trades_import`, `raw_market_data`, `raw_broker_statement` |
| `compute.*` | Intermediate job results, partitioned by `run_id` | Local Docker workers | Workers (for cooked publish); debug screens | `compute_pnl_daily`, `compute_trade_matches`, `compute_pnl_runs` |
| `cooked.*` | Denormalized, RLS-protected UI read models | Workers (after successful run) | Frontend Server Actions / Supabase client | `cooked_pnl_summary`, `cooked_position_snapshot`, `cooked_planning_dashboard` |

**Refresh strategy:** Raw writes happen immediately. Compute runs asynchronously (local Docker). Cooked rows publish only on success. A public-RLS-readable `household_refresh_state` table tracks dirty domains so the UI can show fresh, refreshing, stale, and failed states.

**Cooked correctness:** Every publish stores `refreshed_at`, `source_run_id`, status, and reconciliation totals. Pytest/SQL assertions compare raw → compute → cooked totals for P&L, positions, and planning dashboards using exact `numeric`/`Decimal` expectations before the run can mark `succeeded`.

**Backups:** Managed backups are plan-dependent; use a local encrypted `pg_dump` offload cron from Phase 1, restore it into local Docker Postgres monthly, and never commit dumps. > ⚠️ User to verify against current Supabase docs: free-tier pause and backup-retention guarantees.

---

## 7. Alternatives Considered

| Layer | Option | Free tier | Pros | Cons | Verdict |
|---|---|---|---|---|---|
| **Frontend** | Vercel | 100 GB egress/mo | Best Next.js fit; preview deploys; low ops | Hobby limits; vendor lock-in | **✅ Recommended** |
| Frontend | Netlify | 300 min build/mo | Good static hosting; generous builds | Less integrated Next.js support | Viable fallback |
| Frontend | Cloudflare Pages | 500 builds/mo; unlimited egress | Great edge network; cheap | SSR adapter friction for Next.js | Consider later |
| **DB + Auth** | Supabase | 500 MB; 50k+ auth users | Postgres + Auth + RLS in one product | RLS design critical; free-tier limits | **✅ Recommended** |
| DB + Auth | Neon + Clerk | 0.5 GB; 10k MAU | Decoupled; polished auth UX | Two vendors; Clerk Pro costly ($99/mo) | Good alternative, not first choice |
| DB + Auth | Neon + Auth.js | 0.5 GB; self-managed auth | Low lock-in; flexible | More custom auth/RLS plumbing | Consider if Supabase blocks workflow |
| **Backend** | Hybrid (Option C) | N/A (local Docker) | Low cost; preserves Python investment; gradual migration | Boundary discipline required | **✅ Recommended** |
| Backend | Frontend-direct (A) | $0 | Lowest ops; fastest CRUD | High RLS dependency; can't run Python | Good for CRUD portion only |
| Backend | Hosted FastAPI (B) | Fly $0–3; Render $0 | Preserves all backend code | Extra service; free-tier sleeping | Not needed initially |
| **API host** | Fly.io | 3 shared-CPU instances | Global; good for stateless APIs | Costs grow with traffic | **Best if backend hosting needed later** |
| API host | Render | 750 hrs/mo; sleep after 15m | Simple; auto-deploy | Sleep breaks long requests | Simpler fallback |
| API host | Cloud Run | 2M req/mo; 360k GB-sec | Serverless; per-request billing | ~2s cold start; GCP setup complexity | Consider for batch jobs |
| **Compute** | Local Docker | Unlimited | Already works; no cost | Laptop availability | **✅ Recommended now** |
| Compute | GitHub Actions cron | 2,000 min/mo | Observable; easy secrets | 6h limit; delayed schedules | Good for small periodic jobs |

---

## 8. Cost Profile

### Scenario 1: Solo developer (0 shared users)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel | $0 | Free tier; <5 GB egress typical |
| Supabase | $0 | Free tier; 500 MB storage |
| Fly.io (if used) | $0–3 | 3 shared-CPU free; likely unused |
| GitHub Actions | $0 | ~50 min/month cron |
| **Total** | **$0–3** | |

### Scenario 2: Household (5 users)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel | $0–5 | Free tier sufficient |
| Supabase | $0–10 | Free tier; upgrade to Pro ($25) if near 500 MB |
| Fly.io (if used) | $3–15 | Shared instances; dedicated ~$7/mo |
| GitHub Actions | $0–2 | ~100 min/month |
| **Total** | **$3–15** | Most components stay on free tier |

### Scenario 3: Small community (50 users)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel | $20 | Standard tier |
| Supabase | $25–50 | Pro or Team tier |
| Fly.io | $15–50 | Autoscaling instances |
| GitHub Actions | $0–5 | Slight overages possible |
| Observability | $10–50 | Better Stack or Grafana Cloud |
| **Total** | **$70–150** | |

**First paid trigger:** Supabase storage exceeding 500 MB or needing >2 concurrent connections pushes to Pro ($25/mo).

> ⚠️ User to verify against current Supabase docs: free-tier limits, inactivity pause behavior, and whether backups survive a paused project. Until verified, keep the Phase 1 encrypted `pg_dump` cron enabled. Monitor Vercel egress weekly after launch and consider Pro if usage approaches 80 GB/month.

---

## 9. Migration Plan

### Phase 0 — Validate & Freeze (Week 1–2)

**Entry:** Current local Docker setup works.  
**Work:**
1. Full local test suite green: `docker-compose up --build`, CI passes.
2. Decide table ownership: UI-owned OLTP vs. worker-owned raw/compute/cooked vs. shared reference.
3. Add `household_id` / `owner_user_id` columns and audit fields via Alembic migration against local Postgres.
4. Create `compute_runs` job-status table.
5. Validate financial totals match before and after column additions.

**Exit:** All existing tests pass with new columns; backfill migration script tested locally.  
**Rollback:** Revert Alembic migration (`alembic downgrade -1`); local Postgres unchanged.

### Phase 1 — Database Cutover (Week 3)

**Entry:** Phase 0 complete; Supabase project created.  
**Work:**
1. Create separate Supabase projects for local/dev, preview, and production; CI fails if preview env vars point at production project refs.
2. Drain/disable local workers, acquire a Postgres advisory migration lock, then run Alembic against Supabase using the **direct** connection URL (not PgBouncer).
3. Load sanitized snapshot from local Postgres; validate row counts and financial totals.
4. Create `raw`, `compute`, `cooked` schemas and initial tables.
5. Enable RLS policies (household + owner-private + global patterns).
6. Point local FastAPI `DATABASE_URL` at Supabase; smoke-test existing endpoints with `pool_pre_ping=True`, timeouts, and direct-vs-pooled URL checks.
7. Create personal household for Jony; backfill `household_id` on all rows.

**Exit:** Local app reads/writes Supabase; RLS policies enforce household isolation.  
**Rollback:** Revert `DATABASE_URL` to local Postgres; local data is the snapshot source.

### Phase 2 — Frontend to Vercel + Supabase Auth (Week 4)

**Entry:** Phase 1 complete; database on Supabase.  
**Work:**
1. Add `@supabase/ssr`, `middleware.ts`, Supabase client helpers to frontend.
2. Create `/signin`, `/auth/callback`, `/accept-invite` routes.
3. Configure Google OAuth in Supabase dashboard + Google Cloud Console; run the preview callback spike before production deploy. **Prerequisite:** Jony confirms custom domain plan for stable callback/DNS/SSL.
4. Connect GitHub repo to Vercel; set environment variables.
5. Push to `main`; verify Vercel preview and production deploys. Preview deploys must use preview/dev Supabase only; never production credentials.
6. Replace `python-jose` JWT validation in FastAPI with Supabase JWKS verification (transitional).

**Exit:** Users sign in with Google via Vercel-hosted frontend; RLS enforces data access; preview OAuth callback and preview/prod isolation are proven.  
**Rollback:** Run frontend locally (`npm run dev`); revert to local auth if needed.

### Phase 3 — CRUD Migration (Week 5–6)

**Entry:** Phase 2 complete; auth works end-to-end.  
**Work:**
1. Move read-only dashboard endpoints to cooked views/Server Actions first.
2. Move simple CRUD to Server Actions: plans, insurance, holdings, dividends, finance snapshots, manual trades.
3. For each moved endpoint, add RLS integration tests, then deprecate the FastAPI route.
4. Keep in FastAPI: file uploads, broker sync, backtests, options analytics, market-data jobs.
5. Add job-trigger Server Actions: enqueue `compute_runs` row; worker picks it up.

**Exit:** Frontend no longer calls FastAPI for standard CRUD; FastAPI is compute-only.  
**Rollback:** Re-enable FastAPI routes; point frontend back to `NEXT_PUBLIC_API_URL`.

### Phase 4 — Operationalize Workers (Week 6+)

**Entry:** Phase 3 complete; CRUD is on Server Actions.  
**Work:**
1. Local Docker workers connect to Supabase via TLS using direct Postgres credentials or narrow worker DB roles where feasible; `SUPABASE_SERVICE_ROLE_KEY` is only for Supabase API admin paths and audited maintenance jobs.
2. Add GitHub Actions cron for lightweight refresh jobs (market data, stale-data checks), using minimum required Supabase secrets and never broker desktop/session material.
3. Add stale-data indicators to UI (`refreshed_at` display, "refreshing" spinner, failed banner) and owner email alerts after repeated failures.
4. Add Docker `healthcheck`, `restart: unless-stopped`, exponential DB reconnect/backoff, and idempotent resume for `queued/running` jobs. Consider Fly Machines / Cloud Run Jobs only when local Docker reliability becomes a problem.

**Exit:** Workers run regularly; UI shows fresh cooked data with staleness indicators.  
**Rollback:** Workers are independent; disable cron jobs; cooked data freezes at last successful refresh.

---

## 10. Environment, Secrets & Connection Pooling

Use explicit environment variables so migrations, web traffic, and workers cannot accidentally share the wrong connection mode:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_DB_DIRECT_URL=postgresql://...@db.<ref>.supabase.co:5432/postgres?sslmode=require
SUPABASE_DB_POOL_URL=postgresql://...@aws-0-...pooler.supabase.com:6543/postgres?sslmode=require&statement_cache_size=0
DATABASE_URL=$SUPABASE_DB_DIRECT_URL  # Alembic/local batch default
SUPABASE_SERVICE_ROLE_KEY=<server-only; never NEXT_PUBLIC; audited use only>
```

- Server Actions and browser clients use user-scoped Supabase clients so RLS applies.
- Alembic and long batch jobs use `SUPABASE_DB_DIRECT_URL`; Vercel/short-lived web traffic uses `SUPABASE_DB_POOL_URL` with transaction-mode pooling and prepared statement cache disabled.
- GitHub Actions secrets include `SUPABASE_DB_DIRECT_URL` and `SUPABASE_DB_POOL_URL`; Clerk auth secrets are not part of the recommended architecture.
- Privileged secrets live only in GitHub Actions protected secrets, Vercel server env, or local gitignored env files. Service-role clients must be separated from user-scoped clients and covered by an import/CI guard.

## 11. Test Strategy per Phase

Each phase exits only when these executable proofs pass:

| Phase | Required proofs |
|---|---|
| 0 — Validate & Freeze | `pytest` migration/backfill helpers against local Docker Postgres; Alembic upgrade/downgrade dry-run with documented data-loss expectations; SQL row-count and financial-total parity for trades, matched trades, daily summaries, finance snapshots, plans, insurance, pensions, and positions; `vitest` for household-context frontend assumptions; sanitized fixture dataset with approved before/after totals. |
| 1 — Database Cutover | Pytest/RLS harness against Supabase local/dev project proving anonymous denied, non-member denied, viewer write denied, member write allowed, owner admin allowed, ex-member denied; migration smoke using direct URL and pooled URL failure/compatibility checks; sanitized snapshot load with row-count/financial parity; connection-limit stress smoke; encrypted `pg_dump` restore into local Docker Postgres. |
| 2 — Vercel + Supabase Auth | Playwright for signin redirect, mocked/real callback, session refresh, invite accept, expired invite, wrong-account invite, sign-out cache clearing, and protected-route denial; Vitest for middleware path classification and safe redirect validation; preview callback spike against real Supabase + Google; CI assertion that preview Supabase ref differs from production; browser-cache regression for private pages. |
| 3 — CRUD Migration | Contract/parity test for each moved FastAPI endpoint; Server Action tests for validation, RLS, and lost-update prevention on high-value records; Playwright coverage for moved workflows; endpoint checklist with rollback toggle; proof deprecated FastAPI routes are no longer called. |
| 4 — Operationalize Workers | Pytest for job claiming, idempotency, retry/backoff, partial failure, publish-only-on-success, direct DB writes during network loss, and pause/resume after Supabase refusal/timeouts; SQL reconciliation of cooked totals to raw/compute; Playwright for fresh/refreshing/stale/failed UI states; migration-while-worker-running drill using advisory lock and drain protocol; alert test for repeated failures. |

## 12. Rollback Rehearsal

| Phase | Dry-run procedure | Success looks like |
|---|---|---|
| 0 | Run Alembic upgrade/downgrade on a copied local fixture; compare row counts and financial totals before/after. | Downgrade leaves the pre-migration app usable; any intentionally dropped derived columns are documented. |
| 1 | Restore the pre-cutover local snapshot, switch `DATABASE_URL` back to local Postgres, and restore a Supabase `pg_dump` into local Docker. | Local app serves the same baseline totals; Supabase can be abandoned without losing the source snapshot. |
| 2 | Use Vercel deployment rollback and remove Supabase auth env vars from preview; run frontend locally. | Users can reach the last known-good frontend; private pages remain protected; OAuth misconfig does not expose data. |
| 3 | Flip route toggle / `NEXT_PUBLIC_API_URL` back to FastAPI for the migrated endpoint set. | Contract tests still pass through the legacy path and no duplicate writes occur. |
| 4 | Disable cron/worker schedule, terminate an in-flight worker after raw write, restart with retry enabled. | `compute_runs` resumes or fails visibly; cooked tables remain at last successful `source_run_id`; alerts fire. |

## 13. Edge Case Catalogue

- **Spouse removed mid-write:** Server Actions re-check active membership at commit; shared rows remain in household with audit attribution; private rows are not exposed; removed user loses read/write/restore immediately.
- **Simultaneous mutual invites:** Unique pending-invite rules and accept-time membership checks prevent duplicate active memberships; if both users created households, accepting one invite requires an explicit merge/decline choice before data sharing.
- **Expired magic link/invite:** Acceptance fails generically, does not reveal account existence, and allows owner to issue a new single-use invite.
- **Google → email account collision:** Initial migration supports Google OAuth only. Any email magic-link/password fallback is blocked until Supabase identity-linking is configured so the same verified email maps to one canonical `auth.users` id and Playwright proves household access is not split.
- **Supabase project pause + local Docker mid-write:** Workers treat connection refusal/timeouts as retryable, keep raw writes idempotent, and never publish partial cooked data. > ⚠️ User to verify against current Supabase docs: pause, unpause, backup retention, and restore guarantees.
- **Migration during raw ingestion:** Migrations require worker drain plus advisory lock. Workers must check the lock before claim/write and finish or fail current transactions before DDL starts.
- **Preview deploys hitting prod data:** Preview Vercel env vars must target preview/dev Supabase projects. CI fails if preview refs equal production refs or OAuth state can write production household data.
- **Concurrent household edits:** High-value records use optimistic concurrency (`updated_at`/version) so stale spouse edits fail with a conflict message rather than silently overwriting.
- **Cooked refresh succeeds with wrong totals:** Reconciliation SQL must pass before `compute_runs.status='succeeded'`; otherwise the run is failed and the old cooked snapshot remains active.
- **Service-role misuse:** CI/import tests fail if service-role clients are imported into user request handlers; privileged writes require audit rows.

## 14. Observability for Cooked-Refresh Failures

`compute_runs` is the canonical job table; `household_refresh_state` is the UI-facing state table. Every run writes status, timestamps, `source_run_id`, row counts, reconciliation totals, and sanitized error summary. A nightly GitHub Actions stale-data check queries for `failed` runs or stale domains and writes a visible Actions summary; after two consecutive failures for a household/domain, the app sends an email alert to the household owner and shows a dashboard banner with the last successful refresh time. Optional Better Stack/Grafana can replace email once paid observability is justified.

## 15. Acceptance Criteria for "Migration Complete"

1. Every household-scoped table has `household_id` or a documented exemption; RLS is enabled/forced and automated tests prove anonymous denied, non-member denied, viewer write denied, member write allowed, owner admin allowed, and ex-member denied.
2. Sanitized migration fixture upgrades and rehearsed downgrades pass with row counts and financial totals matching approved baselines.
3. Production, preview, development, and local environments use separate Supabase projects or verified isolated schemas; CI fails if preview targets production credentials.
4. Supabase Auth signin, signout, session refresh, invite accept, expired invite, wrong-account invite, and leave/remove household flows pass Playwright.
5. Each migrated CRUD endpoint has contract/parity tests, Server Action tests, workflow coverage, and a documented rollback switch.
6. Local Docker workers are idempotent under interruption, network loss, and Supabase pause/resume; partial compute output never publishes to cooked tables.
7. Cooked tables expose `refreshed_at`, `source_run_id`, status, and staleness metadata; UI displays fresh, refreshing, stale, and failed states.
8. Backup and restore are rehearsed: encrypted Supabase dump restores into local Docker Postgres and passes smoke/parity tests.
9. Migrations are rehearsed with workers drained/locked so DDL cannot race raw/compute/cooked writes.
10. Legacy local auth/JWT is disabled in production; transitional FastAPI endpoints accept Supabase JWTs only and validate issuer/audience/signature.

---

## 16. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Bad RLS policy exposes financial data** — a single missing `WHERE` can leak household rows. | High | Corrected helper functions centralize membership checks. RLS integration tests required before production. Rabin to audit all policies. |
| 2 | **Supabase free-tier limits / pause** — storage, connection, backup, and pause behavior may change. | Medium | Monitor storage; plan upgrade to Pro ($25/mo) if approaching limits. Run encrypted `pg_dump` cron from Phase 1 and restore rehearsal monthly. > ⚠️ User to verify against current Supabase docs. |
| 3 | **Connection pooling breaks migrations** — PgBouncer transaction mode breaks Alembic/session behavior. | Medium | Use direct URL for Alembic/batch jobs; pooled URL for short web traffic with `statement_cache_size=0`, timeouts, and `pool_pre_ping=True`. |
| 4 | **Preview deploy OAuth or data isolation fails** — preview URLs are not allowlisted or hit prod data. | High | Validate stable callback spike; prohibit production Supabase credentials in preview; CI checks project refs and safe redirect state. |
| 5 | **Laptop sleep / network loss breaks workers** — missed market windows, stale cooked data. | Medium | Docker healthcheck, `restart: unless-stopped`, exponential backoff, idempotent jobs, UI stale/failed states, owner email alerts. |
| 6 | **Server Actions become a hidden backend** — business logic without observability or tests. | Medium | Server Actions do CRUD + validation only. Complex logic stays in workers. Require tests for every Server Action. |
| 7 | **Privileged secret misuse** — service-role key or direct DB credentials bypass user RLS. | High | Browser never receives service-role. User handlers use user-scoped clients. GitHub Actions/local workers use protected secrets, narrow DB roles where feasible, and audited privileged writes. |
| 8 | **Schema drift or migration/write race** — dashboard DDL or worker writes race Alembic. | Medium | All schema changes through Alembic; CI schema diff; worker drain/advisory lock before DDL; never apply production DDL directly in Supabase dashboard. |
| 9 | **Threats across trust boundaries** — XSS/token theft, OAuth open redirect, invite replay, role escalation, CSRF, financial data in logs, soft-deleted/ex-member access. | High | HttpOnly/Secure/SameSite cookies, CSP, redirect allowlists, single-use invite tokens, owner-only role endpoints, CSRF/Origin checks, log redaction, deleted/ex-member RLS tests. |

---

## 17. Decisions Made & Open Questions

### Decisions made in this revision

1. **Canonical household schema:** Use `household_role`, default invite/member role `viewer`, `left_at`, `invited_by`, normalized invite email, and Rabin's stricter RLS helpers.
2. **No Clerk in recommended path:** Supabase Auth is the sole auth provider for this design; do not configure Clerk secrets.
3. **Identity policy:** Google OAuth only for initial migration. Email fallback is deferred until account linking proves one canonical user id per verified email.
4. **Backups:** Add encrypted local `pg_dump` offload from Phase 1 rather than relying solely on plan-dependent Supabase backups.
5. **Preview isolation:** Preview deploys must not use production Supabase credentials; CI/Vercel checks are required.
6. **Worker/migration concurrency:** Workers must drain/check advisory lock before migrations; migrations use direct DB URL.
7. **Service-role scope:** Browser never receives service-role; Server Actions use user-scoped clients by default; privileged use is limited to protected CI/local worker/admin contexts with audit logging.

### Decisions still needed from Jony

- **Custom domain:** Will the app use a custom domain (for example `trading-journal.example.com`) or only `*.vercel.app`? This must be decided before Phase 2 OAuth callback validation.
- **Vercel plan:** Does Vercel's hobby tier policy fit the sharing pattern, or should Pro be planned before spouse/household rollout?
- **Household naming:** Should the first household be auto-created on signup, or should users explicitly create one?

### Items for reviewer re-check

- **Rabin:** Re-check corrected RLS, invite lifecycle, service-role scope, threat coverage, and audit trail.
- **Redfoot:** Re-check phase test matrix, edge catalogue, rollback rehearsal, and acceptance criteria.
- **Kujan:** Re-check direct vs pooled connection env vars, Docker retry/healthcheck/restart strategy, backup offload, preview OAuth validation procedure, and free-tier pause verification notes.
- **McManus:** Align Section 06 implementation details with `household_role`, `left_at`, deleted-household checks, backup/restore, and cooked reconciliation.

---

## 18. Appendix: Section Index

### Section files

| # | Section | Author | File |
|---|---|---|---|
| 01 | Architecture Overview & Alternatives | Keaton | [sections/01-architecture-overview.md](sections/01-architecture-overview.md) |
| 02 | Frontend Strategy & UX Flows | Fenster | [sections/02-frontend-strategy.md](sections/02-frontend-strategy.md) |
| 03 | Auth, Sharing & Security | Rabin | [sections/03-auth-sharing-security.md](sections/03-auth-sharing-security.md) |
| 04 | Deployment & CI/CD | Kujan | [sections/04-deployment-cicd.md](sections/04-deployment-cicd.md) |
| 05 | Backend Strategy | Hockney | [sections/05-backend-strategy.md](sections/05-backend-strategy.md) |
| 06 | Data Architecture | McManus | [sections/06-data-architecture.md](sections/06-data-architecture.md) |

### Diagrams

| # | Diagram | File |
|---|---|---|
| 01 | System Context | [diagrams/01-system-context.excalidraw](diagrams/01-system-context.excalidraw) |
| 02 | Auth UX Flow | [diagrams/02-auth-ux-flow.excalidraw](diagrams/02-auth-ux-flow.excalidraw) |
| 03 | Auth Sharing Flow | [diagrams/03-auth-sharing-flow.excalidraw](diagrams/03-auth-sharing-flow.excalidraw) |
| 04 | Deployment Topology | [diagrams/04-deployment-topology.excalidraw](diagrams/04-deployment-topology.excalidraw) |
| 05 | Data Flow | [diagrams/05-data-flow.excalidraw](diagrams/05-data-flow.excalidraw) |
| 06 | Data Model | [diagrams/06-data-model.excalidraw](diagrams/06-data-model.excalidraw) |

> All `.excalidraw` files open in [excalidraw.com](https://excalidraw.com) or the VS Code Excalidraw extension.

---

## Changelog

- 2026-05-01: v1 — initial synthesis by Keaton
- 2026-05-01: v2 — revision by Hockney addressing Rabin/Redfoot/Kujan reviews
