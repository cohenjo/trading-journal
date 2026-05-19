-- 20260519120000_add_refresh_requested_at.sql
-- Adds manual-refresh request flag to trading_account_config.

alter table public.trading_account_config
  add column if not exists refresh_requested_at timestamptz;

comment on column public.trading_account_config.refresh_requested_at is
  'Non-NULL = user has requested a manual Flex refresh. Worker nulls after processing.';

-- Sparse partial index for the worker poll query (most rows are NULL, so this stays tiny)
create index if not exists idx_trading_account_config_refresh_pending
  on public.trading_account_config (refresh_requested_at)
  where refresh_requested_at is not null and deleted_at is null;
