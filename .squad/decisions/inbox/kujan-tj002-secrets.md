# Decision: TJ-002 Secrets Management Approach

**Author:** Kujan (DevOps/Infra)  
**Date:** 2025-01-01  
**Issue:** TJ-002 / GH #55  
**Status:** Proposed — awaiting Scribe merge

---

## Context

TJ-002 required a secrets management plan and env var inventory. Grepping the codebase confirmed 28 environment variables across frontend, backend, Docker Compose, and GitHub Actions.

## Decisions Made

### 1. Single inventory document as source of truth

All env vars are documented in `docs/design-hosting/operations/secrets-and-env-vars.md` with tier, source of truth, and rotation policy. This replaces scattered references in individual runbooks.

### 2. `NEXT_PUBLIC_*` prefix = browser-safe only

Only 3 categories belong under `NEXT_PUBLIC_`: project URL, anon key, and site URL. Everything else (service role key, JWT secret, database URL) must never carry this prefix. A CI guard is documented.

### 3. `.env.example` at repo root, not per-service

A single repo-root `.env.example` is the canonical template for all vars. Per-service `.env.example` files are redundant and create drift risk. `.gitignore` already had `!.env.example` — no change needed.

### 4. Rotation policy by tier

- 🔴 Secrets with credentials (`DATABASE_URL`, `JWT_SECRET_KEY`, `COPILOT_ASSIGN_TOKEN`, `SUPABASE_PROD_DB_URL`): **90-day rotation**
- 🔴 Secrets that are credential-based but exposure-triggered (`TWS_USERID/PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, PAT, local Supabase vars): **per-leak only**
- 🟡 Config vars: **never rotated** (not secrets)

### 5. Supabase Vault deferred

None of the current vars are stored in Supabase Vault. This is reserved for future consideration once the backend is deployed to a persistent server (not just local Docker).

## Impact on Other Members

- **Fenster:** When wiring `@supabase/ssr`, use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` exactly as named. Do not invent new names.
- **Hockney:** Backend must consume `SUPABASE_SERVICE_ROLE_KEY` (no prefix). Confirm this in `app/dal/` once Supabase replaces local Postgres.
- **Rabin:** CI guard for `NEXT_PUBLIC_*SERVICE_ROLE*` grep check should be added to `pr-frontend.yml`.
