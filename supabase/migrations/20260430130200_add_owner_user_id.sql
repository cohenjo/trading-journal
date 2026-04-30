-- Migration: 20260430130200_add_owner_user_id
-- Created: 2026-04-30
-- Author: Hockney (Backend Dev) for TJ-005 / GH #58
-- Purpose: Add owner_user_id FK to owner-private tables.
--          References auth.users(id) — enforces that data is owned by a specific
--          Supabase auth identity, enabling "owner_user_id = auth.uid()" RLS policies.
--
-- IMPORTANT — backfill required before enforcing NOT NULL:
--   Column is added nullable to allow existing rows to be backfilled. Once backfilled:
--     ALTER TABLE public.<table> ALTER COLUMN owner_user_id SET NOT NULL;
--   Enforcement deferred to TJ-006 or a dedicated backfill migration.
--
-- Fact-check: table names verified against SQLAlchemy models.
--
-- Tables covered (2):
--   note       — personal journal notes (owner-private)
--   backtestrun — backtest configuration & results (owner-private)
--
-- backtesttrade is intentionally excluded:
--   Visibility is inherited from backtestrun via JOIN (backtesttrade.run_id →
--   backtestrun.id). RLS on backtesttrade uses a subquery:
--     USING (EXISTS (SELECT 1 FROM backtestrun r
--                    WHERE r.id = backtesttrade.run_id
--                      AND r.owner_user_id = auth.uid()))
--   No direct FK column required on backtesttrade itself.

-- ----------------------------------------------------------------
-- note  (owner-private)
-- ----------------------------------------------------------------
alter table public.note
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists note_owner_user_id_idx
  on public.note (owner_user_id);

-- ----------------------------------------------------------------
-- backtestrun  (owner-private)
-- ----------------------------------------------------------------
alter table public.backtestrun
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists backtestrun_owner_user_id_idx
  on public.backtestrun (owner_user_id);

-- end of migration
