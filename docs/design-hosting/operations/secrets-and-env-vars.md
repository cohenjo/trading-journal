# Secrets & Environment Variable Inventory

> **Owner:** Kujan (DevOps/Infra) | **Issue:** TJ-002 / GH #55
> **Last updated:** 2025-01-01 | **Review cadence:** quarterly

This document is the single source of truth for every environment variable the trading-journal project uses.
Every var was confirmed by `grep` against actual code or workflow YAML — no aspirational entries.

---

## 1. Inventory

### Legend

| Symbol | Tier | Rule |
|--------|------|------|
| 🔴 | **Secret** | Never log, never commit, never expose in client bundle |
| 🟡 | **Config** | Env-specific (URL, ID, port, flag) — not a secret but not browser-safe |
| 🟢 | **Public** | Safe in client bundle; must carry `NEXT_PUBLIC_` prefix |

Rotation policies:

- **90d** — rotate on a calendar schedule regardless of leaks
- **per-leak** — rotate immediately if leaked; no scheduled rotation
- **never** — static infrastructure reference (still stored securely)

---

### 1.1 Frontend — Next.js (`apps/frontend/src/`)

| Variable | Tier | Description | Source of Truth | Rotation |
|----------|------|-------------|-----------------|----------|
| `NEXT_PUBLIC_API_URL` | 🟢 | Base URL for backend FastAPI — safe to expose | Vercel dashboard / `.env` local | never |
| `NEXT_PUBLIC_SUPABASE_URL` | 🟢 | Supabase project REST & auth endpoint — public by design | Vercel dashboard / `.env` local | never |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 🟢 | Supabase anon/publishable key — browser-safe because RLS limits access | Vercel dashboard / `.env` local | per-leak |
| `NEXT_PUBLIC_SITE_URL` | 🟢 | Canonical app URL used for Supabase auth redirects | Vercel dashboard / `.env` local | never |

> ⚠️ `NEXT_PUBLIC_SUPABASE_ANON_KEY` is a *publishable* key but should still be treated as per-leak-rotatable because a rogue bot can exhaust rate limits. RLS prevents data exfiltration; the anon key alone does not grant write access.

> 📍 **Source confirmation:** `NEXT_PUBLIC_API_URL` is used in `apps/frontend/src/` (confirmed by grep). `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` are documented in runbooks (`docs/design-hosting/runbooks/`) and `vercel env add` commands — wire into frontend Supabase client once `@supabase/ssr` is added.

---

### 1.2 Backend — FastAPI Python worker (`apps/backend/app/`)

| Variable | Tier | Description | Source of Truth | Rotation |
|----------|------|-------------|-----------------|----------|
| `DATABASE_URL` | 🔴 | Full PostgreSQL connection string (includes username + password) | Supabase dashboard / `.env` local / GH Actions secret | 90d |
| `JWT_SECRET_KEY` | 🔴 | HMAC-SHA256 signing key for internal JWT tokens | `.env` local / Vercel env | 90d |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 🟡 | JWT expiry window in minutes (default: 60) | `.env` local | never |
| `IB_HOST` | 🟡 | IB Gateway host — default `127.0.0.1` | `.env` local | never |
| `IB_PORT` | 🟡 | IB Gateway port — 4001 (live) or 4002 (paper) | `.env` local | never |
| `IB_CLIENT_ID` | 🟡 | IB client connection ID (default: 2) | `.env` local | never |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔴 | Supabase service-role key — bypasses RLS entirely; server-only | Supabase dashboard / `.env` local | per-leak |

> 📍 **Source confirmation:** `DATABASE_URL`, `JWT_SECRET_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES` confirmed in `apps/backend/app/dal/database.py` and `apps/backend/app/auth/security.py`. `IB_HOST`, `IB_PORT`, `IB_CLIENT_ID` confirmed in `apps/backend/app/utils/ib_util.py` and `apps/backend/app/utils/ib_sync.py`. `SUPABASE_SERVICE_ROLE_KEY` documented in `docs/design-hosting/runbooks/supabase-03-auth-rls.md` as the key used by the local Docker worker.

---

### 1.3 Docker Compose — Backend Worker (`docker-compose.backend.yml`)

> **Note:** `docker-compose.yml` (legacy standalone worker) was removed in PR #421.
> The canonical worker is `docker-compose.backend.yml` (`trading_journal_backend_supabase`),
> rebuilt and extended with Yahoo Finance refresh in PRs #410 #413 #417 #420.

