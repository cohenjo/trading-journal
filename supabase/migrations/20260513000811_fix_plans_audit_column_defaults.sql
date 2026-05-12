-- Migration: 20260513000811_fix_plans_audit_column_defaults
-- Created: 2026-05-13
-- Author: Hockney (Backend Dev) — GH #440
-- Purpose: Add missing DEFAULT now() to plans.created_at and plans.updated_at,
--          and extend the tg_update_timestamp trigger to fire on INSERT as well
--          as UPDATE so updated_at is always DB-managed.
--
-- Root cause: 20260430115000_baseline_legacy_schema.sql created plans with
--   created_at timestamptz NOT NULL  (no DEFAULT)
--   updated_at timestamptz NOT NULL  (no DEFAULT)
--
-- 20260430130000_add_audit_columns.sql then attempted:
--   ALTER TABLE public.plans
--     ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
--     ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
--
-- Postgres silently no-ops the entire ADD COLUMN when the column already exists —
-- INCLUDING the DEFAULT clause. The column default was never applied.
-- Confirmed via pg_attrdef: column_default IS NULL for both columns.
-- Result: every INSERT via createPlan() threw a NOT NULL violation; plans table
-- stayed at 0 rows; /cash-flow (which derives all data from getLatestPlan())
-- rendered blank.
--
-- Fix:
--   1. SET DEFAULT now() on both columns (idempotent — safe to run twice).
--   2. Recreate trg_plans_updated_at to fire on BEFORE INSERT OR UPDATE
--      so updated_at is always set by the DB, preventing the same class of bug.
--
-- Worker rebuild: NOT required.
-- Downstream: /cash-flow will recover automatically once plans can be inserted.

-- ----------------------------------------------------------------
-- 1. Add missing column defaults
-- ----------------------------------------------------------------
alter table public.plans alter column created_at set default now();
alter table public.plans alter column updated_at set default now();

-- ----------------------------------------------------------------
-- 2. Extend trigger to fire on INSERT OR UPDATE
--    (was: BEFORE UPDATE only — created_at/updated_at were never touched on INSERT)
-- ----------------------------------------------------------------
drop trigger if exists trg_plans_updated_at on public.plans;
create trigger trg_plans_updated_at
  before insert or update on public.plans
  for each row execute function public.tg_update_timestamp();
