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
| **macOS arm64** | `uname -m` → `arm64` | These commands are tested on Apple Silicon; Intel/Rosetta should work but is not validated |

> ⚠️ Docker Desktop must be **fully started** (whale icon in menu bar, not just launching) before running any `supabase` command. If Docker is starting up, `supabase start` hangs silently.

---

## 1. Install Supabase CLI (macOS)

- **Homebrew (recommended):**
  ```bash
  brew install supabase/tap/supabase
  supabase --version
  ```
- **npm alternative (pin to project):**
  ```bash
  npm install supabase --save-dev
  npx supabase --version
  ```
- **Docker prerequisite:** Docker Desktop or OrbStack must be running before `supabase start`.
- **Upgrade:**
  ```bash
  brew upgrade supabase/tap/supabase
  # or: npm update supabase --save-dev
  ```
  > Stop all running Supabase containers before upgrading (`supabase stop --no-backup`).

---

## 2. Start the Local Stack

```bash
# From repo root. First run pulls Docker images (~1–2 min, ~600 MB).
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
        anon key: eyJhbGciOiJIUzI1NiIsInR5...   ← Publishable key
service_role key: eyJhbGciOiJIUzI1NiIsInR5...   ← Secret key — never expose
```

> ⚠️ **Key naming changed in recent CLI versions.** The CLI may label them `Publishable` and `Secret` instead of `anon key` / `service_role key`. They map identically. Copy from _your_ `supabase status` output.

To check status at any time:

```bash
supabase status
```

---

## 3. Get Local Credentials

```bash
supabase status
```

Copy the output values into `apps/frontend/.env.local` (create from `.env.local.example`):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key / publishable key from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key / secret key — NEVER prefix NEXT_PUBLIC_>
```

> 🔒 `.env.local` is gitignored. Never commit it.

For the backend:

```bash
# apps/backend/.env
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_JWT_SECRET=<jwt secret from supabase status>
```

---

## 4. Apply All Migrations

`supabase db reset` drops the local DB, re-creates it, runs all migrations in
timestamp order, then runs `supabase/seed.sql`.

```bash
supabase db reset
```

Expected terminal output:

```
Resetting local database...
Initializing schema...
Applying migration 20260430120000_households_and_members.sql...
Applying migration 20260430120100_rls_helpers.sql...
...
Applying migration 20260430140300_cooked_tables.sql...
Seeding data from supabase/seed.sql...
Finished supabase db reset.
```

### ⚠️ Legacy-table migration dependency

Migrations `130000`–`130300` (`add_audit_columns`, `add_household_id`,
`add_owner_user_id`, `drop_trading_account_secrets`) depend on columns
introduced by `20260430115000_baseline_legacy_schema.sql`. That migration
lives in **McManus's forthcoming PR** and is **not yet on `main`**.

Until it lands:

```bash
# Option A (recommended): reset without seed to get a clean schema baseline,
# then manually apply only the migrations that do not depend on the legacy tables.
supabase db reset --no-seed

