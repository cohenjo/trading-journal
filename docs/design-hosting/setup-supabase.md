# Supabase Setup Runbook

**Owner:** Kujan (DevOps/Platform)  
**Status:** Operational Runbook  
**Target:** Supabase Postgres + Auth for trading journal application  
**Related Issues:** TJ-001 (local stack), TJ-004 (provision projects), TJ-005 (schema), TJ-007 (RLS)

⚠️ **CRITICAL:** This runbook covers Supabase only. For Vercel setup, see `docs/design-hosting/setup-vercel.md` (Hockney).

---

## 1. Install + Auth

### macOS Install
```bash
# Install via Homebrew
brew install supabase/tap/supabase

# Verify installation
supabase --version
# Expected: supabase version 1.x.x
```

### Login
```bash
# Opens browser to authenticate; stores Personal Access Token (PAT) in ~/.supabase
supabase login

# Verify authentication
supabase projects list
# Should list projects under org cohenjo or show empty list if none exist
```

⚠️ **Personal Access Token:** Generate at https://supabase.com/dashboard/account/tokens if CLI login fails. Store securely.

---

## 2. Local Stack (Daily Dev Loop) — RECOMMENDED

### One-Time Initialization
```bash
# At repo root
supabase init
# Creates supabase/ directory with:
#   config.toml       # Local stack configuration
#   seed.sql          # Initial data seed
#   migrations/       # SQL migration files
```

### Start Local Stack
```bash
# Requires Docker running
supabase start

# First run downloads Docker images (~2-5 minutes)
# Subsequent starts: ~10-30 seconds
```

**Services Provisioned:**
- Postgres (port 54322)
- GoTrue (auth service)
- PostgREST (REST API)
- Supabase Storage
- Supabase Studio (web UI)
- Inbucket (email catcher)

### Inspect Running Stack
```bash
supabase status
```

**Output includes:**
- API URL: `http://127.0.0.1:54321`
- DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Studio URL: `http://127.0.0.1:54323`
- Inbucket URL: `http://127.0.0.1:54324` (mail catcher for testing OAuth emails)
- Anon key (public API key)
- Service role key (server-side admin key — NEVER expose to client)
- JWT secret

### Stop Stack
```bash
# Preserve data (default)
supabase stop

# Wipe data (clean slate)
supabase stop --no-backup
```

### Reset Database (Wipe + Replay Migrations + Seed)
```bash
supabase db reset
# Use this after creating/editing migrations to test them
```

**Local URLs Summary:**
| Service | URL | Purpose |
|---------|-----|---------|
| API | `http://127.0.0.1:54321` | REST/GraphQL endpoints |
| DB | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Direct Postgres connection |
| Studio | `http://127.0.0.1:54323` | Web database UI |
| Inbucket | `http://127.0.0.1:54324` | Test email inbox |

---

## 3. Env Vars (Local)

### Frontend: `apps/frontend/.env.local`
```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase status>

# Server-only key — NEVER ship to client bundle
SUPABASE_SERVICE_ROLE_KEY=<from supabase status>
```

### Backend: `apps/backend/.env`
```bash
# Direct connection for migrations and long-running jobs
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# JWT secret for validating Supabase auth tokens
SUPABASE_JWT_SECRET=<from supabase status>

# Optional: transaction pooler URL (not used for local direct connection)
# SUPABASE_DB_POOL_URL will be needed for production transaction-mode pooler
```

**⚠️ PgBouncer / Pooler Gotcha:**

SQLAlchemy/SQLModel requires `?statement_cache_size=0` when connecting through Supabase's **transaction-mode pooler** (port 6543). This is **NOT** needed for local direct connections (port 54322) or remote direct connections (port 5432).

**When you DO need it (production):**
```bash
# Remote transaction pooler (serverless, short-lived connections)
SUPABASE_DB_POOL_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:6543/postgres?statement_cache_size=0
```

