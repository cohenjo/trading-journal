-- ================================================================
-- Migration: backfill_placeholder_account_households
-- Issue: #354 — Schwab/LeumiIRA rows had NULL household_id; RLS hid them
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-11
-- ================================================================
--
-- Backfill household_id for placeholder Schwab and LeumiIRA rows.
-- Only runs if at least one household exists (gates against empty installs).
-- Uses the first household ordered by created_at (deterministic).
-- Idempotent: WHERE household_id IS NULL ensures safe re-runs.

do $$
declare
  v_household_id uuid;
begin
  select id
    into v_household_id
    from public.households
   order by created_at
   limit 1;

  if v_household_id is null then
    raise notice 'backfill_placeholder_account_households: no households found, skipping';
    return;
  end if;

  update public.trading_account_config
     set household_id = v_household_id
   where account_type in ('schwab', 'ira')
     and household_id is null;

  raise notice 'backfill_placeholder_account_households: assigned household_id=% to % rows',
    v_household_id,
    (select count(*) from public.trading_account_config
      where account_type in ('schwab', 'ira')
        and household_id = v_household_id);
end;
$$;
