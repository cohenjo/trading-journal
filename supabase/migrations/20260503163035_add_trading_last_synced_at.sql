-- TJ-020 / #216: track worker refresh freshness per trading account.

alter table public.trading_account_config
  add column if not exists last_synced_at timestamptz;

update public.trading_account_config
set last_synced_at = last_synced
where last_synced_at is null
  and last_synced is not null;