**When you DON'T need it (local dev, migrations, long-running jobs):**
```bash
# Local direct connection OR remote direct connection (port 5432)
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**Reason:** PgBouncer transaction mode closes connections after each transaction, breaking prepared statement caches. Direct connections are persistent and safe.

Reference: `docs/design-hosting/sections/05-backend-strategy.md` §Connection pooling.

---

## 4. Migrations Workflow

### Create New Migration
```bash
supabase migration new <name>
# Creates: supabase/migrations/<timestamp>_<name>.sql
```

**Example:**
```bash
supabase migration new add_households_table
# Edit the generated .sql file, then test:
supabase db reset
```

### Diff Studio Changes Into Migration
If you make schema changes via Studio UI and want to capture them as a migration:

```bash
supabase db diff --use-migra -f <name>
# Creates migration file with changes detected since last migration
```

⚠️ **Recommendation:** Prefer writing migrations manually for financial applications. Visual tools can miss constraints, indexes, or RLS policies.

### Apply Migrations Locally
```bash
# Wipe + replay all migrations + seed
supabase db reset

# Or start fresh stack (implicitly applies migrations)
supabase start
```

### Lint Migrations
```bash
supabase db lint
# Checks for common schema issues (missing indexes, RLS off on user tables, etc.)
```

### Push Migrations to Remote (After Linking)
```bash
# Apply local migrations to linked remote project
supabase db push
```

---

## 5. Provisioning Remote Projects

**Recommended:** Create THREE Supabase projects — `trading-journal-dev`, `trading-journal-preview`, `trading-journal-prod`.

### 5a. Dashboard Provisioning (Recommended for First Project)

1. Navigate to https://supabase.com/dashboard
2. Select org: `cohenjo`
3. Click **New Project**
4. Enter:
   - **Name:** `trading-journal-prod` (or dev/preview)
   - **Database Password:** Strong password (store in 1Password)
   - **Region:** `eu-central-1` (Frankfurt)
   - **Plan:** Free (confirm 500 MB DB / 50k MAU sufficient)
5. Wait for provisioning (~2 minutes)
6. Note the **Project Ref** (e.g., `abcdefghijklmnop`) from project settings URL

⚠️ **Region Selection:**
- `eu-central-1` (Frankfurt) — recommended for Israel-based devs
- `us-east-1` (N. Virginia) — lower latency for US-based users
- Verify latency from your location: https://cloudping.info/
- **Cannot change region after creation** — choose carefully

### 5b. Management API Provisioning (CLI-Friendly)

⚠️ **IMPORTANT:** Verify current API endpoint and field names against live docs: https://supabase.com/docs/reference/api/introduction

```bash
# Set PAT
export SUPABASE_ACCESS_TOKEN=sbp_...  # From dashboard → Account → Tokens

# Discover your org ID
curl -s https://api.supabase.com/v1/organizations \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | jq

# Create project
curl -X POST https://api.supabase.com/v1/projects \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "trading-journal-prod",
    "organization_id": "<org_id_from_above>",
    "region": "eu-central-1",
    "db_pass": "<strong_password>",
    "plan": "free"
  }'
```

⚠️ **API Field Names:** The `region` field may vary by API version. Verify against official docs before running. Common alternatives: `region`, `region_id`, `data_center`.

### 5c. Linking Local CLI to Remote Project

```bash
# Link local supabase/ directory to remote project
supabase link --project-ref <project-ref>

# Verify link
supabase projects list
# Should show asterisk (*) next to linked project

# Pull current schema from remote (if project exists and has data)
supabase db pull
# Creates migration file with remote schema

