# Kujan R2 — secrets audit + CI migrations — 2026-05-05

## Task A — #162 secrets audit

### Findings

Root cause: the three E2E Supabase secrets were absent during the 03:00 UTC nightly run on 2026-05-03 because they had been rotated and not yet re-added. The secrets were recreated later that morning (07:40–08:01 UTC).

| Secret | Status | Recreated |
|--------|--------|-----------|
| `E2E_SUPABASE_URL` | ✅ Set | 2026-05-03 07:40 UTC |
| `E2E_SUPABASE_ANON_KEY` | ✅ Set | 2026-05-03 07:40 UTC |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | ✅ Set | 2026-05-03 08:01 UTC |

All three secrets are repo-scoped (not environment-gated). Secret names in `playwright-e2e.yml` match exactly. No scope misconfiguration found.

### Action

- Commented on #162 with audit findings.
- Added fail-fast guard step to all three E2E jobs (`e2e-smoke`, `e2e-full`, `e2e-dispatch`) in `playwright-e2e.yml`. Guard emits `::error::` annotations naming each missing secret and exits 1 before installing Node — prevents full suite running to red on a config failure.
- PR #274 (`squad/162-e2e-secrets-guard`) opened.
- Issue #162 **closed**.

## Task B — #170 CI migrations

### Approach

Created `.github/workflows/supabase-migrations.yml`.

**Trigger logic:**

| Event | Behaviour |
|-------|-----------|
| `push` to `main` + `[apply-migrations]` commit marker | Apply |
| `push` to `main` without marker | Diff only (safe default) |
| `workflow_dispatch` dry_run=false | Apply |
| `workflow_dispatch` dry_run=true | Diff only |

**Safety guards:**
- Secrets guard (same pattern as #274) — fails fast if `SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_PASSWORD` are missing.
- `supabase migration list --linked` diff always shown before any apply.
- `concurrency: cancel-in-progress: false` — prevents two migration runs overlapping.
- Uses `supabase db push --linked` (direct connection via Supabase CLI, not the PgBouncer pooler) — consistent with decisions.md connection string strategy.

**Required secrets:** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.

### Design choice: opt-in marker vs always-auto-apply

Chose the `[apply-migrations]` marker rather than always-auto-apply. Rationale: not every merge that touches migration files should immediately hit prod (e.g. draft work, squash merges). The marker is a deliberate, visible signal in git history. Emergency apply remains available via `workflow_dispatch` with zero friction.

### PR

PR #275 (`squad/170-ci-auto-migrations`) opened.
