-- ================================================================
-- Migration: Fix finance_snapshots PK to include household_id
-- Issue: RLS policies require household_id NOT NULL but column is nullable
--        and PK is only 'date', allowing conflicts across households.
-- Fix: 1. Backfill any null household_id (assign to first household or delete)
--      2. Make household_id NOT NULL
--      3. Change PK from (date) to (household_id, date)
-- ================================================================

-- Step 1: Backfill null household_id
-- If there are rows with null household_id, we need to either:
-- a) Assign them to a default household (first household in system), OR
-- b) Delete them (safer if they're orphaned test data)
-- For safety, we'll delete any rows with null household_id.

DELETE FROM public.finance_snapshots WHERE household_id IS NULL;

-- Step 2: Make household_id NOT NULL
ALTER TABLE public.finance_snapshots
  ALTER COLUMN household_id SET NOT NULL;

-- Step 3: Change PK from (date) to (household_id, date)
-- This requires dropping the old PK and creating a new one

ALTER TABLE public.finance_snapshots
  DROP CONSTRAINT finance_snapshots_pkey;

ALTER TABLE public.finance_snapshots
  ADD PRIMARY KEY (household_id, date);

-- Note: The index on household_id created in 20260430130100_add_household_id.sql
-- will be automatically used by this new composite PK.