# Push local migrations to remote
supabase db push
```

**Migration Safety:**
- Always test migrations locally (`supabase db reset`) before pushing to remote
- `supabase db push` applies ALL unapplied migrations in `supabase/migrations/`
- No automatic rollback — write down-migrations manually if needed

---

## 6. Schema + RLS Bootstrap

**Minimum viable schema** for auth + household sharing. Full schema in `docs/design-hosting/sections/06-data-architecture.md`.

### First Migration: Core Tables + RLS Helper

**File:** `supabase/migrations/<timestamp>_init_households_and_rls.sql`

```sql
-- Households: tenancy boundary for shared financial data
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Household members: who can see what
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

-- Index for user-to-household lookups
create index household_members_user_active_idx
  on public.household_members (user_id, household_id)
  where left_at is null;

-- RLS helper: check if current user is active member of household
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = hid
      and user_id = auth.uid()
      and left_at is null
  );
$$;

-- Enable RLS on households table
alter table public.households enable row level security;

-- Policy: users can read households they belong to
create policy households_member_read
  on public.households
  for select
  using (public.is_household_member(id));

-- Policy: users can insert households (creates personal household on signup)
create policy households_create
  on public.households
  for insert
  with check (auth.uid() = created_by);

-- Enable RLS on household_members
alter table public.household_members enable row level security;

-- Policy: users can read their own memberships
create policy household_members_read
  on public.household_members
  for select
  using (user_id = auth.uid() or public.is_household_member(household_id));
