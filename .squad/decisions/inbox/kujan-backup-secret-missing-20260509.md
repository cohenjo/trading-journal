# Decision: Nightly Backup Secret Missing — Operational Blocker (2026-05-09)

**Filed by:** Kujan (DevOps)
**Date:** 2026-05-09
**Related issues:** #326, #329, #331, #333

## Finding

The `SUPABASE_PROD_DB_URL` GitHub Actions secret is empty or not set.
Every nightly backup run since at least 2026-05-01 fails at `pg_dump` with a Unix socket fallback error (empty `--dbname`).

## Decision

No workflow code change is warranted. The PGDG APT pinning in #271 was the right fix for
the postgresql-client availability issue and is still correct. The pipeline itself is sound.

## Required Action (Jony)

1. Set `SUPABASE_PROD_DB_URL` in GitHub repo Secrets with a valid direct Supabase URL (port 5432).
2. If the Supabase free-tier project is paused, restore it first.
3. Manually trigger `nightly-backup.yml` to verify.
4. Close issues #326, #329, #331, #333 once confirmed working.

## Implication for Team

If we ever add more secrets-dependent workflows, add a `secrets-lint` step that does a
non-empty check on required env vars and fails fast with a human-readable message rather
than a cryptic socket error. Consider adding this to nightly-backup.yml as step 0.