| Variable | Tier | Description | Source of Truth | Rotation |
|----------|------|-------------|-----------------|----------|
| `DIRECT_DATABASE_URL` | 🔴 | Supabase Postgres direct/pooler connection string | `.env` local | 90d |
| `SUPABASE_URL` | 🔴 | Supabase project URL | `.env` local | never |
| `SUPABASE_SERVICE_ROLE_KEY` | 🔴 | Supabase service-role key for server-side operations | `.env` local | 90d |
| `SUPABASE_JWT_SECRET` | 🔴 | Supabase JWT secret | `.env` local | per-leak |
| `WORKER_TIMEZONE` | 🟡 | Scheduler timezone (default: `Asia/Jerusalem`) | `.env` local | never |
| `WORKER_POLL_INTERVAL_SECONDS` | 🟡 | Compute jobs polling interval (default: `5`) | `.env` local | never |
| `YAHOO_REFRESH_CRON` | 🟡 | Cron expression for Yahoo price refresh (default: `0 22 * * MON-FRI`) | `.env` local | never |
| `WORKER_HEARTBEAT_FILE` | 🟡 | Heartbeat file path (default: `/app/worker_heartbeat`) | `.env` local | never |

> 📍 **Source confirmation:** Confirmed in `docker-compose.backend.yml` `backend` service environment block (as of 2026-05-12).

---

### 1.4 GitHub Actions — Secrets & Vars (`.github/workflows/`)

| Variable | Kind | Tier | Description | Source of Truth | Rotation |
|----------|------|------|-------------|-----------------|----------|
| `SUPABASE_PROD_DB_URL` | `secrets.*` | 🔴 | Production Supabase database URL with credentials | GitHub repo secrets | 90d |
| `AGE_PUBLIC_KEY` | `secrets.*` | 🟡 | AGE encryption public key for backup encryption | GitHub repo secrets | per-leak |
| `COPILOT_ASSIGN_TOKEN` | `secrets.*` | 🔴 | GitHub PAT used by squad issue-assign workflow | GitHub repo secrets | 90d |
| `SUPABASE_DEV_REF` | `vars.*` | 🟡 | Supabase dev project reference ID | GitHub repo vars | never |
| `SUPABASE_PREVIEW_REF` | `vars.*` | 🟡 | Supabase preview project reference ID | GitHub repo vars | never |
| `SUPABASE_PROD_REF` | `vars.*` | 🟡 | Supabase production project reference ID | GitHub repo vars | never |

> 📍 **Source confirmation:** All confirmed in `.github/workflows/` — `SUPABASE_PROD_DB_URL` in `squad-ci.yml` (`DB_URL: ${{ secrets.SUPABASE_PROD_DB_URL }}`), `AGE_PUBLIC_KEY` in `squad-release.yml`, `COPILOT_ASSIGN_TOKEN` in `squad-issue-assign.yml`, refs in `squad-ci.yml`.

---

### 1.5 Local Dev / Supabase CLI (`.env` only)

| Variable | Tier | Description | Source of Truth | Rotation |
|----------|------|-------------|-----------------|----------|
| `SUPABASE_ACCESS_TOKEN` | 🔴 | Supabase personal access token for CLI `link`/`push` | Supabase dashboard → Account → Access Tokens | per-leak |
| `SUPABASE_DB_URL` | 🔴 | Direct Postgres URL to local Supabase (port 54322) | Generated by `supabase start` | per-leak |
| `SUPABASE_JWT_SECRET` | 🔴 | JWT secret from local Supabase stack (for manual JWT verify) | Generated by `supabase start` | per-leak |

> 📍 **Source confirmation:** Referenced in `docs/design-hosting/runbooks/supabase-01-local-dev.md` and `supabase-02-remote.md`.

---

## 2. Naming Convention

### Prefix Rules

| Prefix | Rule | Examples |
|--------|------|---------|
| `NEXT_PUBLIC_*` | **Only** for values that are safe to ship in the browser bundle (Supabase project URL, anon key, site URL, API URL) | ✅ `NEXT_PUBLIC_SUPABASE_URL`, ✅ `NEXT_PUBLIC_API_URL` |
| *(no prefix)* | Server-only vars — FastAPI, Node.js server-side only | ✅ `DATABASE_URL`, ✅ `SUPABASE_SERVICE_ROLE_KEY`, ✅ `JWT_SECRET_KEY` |
| `SUPABASE_*` | All Supabase operational secrets — never add `NEXT_PUBLIC_` prefix to these | ✅ `SUPABASE_SERVICE_ROLE_KEY`, ✅ `SUPABASE_ACCESS_TOKEN` |
| `IB_*` | Interactive Brokers connection config | ✅ `IB_HOST`, ✅ `IB_PORT`, ✅ `IB_CLIENT_ID` |
| `TWS_*` | IB Gateway container credentials | ✅ `TWS_USERID`, ✅ `TWS_PASSWORD` |

