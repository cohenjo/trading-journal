-- Soft-delete any trading_account_config rows whose household_id does not
-- exist in the households table.  The canonical case is the E2E test account
-- E2E_TRADING_1778493037442-7fkxg (household 649510c1-...) whose household was
-- hard-deleted but whose config row was never cleaned up, causing a nightly
-- FK violation on options_flex_sync_state_household_id_fkey since 2026-05-13.
--
-- Idempotent: the WHERE clause targets only rows that are not yet soft-deleted,
-- so re-running this migration is safe.

update public.trading_account_config
set deleted_at = now()
where household_id not in (select id from public.households)
  and deleted_at is null;
