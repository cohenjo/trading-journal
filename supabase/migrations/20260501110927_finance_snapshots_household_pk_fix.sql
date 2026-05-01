-- ================================================================
-- Migration: Align finance_snapshots with household_id canonical pattern
-- Context: Wave2 migration (20260501022922) added user_id column with user-scoped RLS.
--          But the canonical pattern (holdings, dividends, etc.) uses household_id.
--          Migration 20260430130100 already added household_id column.
--          Migration 20260430160200 already added household-scoped RLS using household_id.
--          Wave2 migration dropped the original finance_snapshots_pkey constraint.
-- Fix: 1. Drop user_id column and user-based RLS (from wave2)
--      2. Backfill household_id from user profiles where needed
--      3. Set household_id NOT NULL
--      4. Create composite PK on (household_id, date)
-- ================================================================

-- Step 1: Drop wave2's user_id-based policies (replaced by household-based in 160200)
-- These were created in 20260501022922_wave2_insurance_pension_user_scoping.sql
DROP POLICY IF EXISTS finance_snapshots_select_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_insert_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_update_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_delete_own ON public.finance_snapshots;

-- Step 2: Drop the partial unique index from wave2 (user_id, date)
DROP INDEX IF EXISTS public.finance_snapshots_user_date_key;

-- Step 3: Backfill household_id from user_id where possible (if user_id column exists)
-- If row has user_id but not household_id, look up user's default_household_id
-- Note: user_profile.id is the auth user ID, not user_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'finance_snapshots' 
    AND column_name = 'user_id'
  ) THEN
    UPDATE public.finance_snapshots fs
    SET household_id = up.default_household_id
    FROM public.user_profile up
    WHERE fs.user_id = up.id
      AND fs.household_id IS NULL
      AND up.default_household_id IS NOT NULL;
  END IF;
END $$;

-- Step 4: Delete orphaned rows (no household_id and cannot be backfilled)
DELETE FROM public.finance_snapshots WHERE household_id IS NULL;

-- Step 5: Drop user_id column (no longer needed with household-scoped RLS)
ALTER TABLE public.finance_snapshots
  DROP COLUMN IF EXISTS user_id;

-- Step 6: Drop old index on user_id (if it exists from wave2)
DROP INDEX IF EXISTS public.idx_finance_snapshots_user_id;

-- Step 7: Make household_id NOT NULL
ALTER TABLE public.finance_snapshots
  ALTER COLUMN household_id SET NOT NULL;

-- Step 8: Create composite PK on (household_id, date)
-- Idempotent: only add if doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'finance_snapshots_pkey' 
    AND conrelid = 'public.finance_snapshots'::regclass
  ) THEN
    ALTER TABLE public.finance_snapshots
      ADD CONSTRAINT finance_snapshots_pkey PRIMARY KEY (household_id, date);
  END IF;
END $$;

-- Note: Household-scoped RLS policies already created in 20260430160200_enable_rls_on_public_tables.sql
-- using is_household_member() and is_household_writer() helpers.