# Option B: temporarily rename the blocking migration files so the CLI skips them,
# reset, then rename them back.
#   cd supabase/migrations
#   for f in 20260430130{0..3}*.sql; do mv "$f" "${f}.skip"; done
#   supabase db reset
#   for f in *.skip; do mv "$f" "${f%.skip}"; done
```

> Once `20260430115000_baseline_legacy_schema.sql` merges, plain `supabase db reset` will work end-to-end with no workaround needed.

---

## 5. Run pgTAP Tests

pgTAP tests live in `supabase/tests/*.test.sql` and run against the local DB.

```bash
supabase test db
```

Expected output (once tests exist):

```
Running tests in supabase/tests/...
 ok  1 - households table exists
 ok  2 - household_members role enum has owner/member/viewer
...
# PASS
# Tests passed: 12
# Tests failed: 0
```

> Currently `supabase/tests/` directory does not exist — the command will output `No test files found`. Tests will be added as part of TJ-009 (RLS policies). Run this command anyway to confirm the runner wires up correctly.

---

## 6. Run Frontend Against Local Stack

```bash
# 1. Copy env if not done yet
cp apps/frontend/.env.local.example apps/frontend/.env.local
# Edit apps/frontend/.env.local with keys from `supabase status`

# 2. Start the frontend dev server
cd apps/frontend
npm run dev
```

Open `http://localhost:3000`. Login with the seed credentials:

```
alice@example.local / password123
bob@example.local   / password123
```

> Studio (Postgres UI) is at `http://127.0.0.1:54323` — useful for inspecting seed
> data, testing RLS policies, and running ad-hoc queries.

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

# Create a new migration
supabase migration new add_trades_table
# Edit: supabase/migrations/<timestamp>_add_trades_table.sql
supabase db reset        # wipe + replay all migrations + seed

# Capture Studio changes back into a migration file
supabase db diff --use-migra -f my_feature_v2
supabase db reset        # validate the captured migration

# Lint before committing
supabase db lint

# End of day
supabase stop
```

> **No native down-migrations.** Write a forward-only undo migration (e.g., `_undo_add_trades_table.sql`) if rollback is needed. Always `supabase db reset` locally before pushing to remote.

---

## 9. Common Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `address already in use :54321` | Another `supabase start` running or stale container | `supabase stop && docker ps` to find stale containers |
| `supabase start` hangs indefinitely | Docker Desktop not fully started | Start Docker Desktop and wait for whale icon; then retry |
| Port 54321/54322/54323 already in use | Another local process squatting the port | `lsof -i :54321` to identify; kill the process or change ports in `config.toml` |
| Stale or incorrect schema | Migrations applied out of order or edited in-place | `supabase db reset` (nukes everything and replays cleanly) |
| Studio not loading at :54323 | Docker container crashed | `docker ps` — check `supabase_studio_*`; restart Docker Desktop if stuck |
| Auth email not received | Mailpit not checked | All local auth emails are captured at `http://127.0.0.1:54324` |
| Migration failure mid-reset | SQL error in a migration file | Read error output; check `supabase/.temp/` for detailed Postgres logs |
| `supabase link` fails 401 | Missing or expired PAT | Re-run `supabase login` or re-export `SUPABASE_ACCESS_TOKEN` (remote ops only) |
| `crypt()` not found in seed.sql | pgcrypto not loaded | `supabase db reset` installs extensions automatically; if running psql directly, `create extension if not exists pgcrypto;` |
| libpq `psql` not on PATH | Homebrew libpq not linked | `brew link --force libpq` |

> **Stale containers after a crash:** If `supabase start` fails immediately after an abrupt shutdown:
> ```bash
> supabase stop --no-backup   # force remove all containers
> supabase start
> ```

---

## 10. Login + PAT (remote ops only)

> PAT is **not** needed for local dev. Only required for `supabase link`, `supabase db push`, or CI.

- **Browser flow (interactive):**
  ```bash
  supabase login
  supabase projects list   # verify auth worked
  ```
- **Headless / CI:**
  1. Create a PAT at <https://supabase.com/dashboard/account/tokens>
  2. Export before running CLI commands:
     ```bash
     export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxx
     ```

---

## 11. Cold-Start Verification Checklist

> Run this from a **fresh terminal** after cloning the repo. If every step passes, your local stack matches what's in remote dev.

```bash
# ── 1. Preflight ────────────────────────────────────────────────────────────
docker info | grep "Server Version"   # must print a version — not an error
supabase --version                    # must be ≥ 2.95
node --version                        # must be ≥ v20
psql --version                        # must not error

# ── 2. Start stack ──────────────────────────────────────────────────────────
cd /path/to/trading-journal
supabase start
# Expected: "Started supabase local development setup."

# ── 3. Confirm ports ────────────────────────────────────────────────────────
curl -s http://127.0.0.1:54321/rest/v1/ | python3 -m json.tool
# Expected: JSON with "paths" key (PostgREST spec)

curl -s http://127.0.0.1:54323 | grep -i "supabase"
# Expected: HTML containing "supabase" (Studio)

# ── 4. Apply migrations + seed ──────────────────────────────────────────────
supabase db reset
# Expected: "Finished supabase db reset." — no ERRORs

# ── 5. Verify seed data ─────────────────────────────────────────────────────
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT email FROM auth.users ORDER BY email;"
# Expected:
#        email
# ─────────────────────
#  alice@example.local
#  bob@example.local

psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT name FROM public.households;"
# Expected: Demo Household

psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  -c "SELECT period, as_of_date FROM cooked.dashboard_summary ORDER BY as_of_date DESC LIMIT 3;"
# Expected: rows with period in (day, month, year, all)

# ── 6. pgTAP tests ──────────────────────────────────────────────────────────
supabase test db
# Expected: "No test files found" (tests land in TJ-009)
# OR if tests exist: "Tests passed: N / Tests failed: 0"

# ── 7. Frontend smoke test ──────────────────────────────────────────────────
# Copy env and start the dev server
cp apps/frontend/.env.local.example apps/frontend/.env.local
# Edit apps/frontend/.env.local — paste keys from `supabase status`

cd apps/frontend && npm run dev
# Expected: "Ready - started server on http://localhost:3000"

# In a second terminal:
curl -s http://localhost:3000 | grep -i "trading"
# Expected: HTML containing the app shell (not a 500 error page)

# ── 8. Stop cleanly ─────────────────────────────────────────────────────────
supabase stop
# Expected: "Stopped supabase local development setup."
```

✅ **If you reach this checklist's bottom, your local stack matches what's in remote dev.**

---

## 12. Cross-References

- Remote provisioning: [`runbooks/supabase-02-remote.md`](./supabase-02-remote.md) (Kujan)
- Auth + RLS schema: [`runbooks/supabase-03-auth-rls.md`](./supabase-03-auth-rls.md) (Rabin)
- Vercel side: [`runbooks/vercel-01-project.md`](./vercel-01-project.md) (Hockney)
- Broader Supabase setup narrative: [`docs/design-hosting/setup-supabase.md`](../setup-supabase.md)
- Issue: [TJ-001 (#54)](https://github.com/cohenjo/trading-journal/issues/54)
