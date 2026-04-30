-- Wave 2: User-scope insurance_policies and finance_snapshots (pension data)
-- Issues: #108 (insurance), #109 (pension)
-- Author: Hockney (Backend Dev)

-- =============================================================================
-- Part 1: insurance_policies — Add user_id column + RLS
-- =============================================================================

-- Add user_id column to insurance_policies
ALTER TABLE public.insurance_policies
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_insurance_policies_user_id ON public.insurance_policies(user_id);

-- Enable RLS
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotency)
DROP POLICY IF EXISTS insurance_policies_select_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_insert_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_update_own ON public.insurance_policies;
DROP POLICY IF EXISTS insurance_policies_delete_own ON public.insurance_policies;

-- RLS Policies: Users can only access their own insurance policies
CREATE POLICY insurance_policies_select_own ON public.insurance_policies
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY insurance_policies_insert_own ON public.insurance_policies
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY insurance_policies_update_own ON public.insurance_policies
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY insurance_policies_delete_own ON public.insurance_policies
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- Part 2: finance_snapshots — Change PK from (date) to (user_id, date) + RLS
-- =============================================================================

-- Step 1: Drop existing primary key constraint
ALTER TABLE public.finance_snapshots DROP CONSTRAINT IF EXISTS finance_snapshots_pkey CASCADE;

-- Step 2: Add user_id column (nullable initially for backfill)
ALTER TABLE public.finance_snapshots
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 3: Backfill existing rows with NULL user_id (will need manual cleanup)
-- Note: In production, you'd set a default user or migrate existing data properly
-- For now, we'll leave existing rows with NULL user_id, which will be inaccessible via RLS

-- Step 4: Create new composite primary key (user_id, date)
-- We need to make user_id NOT NULL for new rows, but keep existing NULL rows for now
-- Create a partial unique index for new rows
CREATE UNIQUE INDEX IF NOT EXISTS finance_snapshots_user_date_key 
  ON public.finance_snapshots(user_id, date) 
  WHERE user_id IS NOT NULL;

-- Note: Cannot add PK constraint if existing rows have NULL user_id
-- This migration allows new rows to use (user_id, date) as composite key
-- Existing NULL user_id rows will need manual migration in a follow-up ticket

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_finance_snapshots_user_id ON public.finance_snapshots(user_id);

-- Enable RLS
ALTER TABLE public.finance_snapshots ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotency)
DROP POLICY IF EXISTS finance_snapshots_select_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_insert_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_update_own ON public.finance_snapshots;
DROP POLICY IF EXISTS finance_snapshots_delete_own ON public.finance_snapshots;

-- RLS Policies: Users can only access their own finance snapshots
CREATE POLICY finance_snapshots_select_own ON public.finance_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY finance_snapshots_insert_own ON public.finance_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY finance_snapshots_update_own ON public.finance_snapshots
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY finance_snapshots_delete_own ON public.finance_snapshots
  FOR DELETE USING (auth.uid() = user_id);

-- =============================================================================
-- Notes for follow-up:
-- =============================================================================
-- 1. Existing finance_snapshots rows with NULL user_id are inaccessible via RLS
-- 2. A follow-up migration should either:
--    a) Assign a default user_id to historical snapshots
--    b) Delete orphaned snapshots
--    c) Create a separate archive table for legacy data
-- 3. Once all rows have user_id, convert the unique index to a proper PK constraint
