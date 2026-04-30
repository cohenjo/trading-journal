-- Migration: 20260430140000_create_schemas.sql
-- TJ-006: Establish raw / compute / cooked schema namespaces
-- McManus (Data/Finance Dev)
--
-- Schema ownership model:
--   raw     — immutable ingestion landing zones; service_role reads/writes only
--   compute — intermediate workspace for local Docker jobs; service_role only
--   cooked  — UI-optimised summaries; service_role writes, authenticated reads via RLS
--   public  — app schema (households, members, app tables); unchanged here
--
-- Idempotent: CREATE SCHEMA IF NOT EXISTS; REVOKE/GRANT are safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema creation
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists raw;
create schema if not exists compute;
create schema if not exists cooked;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Schema-level access controls
--
-- raw / compute: service_role only.
--   authenticated must never query landing-zone or intermediate tables
--   directly; all client reads go through RLS-protected cooked tables.
--
-- cooked: authenticated may SELECT (row-level enforcement via RLS policies
--   applied in 20260430140300_cooked_tables.sql); service_role may do all.
--
-- public (app schema): Supabase default grants remain unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- Lock raw and compute away from the PUBLIC pseudo-role (includes authenticated, anon)
revoke all on schema raw     from public;
revoke all on schema compute from public;
revoke all on schema cooked  from public;

-- Give service_role schema access to all three internal schemas
grant usage on schema raw     to service_role;
grant usage on schema compute to service_role;

-- Cooked is UI-readable: authenticated users get schema USAGE;
-- individual table SELECTs are governed by per-table RLS policies.
grant usage on schema cooked to authenticated;
grant usage on schema cooked to service_role;

-- end of migration
