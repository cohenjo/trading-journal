# Supabase Local Dev Runbook (Kujan)

> Scope: **local development only.** Remote provisioning → `supabase-02-remote.md`. Auth/RLS → `supabase-03-auth-rls.md`. Vercel → `vercel-01-project.md`.
>
> **TJ-001** — Written/maintained by Kujan (DevOps/Platform). Every command is copy-pasteable. Tested on macOS arm64, Docker Desktop 4.x, Homebrew, Node 20 LTS.

---

## 0. Prerequisites

Before `supabase start` will succeed, verify all of these:

| Requirement | Check | Install / fix |
|---|---|---|
| **Docker Desktop** running | `docker info \| grep "Server Version"` — must not error | Launch Docker Desktop (or OrbStack) |
| **Supabase CLI ≥ 2.95** | `supabase --version` | `brew install supabase/tap/supabase` — see §1 |
| **psql (libpq)** | `psql --version` | `brew install libpq && brew link --force libpq` |
| **Node ≥ 20** | `node --version` | `brew install node@20` or use `nvm use 20` |
| **macOS arm64** | `uname -m` → `arm64` | Tested on Apple Silicon; Intel/Rosetta should work but is not validated |

> ⚠️ Docker Desktop must be **fully started** (whale icon in menu bar, not just launching) before running any `supabase` command. If Docker is starting up, `supabase start` hangs silently.

---

## 1. Install Supabase CLI (macOS)

```bash
# Homebrew (recommended)
brew install supabase/tap/supabase
supabase --version   # must print >= 2.95

# Upgrade
supabase stop --no-backup   # stop containers first
brew upgrade supabase/tap/supabase
```

> npm alternative: `npm install supabase --save-dev` (pins to project; use `npx supabase`).

---

## 2. Start the Local Stack

```bash
# From repo root. First run pulls Docker images (~1-2 min, ~600 MB).
supabase start
```

Expected output (abridged — your keys will differ):

```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
  S3 Storage URL: http://127.0.0.1:54321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
    Inbucket URL: http://127.0.0.1:54324
      JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
        anon key: eyJhbGciOiJIUzI1NiIsInR5...   <- Publishable key
service_role key: eyJhbGciOiJIUzI1NiIsInR5...   <- Secret key — never expose
```

Port map (configured in `supabase/config.toml`):

| Service | Port | URL |
|---------|------|-----|
| API (PostgREST) | 54321 | `http://127.0.0.1:54321` |
| DB (Postgres) | 54322 | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | 54323 | `http://127.0.0.1:54323` |
| Inbucket (email) | 54324 | `http://127.0.0.1:54324` |

> ⚠️ **Key naming changed in recent CLI versions.** Older CLI showed `anon key` / `service_role key`; newer CLI labels them **Publishable** and **Secret**. Always copy from _your_ `supabase status` output.

---

## 3. Get Local Credentials

```bash
supabase status
```

Copy the output values into `apps/frontend/.env.local` (create from example):

```bash
cp apps/frontend/.env.local.example apps/frontend/.env.local
# Then edit: paste keys from `supabase status`
```

```dotenv
# apps/frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key / publishable key from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key — NEVER prefix with NEXT_PUBLIC_>
```

Backend:

```dotenv
# apps/backend/.env
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_JWT_SECRET=<jwt secret from supabase status>
```

> 🔒 `.env.local` is gitignored. Never commit it. See `apps/frontend/.env.local.example` for all three environment targets (local / dev-remote / prod).

---

## 4. Apply All Migrations

`supabase db reset` drops the local DB, re-creates it, runs all migrations in
timestamp order, then runs `supabase/seed.sql`.

```bash
supabase db reset
```

Expected terminal output (abbreviated):

```
Resetting local database...
Initializing schema...
Applying migration 20260430115000_baseline_legacy_schema.sql...
Applying migration 20260430120000_households_and_members.sql...
...
Applying migration 20260430140300_cooked_tables.sql...
Seeding data from supabase/seed.sql...
Finished supabase db reset.
```

Seed credentials after reset:

| Email | Password |
|-------|----------|
| `alice@example.local` | `password123` |
| `bob@example.local` | `password123` |

### ⚠️ Legacy-table migration dependency

Migrations `130000`–`130300` (`add_audit_columns`, `add_household_id`,
`add_owner_user_id`, `drop_trading_account_secrets`) depend on columns
introduced by `20260430115000_baseline_legacy_schema.sql`.

**Status as of TJ-001:** `20260430115000_baseline_legacy_schema.sql` is in this
branch (`squad/54-local-supabase-dev`) via the McManus TJ-005-followup commit.
Once it merges to `main`, plain `supabase db reset` will work end-to-end with
no workaround. Until then:

```bash
# Option A — reset without seed (gets a clean schema baseline)
supabase db reset --no-seed

# Option B — temporarily skip the blocking migrations
cd supabase/migrations
for f in 20260430130{0..3}*.sql; do mv "$f" "${f}.skip"; done
supabase db reset
for f in *.skip; do mv "$f" "${f%.skip}"; done
```

---

## 5. Run pgTAP Tests

pgTAP tests live in `supabase/tests/*.test.sql` and run against the local DB.

```bash
supabase test db
```

Expected output once tests exist:

```
Running tests in supabase/tests/...
 ok 1 - households table exists
 ok 2 - household_members role enum has owner/member/viewer
...
# PASS
# Tests passed: N / Tests failed: 0
```

> `supabase/tests/` is currently empty — the runner will output `No test files found`.
> Tests land in TJ-009 (RLS policies). Run the command anyway to confirm the runner wires up.

---

