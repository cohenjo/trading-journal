-- ================================================================
-- Migration: Align insurance_policies with household_id canonical pattern
-- Context: Wave2 migration (20260501022922) added user_id column with user-scoped RLS.
--          But the canonical pattern (holdings, dividends, finances, etc.) uses household_id.
--          Migration 20260430130100 already added household_id column.
--          Migration 20260430160200 already added household-scoped RLS using household_id.
--          Wave2 migration added user_id-based RLS.
-- Fix: 1. Drop user_id column and user-based RLS (from wave2)
--      2. Backfill household_id from user profiles where needed
--      3. Set household_id NOT NULL
-- ================================================================

-- Step 1: Drop wave2's user_id-based policies (replaced by household-based in 160200)
-- These were created in 20260501022922_wave2_insurance_pension_user_scoping.sql
DROP POLICY IF EXISTS insurance_policies_select_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_insert_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_update_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_delete_own ON public.insurance_policies;

-- Step 2: Backfill household_id from user_id where possible (if user_id column exists)
-- If row has user_id but not household_id, look up user's default_household_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'insurance_policies' 
    AND column_name = 'user_id'
  ) THEN
    UPDATE public.insurance_policies ip
    SET household_id = up.default_household_id
    FROM public.user_profile up
    WHERE ip.user_id::uuid = up.id
      AND ip.household_id IS NULL
      AND up.default_household_id IS NOT NULL;
  END IF;
END $$;

-- Step 3: Delete orphaned rows (no household_id and cannot be backfilled)
DELETE FROM public.insurance_policies WHERE household_id IS NULL;

-- Step 4: Drop user_id column (no longer needed with household-scoped RLS)
ALTER TABLE public.insurance_policies
  DROP COLUMN IF EXISTS user_id;

-- Step 5: Drop old index on user_id (if it exists from wave2)
DROP INDEX IF EXISTS public.idx_insurance_policies_user_id;

-- Step 6: Make household_id NOT NULL
ALTER TABLE public.insurance_policies
  ALTER COLUMN household_id SET NOT NULL;

-- Note: Household-scoped RLS policies already created in 20260430160200_enable_rls_on_public_tables.sql
-- using is_household_member() and is_household_writer() helpers.
