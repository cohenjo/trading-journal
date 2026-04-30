# Decision: TJ-005 — Supabase migrations are the source of truth for Phase 1 schema work

**Author:** Keaton (Lead)  
**Date:** 2026-05-01  
**Related issue:** #58 (TJ-005)

## Decision

New schema changes required for the Supabase hosting cutover (household ownership columns, audit columns) **must** be written as Supabase SQL migrations under `supabase/migrations/`, NOT as new Alembic versions.

## Rationale

- `docs/design-hosting/design.md` §4.3 establishes Supabase Postgres as schema source of truth.
- `supabase/migrations/` already has 3 migration files following the `YYYYMMDDHHMMSS_<slug>.sql` convention.
- Adding a 23rd Alembic version for household columns would create a split migration history: Alembic knows about columns that Supabase migrations don't, breaking `supabase db reset` and preview-branch reproducibility.
- Design §4.5 retains `alembic upgrade head` in CI only for FastAPI ORM model sync on the pooled connection; it does not govern hosted-schema evolution.

## Scope

- **Frozen for Phase 1 schema work:** Alembic (no new versions for household/audit columns)
- **Active for Phase 1 schema work:** `supabase/migrations/YYYYMMDDHHMMSS_*.sql`
- **Alembic future:** SQLAlchemy models should eventually be updated to match, but that is a separate task and does not block Phase 1.

## Naming convention

`YYYYMMDDHHMMSS_<descriptive_slug>.sql` — matches existing files in `supabase/migrations/`.

## Impact

- TJ-005 (Hockney) must produce a Supabase SQL migration file, not an Alembic version file.
- TJ-005 is blocked on TJ-003 (#56) completing McManus's table-ownership classification.
- Dependency chain: TJ-003 → TJ-005 → TJ-006 → TJ-007.