```

### Example: Household-Scoped Data Table with RLS

**Template for any shared financial table** (trades, positions, plans, etc.):

```sql
-- Example: raw imported trades
create table raw.raw_trades_import (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  source text not null check (source in ('ibkr', 'schwab', 'manual', 'other')),
  symbol text not null,
  quantity numeric(18, 6) not null,
  price numeric(18, 6) not null,
  trade_timestamp timestamptz not null,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table raw.raw_trades_import enable row level security;

-- Policy: household members can read
create policy raw_trades_member_read
  on raw.raw_trades_import
  for select
  using (public.is_household_member(household_id));

-- Policy: household members can insert
create policy raw_trades_member_insert
  on raw.raw_trades_import
  for insert
  with check (public.is_household_member(household_id));

-- Index for household queries
create index raw_trades_import_household_idx
  on raw.raw_trades_import (household_id, trade_timestamp desc);
```

**⚠️ RLS ENFORCEMENT:** Every user-data table **must** have RLS enabled + appropriate policies. Use `supabase db lint` to catch missing RLS.

**Reference:** Full table catalog and layering (raw/compute/cooked) in `docs/design-hosting/sections/06-data-architecture.md`.

---

## 7. Google OAuth (Local + Remote)

### 7.1 Google Cloud Console Setup

1. Navigate to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID → **Web application**
3. **Authorized JavaScript origins:**
   - `http://localhost:3000` (local dev)
   - `https://trading-journal.example.com` (production domain)
   - `https://trading-journal.vercel.app` (Vercel production)
4. **Authorized redirect URIs:**
   - Remote: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Local: `http://127.0.0.1:54321/auth/v1/callback`
5. Save **Client ID** and **Client Secret**

**⚠️ Redirect URI Flow:**
Google → Supabase callback → Your app's `/auth/callback` page. Both Google and Supabase redirect URIs must be configured.

### 7.2 Remote Supabase Configuration

1. Navigate to Supabase Dashboard → **Authentication** → **Providers**
2. Enable **Google**
3. Paste:
   - **Client ID:** from Google Console
   - **Client Secret:** from Google Console
4. Under **URL Configuration** (Authentication → URL Configuration):
   - **Site URL:** `https://trading-journal.example.com` (or Vercel URL)
   - **Additional Redirect URLs:**
     - `http://localhost:3000/auth/callback`
     - `https://trading-journal.vercel.app/auth/callback`
     - `https://*.vercel.app/auth/callback` (if wildcard supported — verify in docs)

⚠️ **Preview Deploy OAuth:** Vercel preview URLs (`https://trading-journal-<branch>-<hash>.vercel.app`) require explicit whitelisting in Google Console OR wildcard support in Supabase. Test exact preview URL behavior before Phase 1. Cross-reference with `docs/design-hosting/setup-vercel.md` (Hockney).

### 7.3 Local Stack Configuration

Edit `supabase/config.toml`:

```toml
[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_CLIENT_SECRET)"
```

Set environment variables before `supabase start`:

```bash
# In your shell or .env file (NOT committed to git)
export GOOGLE_CLIENT_ID="<from_google_console>"
export GOOGLE_CLIENT_SECRET="<from_google_console>"

supabase start
```

**Test Local OAuth:**
1. Start local stack: `supabase start`
2. Navigate to `http://localhost:3000` (your Next.js app)
3. Click "Sign in with Google"
4. Should redirect through Google → Supabase local → back to app
5. Check Inbucket (`http://127.0.0.1:54324`) for confirmation emails

---

## 8. Backups + DR

### Manual Backup (Local or Remote)
```bash
# Backup remote project
supabase db dump --db-url "$DB_URL" -f backup-$(date +%F).sql.gz

# Example with direct connection URL
supabase db dump \
  --db-url "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  -f backup-2026-05-01.sql.gz
```

### Automated Backups

**Free Tier:**
- Daily automatic backups
- 7-day retention

⚠️ **Verify Retention:** Supabase free-tier backup retention may vary. Check current policy at https://supabase.com/docs/guides/platform/backups

**Paid Tier (Pro):**
- Point-in-time recovery (PITR)
- 7-day retention (Pro); 14-day (Team); 90-day (Enterprise)

### Restore from Backup
```bash
# Restore to local (test)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  < backup-2026-05-01.sql

# Restore to remote (CAREFUL — this is destructive)
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  < backup-2026-05-01.sql
```

### Schema Rollback

**⚠️ LIMITATION:** Supabase CLI does not support down-migrations natively. 

**Workaround:** Write manual undo migrations if you need rollback capability.

**Example down-migration:**
```sql
-- supabase/migrations/<timestamp>_revert_households.sql
drop policy if exists households_member_read on public.households;
drop table if exists public.household_members;
drop table if exists public.households;
```

Apply via `supabase db push` or `psql`.

---

## 9. Cost & Quota Watchpoints

### Free Tier Limits (Confirmed by Jony)
- **50,000 Monthly Active Users (MAU)**
- **500 MB Database storage**
- **5 GB Egress bandwidth**
- **5 GB Cached egress** (CDN)
- **1 GB File storage** (Supabase Storage)
- **Shared CPU + 500 MB RAM**

⚠️ **Verify Current Limits:** Free-tier quotas may change. Confirm at https://supabase.com/pricing before production deployment.

### Usage Monitoring
```bash
# Via CLI (if supported — verify command exists)
supabase projects usage --project-ref <project-ref>

# Via Dashboard
# Navigate to: Project Settings → Usage & Billing
```

### Quota Strategy
- **Defer PDF uploads** until paid tier (1 GB file storage insufficient for broker PDFs)
- **Monitor DB size:** Check before Phase 1 schema deploy (TJ-005) — run `SELECT pg_database_size('postgres');`
- **Egress limits:** 5 GB/month ≈ 200 MB/day — sufficient for ~100 active trading days with chart data

### Project Pause
⚠️ **Free-Tier Inactivity:** Projects may pause after ~7 days of inactivity. Verify current policy at https://supabase.com/docs/guides/platform/project-status

**Resume:** Dashboard → Resume Project (or CLI if supported)

---

## 10. Cross-References

### Related Documentation
- **Vercel Setup:** `docs/design-hosting/setup-vercel.md` (Hockney) — covers frontend deployment, preview URLs, env vars sync
- **Architecture:** `docs/design-hosting/design.md` — §Architecture (Supabase role), §Sharing (households model), §Data (raw/compute/cooked layers)
- **Auth Details:** `docs/design-hosting/sections/03-auth-sharing-security.md` (Rabin) — RLS policies, invite flow, cookie security
- **Schema Details:** `docs/design-hosting/sections/06-data-architecture.md` (McManus) — full table catalog, migration plan, per-table sharing rules
- **CI/CD:** `docs/design-hosting/sections/04-deployment-cicd.md` (Kujan) — GitHub Actions for migrations, schema diff checks

### GitHub Issues
- **TJ-001:** Local Supabase stack setup
- **TJ-004:** Provision remote projects (dev/preview/prod)
- **TJ-005:** Schema deployment + RLS bootstrap
- **TJ-007:** RLS policy implementation for all user tables

---

## 11. ⚠️ Verification Checklist

**Complete these before Phase 1 deployment:**

- [ ] **Region selection:** Confirm `eu-central-1` (Frankfurt) latency acceptable from your location (https://cloudping.info/)
- [ ] **Management API field names:** Verify `region` field name against live docs (https://supabase.com/docs/reference/api/introduction)
- [ ] **Free-tier quotas:** Confirm 50k MAU / 500 MB DB / 5 GB egress still accurate (https://supabase.com/pricing)
- [ ] **Backup retention:** Verify 7-day retention for free tier (https://supabase.com/docs/guides/platform/backups)
- [ ] **Project pause policy:** Confirm inactivity threshold (~7 days) and resume process (https://supabase.com/docs/guides/platform/project-status)
- [ ] **OAuth preview URLs:** Test exact Vercel preview URL pattern against Supabase redirect allowlist behavior
- [ ] **Local DB size:** Run `SELECT pg_database_size('postgres');` before TJ-005 to confirm data fits in 500 MB
- [ ] **PgBouncer connection string:** Confirm `statement_cache_size=0` parameter required for transaction pooler in production

---

## Appendix A: Common Commands Quick Reference

```bash
# Local dev cycle
supabase start                          # Boot local stack
supabase status                         # Show URLs + keys
supabase db reset                       # Wipe + replay migrations + seed
supabase stop                           # Stop (preserve data)
supabase stop --no-backup               # Stop + wipe data

# Migrations
supabase migration new <name>           # Create new migration
supabase db diff --use-migra -f <name>  # Generate diff from Studio changes
supabase db reset                       # Test migrations locally
supabase db lint                        # Check schema (RLS, indexes, etc.)
supabase db push                        # Apply to linked remote

# Remote management
supabase login                          # Authenticate CLI
supabase projects list                  # List all projects
supabase link --project-ref <ref>       # Link local to remote
supabase db pull                        # Pull remote schema
supabase db dump --db-url "$URL" -f backup.sql.gz  # Backup

# Auth
supabase gen types typescript --local   # Generate TypeScript types
```

---

## Appendix B: Troubleshooting

### Issue: `supabase start` fails with Docker error
**Solution:** Ensure Docker Desktop is running and has sufficient resources (4 GB RAM minimum).

### Issue: OAuth redirect loop
**Solution:** Verify both Google Console redirect URIs AND Supabase "Additional Redirect URLs" include your app's callback URL.

### Issue: RLS blocks legitimate queries
**Solution:** Check `auth.uid()` is non-null. Use `select auth.uid();` in SQL Editor to verify session. If null, auth token not passed correctly.

### Issue: Migration fails on remote `supabase db push`
**Solution:** Test locally first with `supabase db reset`. Check for syntax errors, missing extensions, or conflicting constraints.

### Issue: "Project paused" when accessing remote
**Solution:** Resume project in Dashboard. Free-tier projects auto-pause after inactivity. Consider upgrading to Pro ($25/mo) if sustained uptime needed.

### Issue: "Too many connections" error
**Solution:** Use transaction pooler (port 6543) for web traffic, not direct connection. Verify `SUPABASE_DB_POOL_URL` configured with `?statement_cache_size=0`.

---

**End of Runbook**