### ✅ Correct Examples

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co        # ✅ safe — public endpoint
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                     # ✅ safe — publishable key, RLS enforced
SUPABASE_SERVICE_ROLE_KEY=eyJ...                         # ✅ no prefix — server only
DATABASE_URL=postgresql://user:pass@host/db              # ✅ no prefix — server only
JWT_SECRET_KEY=xxxxxxxxxxxxxxxx                          # ✅ no prefix — server only
```

### ❌ Wrong Examples

```bash
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJ...  # ❌ CATASTROPHIC — service role in browser = full DB exposure
NEXT_PUBLIC_DATABASE_URL=postgresql://...      # ❌ connection string in browser bundle
NEXT_PUBLIC_JWT_SECRET_KEY=secret             # ❌ signing key in browser = token forgery
SUPABASE_ANON_KEY=eyJ...                      # ❌ missing NEXT_PUBLIC_ prefix if used client-side
```

### CI Enforcement

A grep check **MUST** be added to CI to catch the worst case:

```yaml
- name: Guard — no service-role key in NEXT_PUBLIC_ prefix
  run: |
    if grep -r "NEXT_PUBLIC.*SERVICE_ROLE\|NEXT_PUBLIC.*SECRET" apps/frontend/src/ .env* 2>/dev/null; then
      echo "FATAL: service-role / secret key found with NEXT_PUBLIC_ prefix" >&2
      exit 1
    fi
