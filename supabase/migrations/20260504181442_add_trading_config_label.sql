-- Add frontend-facing labels for trading account configuration.
-- The live schema drifted from the UI contract and was missing these columns.

alter table public.trading_account_config
  add column if not exists name text;

alter table public.trading_account_config
  add column if not exists account_type text;

alter table public.trading_account_config
  alter column account_type drop default;

alter table public.trading_account_config
  alter column account_type type text using account_type::text;

update public.trading_account_config
set name = coalesce(nullif(account_id, ''), 'My Trading Account')
where name is null or btrim(name) = '';

update public.trading_account_config
set account_type = 'IBKR'
where account_type is null or btrim(account_type) = '';

alter table public.trading_account_config
  alter column account_type set default 'IBKR',
  alter column account_type set not null;

alter table public.trading_account_config
  alter column name drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trading_account_config_account_type_check'
      and conrelid = 'public.trading_account_config'::regclass
  ) then
    alter table public.trading_account_config
      add constraint trading_account_config_account_type_check
      check (account_type in ('IBKR', 'SCHWAB'));
  end if;
end $$;