## 6. Run Frontend Against Local Stack

```bash
# Set env (if not done in §3)
cp apps/frontend/.env.local.example apps/frontend/.env.local
# Edit: paste keys from `supabase status`

# Start dev server
cd apps/frontend
npm run dev
```

Open `http://localhost:3000`. Login with seed credentials:
- `alice@example.local` / `password123`
- `bob@example.local` / `password123`

Studio (Postgres UI + SQL editor) is at `http://127.0.0.1:54323`.
All auth emails (magic links, OTP) are captured by Inbucket at `http://127.0.0.1:54324`.

---

## 7. Reset Cycle

```bash
# Full wipe + replay migrations + re-seed (idempotent — safe to run anytime)
supabase db reset

# Stop all containers (preserve DB volume for next start)
supabase stop

# Stop all containers AND wipe DB volume (truly clean slate)
supabase stop --no-backup
```

---

## 8. Migrations Dev Loop

```bash
# Start the day
supabase start
supabase status          # grab fresh keys if needed

# New feature requiring DB changes
supabase migration new my_feature
# Edit: supabase/migrations/<timestamp>_my_feature.sql
supabase db reset        # wipe + replay all migrations + seed

# Capture changes made via Studio back into a migration file
supabase db diff --use-migra -f my_feature_v2
supabase db reset        # validate the captured migration

# Lint before committing
supabase db lint

# End of day
supabase stop
```

> **No native down-migrations.** Write a forward-only undo migration if rollback
> is needed. Always `supabase db reset` locally before pushing to remote.

---

## 9. Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `address already in use :54321` | Another `supabase start` running or stale container | `supabase stop && docker ps` to find stale containers |
| `supabase start` hangs indefinitely | Docker Desktop not fully started | Wait for whale icon; then retry |
| Port 54321/54322/54323 squatted | Another local process | `lsof -i :54321` to identify; stop it or change ports in `config.toml` |
| Stale/incorrect schema | Migrations edited in-place or out of order | `supabase db reset` — nukes everything, replays cleanly |
| Studio not loading at :54323 | Docker container crashed | `docker ps` — check `supabase_studio_*`; restart Docker Desktop if stuck |
| Auth email not received | Inbucket not checked | All local auth emails at `http://127.0.0.1:54324` |
| Migration failure mid-reset | SQL error in a migration file | Read Postgres error in terminal; check `supabase/.temp/` for full logs |
| `supabase link` fails 401 | Missing/expired PAT | `supabase login` or re-export `SUPABASE_ACCESS_TOKEN` (remote ops only) |
| `crypt()` not found in seed.sql | pgcrypto not loaded before seed | `supabase db reset` loads extensions automatically; if running psql directly, run `create extension if not exists pgcrypto` first |
| `psql` not on PATH | Homebrew libpq not linked | `brew link --force libpq` |

**Stale containers after crash:**

```bash
supabase stop --no-backup   # force-remove all containers
supabase start
```

---

## 10. Login + PAT (remote ops only)

> PAT is **not** needed for local dev. Only required for `supabase link`, `supabase db push`, or CI.

```bash
# Interactive (browser-based)
supabase login
supabase projects list   # verify auth worked

# Headless / CI: create PAT at https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx
```

---

## 11. Cold-Start Verification Checklist

> Run this from a **fresh terminal** after cloning the repo. If every step passes,
> your local stack matches what's in remote dev.

```bash
# 1. Preflight
docker info | grep "Server Version"   # must print a version string
supabase --version                    # must be >= 2.95
node --version                        # must be >= v20
psql --version                        # must not error

# 2. Start stack
cd /path/to/trading-journal
supabase start
# Expected: "Started supabase local development setup."

# 3. Confirm ports
curl -s http://127.0.0.1:54321/rest/v1/ | python3 -m json.tool | head -5
# Expected: JSON with "paths" key (PostgREST spec)

curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:54323
# Expected: 200

# 4. Apply migrations + seed
supabase db reset
# Expected: "Finished supabase db reset." — zero ERRORs

# 5. Verify seed data
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT email FROM auth.users ORDER BY email;"
# Expected:
#        email
# ---------------------
#  alice@example.local
#  bob@example.local
# (2 rows)

psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT name FROM public.households;"
# Expected: Demo Household (1 row)

psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT period, as_of_date FROM cooked.dashboard_summary ORDER BY as_of_date DESC LIMIT 3;"
# Expected: 3 rows with period in (day, month, year, all)

# 6. pgTAP tests
supabase test db
# Expected: "No test files found" OR "Tests passed: N / Tests failed: 0"

# 7. Frontend smoke test
cp apps/frontend/.env.local.example apps/frontend/.env.local
# Edit apps/frontend/.env.local — paste keys from `supabase status`
cd apps/frontend && npm run dev
# Expected: "Ready - started server on http://localhost:3000"
# Open http://localhost:3000 — app shell loads, no 500 error

# 8. Stop cleanly
supabase stop
# Expected: "Stopped supabase local development setup."
```

✅ **If you reach this checklist's bottom, your local stack matches what's in remote dev.**

---

## 12. Cross-References

- Remote provisioning: [`supabase-02-remote.md`](./supabase-02-remote.md) (Kujan)
- Auth + RLS schema: [`supabase-03-auth-rls.md`](./supabase-03-auth-rls.md) (Rabin)
- Vercel side: [`vercel-01-project.md`](./vercel-01-project.md) (Hockney)
- Broader Supabase setup narrative: [`../setup-supabase.md`](../setup-supabase.md)
- Issue: [TJ-001 (#54)](https://github.com/cohenjo/trading-journal/issues/54)
