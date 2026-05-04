-- Migration: add_trading_account_options_toggle
-- Purpose: Allow households to opt trading accounts in/out of options-income computation.

alter table public.trading_account_config
  add column if not exists compute_options_income boolean not null default true;

comment on column public.trading_account_config.compute_options_income is
  'When true, the worker includes this broker account in options income Flex ingestion and monthly metrics.';
