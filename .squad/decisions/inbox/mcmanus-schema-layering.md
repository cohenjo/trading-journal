# Decision: Schema Layering for raw / compute / cooked

**Author:** McManus (Data/Finance Dev)  
**Issue:** TJ-006 / GH #59  
**Date:** 2026-04-30  
**Status:** Implemented

## Decision

Established three schema namespaces in Supabase Postgres alongside the existing `public` app schema:

- **`raw`** — append-only ingestion landing zones. service_role reads/writes; `authenticated` has no schema USAGE.
- **`compute`** — intermediate workspace owned by local Docker jobs. service_role only.
- **`cooked`** — UI-ready, denormalized, RLS-protected tables. service_role writes; `authenticated` reads via `is_household_member()` RLS.

## Key sub-decisions

### `_freshness_seconds` as a VIEW column, not a generated column

`GENERATED ALWAYS AS (extract(epoch from now() - _computed_at)::int) STORED` fails on PostgreSQL 15 because `now()` is `STABLE`, not `IMMUTABLE`. Generated stored columns require IMMUTABLE expressions.

**Resolution:** Each cooked table has a companion `<table>_live` view that projects `_freshness_seconds` dynamically at query time:
```sql
extract(epoch from now() - _computed_at)::int as _freshness_seconds
```
PG 15+ views are `SECURITY INVOKER` by default, so RLS on the base table applies automatically when the view is queried. Clients should query `_live` views, not base tables, when the freshness field is needed. TJ-020 should surface the `_live` views through the API layer.

### `uploaded_by` references `auth.users(id)`, not `public.users(id)`

`public.users` does not yet exist in any migration (it is listed as PLANNED in `docs/design-hosting/data/table-ownership.md`). `raw.broker_statements.uploaded_by` references `auth.users(id)` directly. When a `public.users` migration lands, a follow-up migration should add the FK reference update.

### Cooked tables are skeletons

Domain columns (amounts, rates, counts) are deferred to TJ-011 (compute worker) and TJ-020 (dashboard reads). This migration establishes only: household_id FK, primary key, indexes, RLS policies, and `_computed_at`. All numeric payload data lives in a placeholder `jsonb` column until those issues land.

### Schema access model

| Role | raw | compute | cooked | public |
|------|-----|---------|--------|--------|
| `service_role` | full | full | full | full |
| `authenticated` | none | none | SELECT (RLS) | SELECT+INSERT+UPDATE |
| `anon` | none | none | none | limited |

## Affected files

- `supabase/migrations/20260430140000_create_schemas.sql`
- `supabase/migrations/20260430140100_raw_tables.sql`
- `supabase/migrations/20260430140200_compute_tables.sql`
- `supabase/migrations/20260430140300_cooked_tables.sql`
- `supabase/migrations/README.md` (Migration Order section updated)

## Cross-references

- TJ-003 / GH #56 — table-ownership.md: classification that drove which tables land in which schema
- TJ-011 — compute worker: will expand cooked domain columns
- TJ-020 — dashboard reads: will finalise cooked column shapes and surface `_live` views via API