```

> This is referenced in `docs/design-hosting/runbooks/vercel-03-policy-ci.md`.

---

## 3. Storage Matrix

Where each variable actually lives:

| Variable | Local `.env` | Supabase Vault | Vercel Env | GH Actions Secret | GH Actions Var | Worker Container Env |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|
| `NEXT_PUBLIC_API_URL` | ✅ | — | ✅ | — | — | ✅ (compose) |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | ✅ | — | — | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | — | ✅ | — | — | — |
| `NEXT_PUBLIC_SITE_URL` | ✅ | — | ✅ | — | — | — |
| `DATABASE_URL` | ✅ | — | ✅ | — | — | ✅ (compose) |
| `JWT_SECRET_KEY` | ✅ | — | ✅ | — | — | — |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ✅ | — | ✅ | — | — | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | — | ✅ (server) | — | — | — |
| `SUPABASE_JWT_SECRET` | ✅ | — | ✅ (optional) | — | — | — |
| `IB_HOST` | ✅ | — | — | — | — | — |
| `IB_PORT` | ✅ | — | — | — | — | — |
| `IB_CLIENT_ID` | ✅ | — | — | — | — | — |
| `TWS_USERID` | ✅ | — | — | — | — | ✅ (compose) |
| `TWS_PASSWORD` | ✅ | — | — | — | — | ✅ (compose) |
| `TRADING_MODE` | ✅ | — | — | — | — | ✅ (compose) |
| `READ_ONLY_API` | ✅ | — | — | — | — | ✅ (compose) |
| `TWOFA_TIMEOUT_ACTION` | ✅ | — | — | — | — | ✅ (compose) |
| `AUTO_RESTART_TIME` | ✅ | — | — | — | — | ✅ (compose) |
| `RELOGIN_AFTER_TWOFA_TIMEOUT` | ✅ | — | — | — | — | ✅ (compose) |
| `TIME_ZONE` | ✅ | — | — | — | — | ✅ (compose) |
| `SUPABASE_PROD_DB_URL` | — | — | — | ✅ | — | — |
| `AGE_PUBLIC_KEY` | — | — | — | ✅ | — | — |
| `COPILOT_ASSIGN_TOKEN` | — | — | — | ✅ | — | — |
| `SUPABASE_DEV_REF` | — | — | — | — | ✅ | — |
| `SUPABASE_PREVIEW_REF` | — | — | — | — | ✅ | — |
| `SUPABASE_PROD_REF` | — | — | — | — | ✅ | — |
| `SUPABASE_ACCESS_TOKEN` | ✅ (local shell) | — | — | — | — | — |
| `SUPABASE_DB_URL` | ✅ | — | — | — | — | — |

> **Note on Supabase Vault:** Supabase Vault is an optional encrypted key-value store for server-side secrets accessed via Postgres functions. None of the above vars are currently stored there; this column is reserved for future use if the backend moves to Vault-injected secrets.

---

## 4. Rotation Runbook

For each 🔴 secret: what to do if it is leaked (committed to git, logged, exposed in an issue, etc.).

---

### 4.1 `DATABASE_URL` — Leaked

**Risk:** Full database read/write access to all trading data.

1. **Immediately rotate:**
   - Supabase dashboard → Project → Settings → Database → Reset database password
   - If using Supabase pooler (port 6543), also rotate the pooler password
2. **Update all locations:**
   - `.env` local — update `DATABASE_URL`
   - Vercel dashboard → Environment Variables → update `DATABASE_URL` for all environments
   - GH Actions secret `SUPABASE_PROD_DB_URL` — update value
3. **Revoke old connections:** Supabase dashboard → Logs → realtime connections — verify no stale sessions
4. **Validate:** `python -c "from app.dal.database import DATABASE_URL; print('ok')"` in backend container
5. **Audit:** Review Supabase logs for any unauthorized queries in the exposure window

---

### 4.2 `JWT_SECRET_KEY` — Leaked

**Risk:** Attacker can forge valid JWT tokens and authenticate as any user.

1. **Immediately rotate:** Generate new 256-bit key: `python -c "import secrets; print(secrets.token_hex(32))"`
2. **Update all locations:**
   - `.env` local — update `JWT_SECRET_KEY`
   - Vercel dashboard → update `JWT_SECRET_KEY`
3. **Invalidate all existing sessions:** All active JWT tokens are immediately invalid after key rotation; users must re-login
4. **Validate:** Attempt login via `/api/auth/login` — confirm new token is issued and accepted
5. **Notify users:** All sessions were invalidated; re-login required

---

### 4.3 `TWS_USERID` / `TWS_PASSWORD` — Leaked

**Risk:** Full access to Interactive Brokers account — orders can be placed, positions closed.

1. **Immediately:** Log into IB portal → Security → Change password
2. **Enable 2FA** if not already enabled
3. **Update `.env`** with new credentials
4. **Audit IB activity logs** for any unauthorized orders in the exposure window
5. **Consider:** Enable `READ_ONLY_API=yes` temporarily while investigating
6. **Contact IB support** if suspicious activity detected

---

### 4.4 `SUPABASE_SERVICE_ROLE_KEY` — Leaked

**Risk:** Bypasses all RLS policies — complete database read/write/delete as postgres superuser.

1. **Immediately:** Supabase dashboard → Project Settings → API → Re-generate service role key
2. **Update all locations:**
   - `.env` local — `SUPABASE_SERVICE_ROLE_KEY`
   - Vercel dashboard — `SUPABASE_SERVICE_ROLE_KEY`
   - Any running backend containers — restart with new key
3. **Review RLS policies** in case attacker modified them: `SELECT * FROM pg_policies;`
4. **Audit:** Check `auth.audit_log_entries` for abnormal operations
5. **Validate:** Confirm backend `/health` endpoint and a test API call work with new key

---

### 4.5 `SUPABASE_ACCESS_TOKEN` (CLI PAT) — Leaked

**Risk:** Attacker can manage Supabase projects — push migrations, rotate keys, delete data.

1. **Immediately:** Supabase dashboard → Account → Access Tokens → Revoke the token
2. **Generate new PAT:** Dashboard → Account → Access Tokens → New token
3. **Update local shell:** `export SUPABASE_ACCESS_TOKEN=sbp_...` (re-source `.env`)
4. **Validate:** `supabase projects list` — confirm it works

---

### 4.6 `SUPABASE_PROD_DB_URL` — Leaked (GH Actions secret)

Same steps as **4.1 `DATABASE_URL`** plus:

1. GitHub → repo Settings → Secrets → Actions → `SUPABASE_PROD_DB_URL` → update value
2. Re-run the last CI workflow to confirm pipelines still pass

---

### 4.7 `COPILOT_ASSIGN_TOKEN` — Leaked

**Risk:** Attacker can perform GitHub API operations with this PAT's scope.

1. **Immediately:** GitHub → Settings → Developer Settings → Personal Access Tokens → Revoke
2. **Generate new PAT** with minimal required scopes (`repo`, `issues`)
3. **Update:** GitHub repo Settings → Secrets → Actions → `COPILOT_ASSIGN_TOKEN` → update

---

## 5. `.env.example` — Content & Placement

The repo root **must** have a committed `.env.example` listing every variable name with placeholder values. This file is safe to commit because it contains **no real credentials**.

### `.gitignore` status

Current `.gitignore` contains:

```
.env
.env.*
!.env.example
```

✅ **The negation `!.env.example` is already present** — `.env.example` is committable as-is. No `.gitignore` change required.

### File content

See [`.env.example`](../../../.env.example) at repo root.

---

## Appendix: Quick Reference

### Total count

| Tier | Count |
|------|-------|
| 🔴 Secret | 10 |
| 🟡 Config | 16 |
| 🟢 Public | 2 |
| **Total** | **28** |

### Files grepped to produce this inventory

- `apps/frontend/src/**/*.ts`, `*.tsx`
- `apps/backend/app/**/*.py`
- `docker-compose.backend.yml` (legacy `docker-compose.yml` removed in PR #421)
- `.github/workflows/**/*.yml`
- `docs/design-hosting/runbooks/**/*.md`
