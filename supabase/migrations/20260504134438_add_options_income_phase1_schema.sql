-- Migration: add_options_income_phase1_schema
-- Purpose: Phase 1 options-income Flex ingestion and dashboard read models for #246.

do $$ begin
  create type public.options_sync_source as enum ('ibkr_flex', 'ib_gateway', 'snaptrade');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_sync_status as enum ('pending', 'running', 'succeeded', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.option_right as enum ('call', 'put');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_strategy_kind as enum ('csp', 'vertical_spread', 'roll_chain', 'ungrouped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_strategy_status as enum ('open', 'closed', 'expired', 'assigned', 'mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_trade_event_type as enum ('open', 'close', 'expire', 'assign', 'exercise', 'cash_settle', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_trade_side as enum ('buy', 'sell');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_cash_event_category as enum ('option_related', 'commission_fee', 'tax_withholding', 'interest', 'dividend', 'transfer', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_roll_classification as enum ('positive', 'negative', 'neutral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.options_roll_detection_status as enum ('detected', 'confirmed', 'rejected', 'manual');
exception when duplicate_object then null; end $$;

create table if not exists public.options_flex_sync_state (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  query_name text not null,
  source public.options_sync_source not null default 'ibkr_flex',
  status public.options_sync_status not null default 'pending',
  last_sync_at timestamptz,
  last_from_date date,
  last_through_date date,
  rows_seen integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  row_counts jsonb not null default '{}'::jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_flex_sync_state_account_query_key unique (household_id, account_id, query_name, source)
);

create table if not exists public.options_legs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  source_conid bigint,
  underlying_symbol text not null,
  option_symbol text,
  expiry date not null,
  strike numeric(18,6) not null,
  "right" public.option_right not null,
  multiplier numeric(18,6) not null default 100,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_legs_natural_key unique (household_id, account_id, underlying_symbol, expiry, strike, "right", multiplier, currency)
);

create table if not exists public.options_strategy_groups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  underlying_symbol text not null,
  kind public.options_strategy_kind not null default 'ungrouped',
  status public.options_strategy_status not null default 'open',
  opened_at timestamptz not null,
  closed_at timestamptz,
  parent_group_id uuid references public.options_strategy_groups(id) on delete set null,
  net_cash_flow numeric(18,6) not null default 0,
  realized_pnl numeric(18,6) not null default 0,
  capital_at_risk numeric(18,6),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.options_trades (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  leg_id uuid not null references public.options_legs(id) on delete restrict,
  source public.options_sync_source not null,
  source_trade_id text,
  source_transaction_id text,
  source_exec_id text,
  event_type public.options_trade_event_type not null,
  side public.options_trade_side not null,
  trade_time timestamptz not null,
  trade_date date not null,
  quantity numeric(18,6) not null,
  price numeric(18,6) not null,
  gross_amount numeric(18,6) not null,
  commission numeric(18,6) not null default 0,
  fees numeric(18,6) not null default 0,
  net_cash_flow numeric(18,6) not null,
  realized_pnl numeric(18,6) not null default 0,
  matched_open_trade_id uuid references public.options_trades(id) on delete set null,
  fifo_lot_id uuid,
  currency text not null default 'USD',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_trades_source_trade_key unique (source, source_trade_id)
);

create table if not exists public.options_cash_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  source public.options_sync_source not null,
  source_transaction_id text not null,
  event_date date not null,
  event_time timestamptz,
  event_category public.options_cash_event_category not null,
  description text,
  amount numeric(18,6) not null,
  currency text not null default 'USD',
  related_trade_id uuid references public.options_trades(id) on delete set null,
  related_strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_cash_events_source_transaction_key unique (source, source_transaction_id)
);

create table if not exists public.options_positions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  as_of_date date not null,
  strategy_group_id uuid references public.options_strategy_groups(id) on delete set null,
  leg_id uuid not null references public.options_legs(id) on delete restrict,
  opened_at timestamptz not null,
  quantity_open numeric(18,6) not null,
  average_open_price numeric(18,6) not null,
  open_cash_flow numeric(18,6) not null,
  capital_at_risk numeric(18,6),
  ib_margin_requirement numeric(18,6),
  last_broker_sync_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_positions_snapshot_key unique (household_id, account_id, as_of_date, leg_id)
);

create table if not exists public.options_roll_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  strategy_group_id uuid not null references public.options_strategy_groups(id) on delete cascade,
  closed_trade_id uuid not null references public.options_trades(id) on delete cascade,
  opened_trade_id uuid not null references public.options_trades(id) on delete cascade,
  detected_at timestamptz not null default now(),
  detection_status public.options_roll_detection_status not null default 'detected',
  classification public.options_roll_classification not null,
  closed_leg_realized_pnl numeric(18,6) not null,
  incremental_cash_flow numeric(18,6) not null,
  old_expiry date,
  new_expiry date,
  old_strike numeric(18,6),
  new_strike numeric(18,6),
  heuristic_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_roll_events_trade_pair_key unique (household_id, closed_trade_id, opened_trade_id)
);

create table if not exists public.options_dashboard_monthly (
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  period_start date not null,
  period_end date not null,
  cash_flow_total numeric(18,6) not null default 0,
  realized_pnl_total numeric(18,6) not null default 0,
  cash_flow_cumulative numeric(18,6) not null default 0,
  realized_pnl_cumulative numeric(18,6) not null default 0,
  variance_gap numeric(18,6) not null default 0,
  variance_gap_cumulative numeric(18,6) not null default 0,
  trade_count integer not null default 0,
  roll_efficiency_positive_count integer,
  roll_efficiency_negative_count integer,
  roll_efficiency_neutral_count integer,
  roll_efficiency_score numeric(18,6),
  capital_at_risk_avg numeric(18,6),
  capital_at_risk_return numeric(18,6),
  last_computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, account_id, period_start)
);

create index if not exists options_flex_sync_state_account_idx on public.options_flex_sync_state (account_id, last_sync_at desc);
create unique index if not exists options_legs_household_account_conid_key on public.options_legs (household_id, account_id, source_conid) where source_conid is not null;
create index if not exists options_legs_account_underlying_idx on public.options_legs (household_id, account_id, underlying_symbol);
create index if not exists options_strategy_groups_account_status_idx on public.options_strategy_groups (household_id, account_id, status);
create index if not exists options_trades_account_trade_date_idx on public.options_trades (household_id, account_id, trade_date);
create index if not exists options_trades_leg_id_idx on public.options_trades (leg_id);
create index if not exists options_trades_strategy_group_id_idx on public.options_trades (strategy_group_id) where strategy_group_id is not null;
create index if not exists options_trades_matched_open_trade_id_idx on public.options_trades (matched_open_trade_id) where matched_open_trade_id is not null;
create index if not exists options_cash_events_account_event_date_idx on public.options_cash_events (household_id, account_id, event_date);
create index if not exists options_cash_events_related_trade_id_idx on public.options_cash_events (related_trade_id) where related_trade_id is not null;
create index if not exists options_cash_events_related_strategy_group_id_idx on public.options_cash_events (related_strategy_group_id) where related_strategy_group_id is not null;
create index if not exists options_positions_account_as_of_idx on public.options_positions (household_id, account_id, as_of_date desc);
create index if not exists options_positions_strategy_group_id_idx on public.options_positions (strategy_group_id) where strategy_group_id is not null;
create index if not exists options_positions_leg_id_idx on public.options_positions (leg_id);
create index if not exists options_roll_events_account_detected_idx on public.options_roll_events (household_id, account_id, detected_at desc);
create index if not exists options_roll_events_strategy_group_id_idx on public.options_roll_events (strategy_group_id);
create index if not exists options_roll_events_closed_trade_id_idx on public.options_roll_events (closed_trade_id);
create index if not exists options_roll_events_opened_trade_id_idx on public.options_roll_events (opened_trade_id);
create index if not exists options_strategy_groups_parent_group_id_idx on public.options_strategy_groups (parent_group_id) where parent_group_id is not null;
create index if not exists options_dashboard_monthly_account_period_idx on public.options_dashboard_monthly (household_id, account_id, period_start desc);

-- Keep updated_at consistent with the rest of the public schema.
drop trigger if exists trg_options_flex_sync_state_updated_at on public.options_flex_sync_state;
create trigger trg_options_flex_sync_state_updated_at before update on public.options_flex_sync_state for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_legs_updated_at on public.options_legs;
create trigger trg_options_legs_updated_at before update on public.options_legs for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_strategy_groups_updated_at on public.options_strategy_groups;
create trigger trg_options_strategy_groups_updated_at before update on public.options_strategy_groups for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_trades_updated_at on public.options_trades;
create trigger trg_options_trades_updated_at before update on public.options_trades for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_cash_events_updated_at on public.options_cash_events;
create trigger trg_options_cash_events_updated_at before update on public.options_cash_events for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_positions_updated_at on public.options_positions;
create trigger trg_options_positions_updated_at before update on public.options_positions for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_roll_events_updated_at on public.options_roll_events;
create trigger trg_options_roll_events_updated_at before update on public.options_roll_events for each row execute function public.tg_update_timestamp();
drop trigger if exists trg_options_dashboard_monthly_updated_at on public.options_dashboard_monthly;
create trigger trg_options_dashboard_monthly_updated_at before update on public.options_dashboard_monthly for each row execute function public.tg_update_timestamp();

alter table public.options_flex_sync_state enable row level security;
alter table public.options_legs enable row level security;
alter table public.options_strategy_groups enable row level security;
alter table public.options_trades enable row level security;
alter table public.options_cash_events enable row level security;
alter table public.options_positions enable row level security;
alter table public.options_roll_events enable row level security;
alter table public.options_dashboard_monthly enable row level security;

revoke all on table public.options_flex_sync_state, public.options_legs, public.options_strategy_groups, public.options_trades,
  public.options_cash_events, public.options_positions, public.options_roll_events, public.options_dashboard_monthly from anon;
revoke all on table public.options_flex_sync_state, public.options_legs, public.options_strategy_groups, public.options_trades,
  public.options_cash_events, public.options_positions, public.options_roll_events, public.options_dashboard_monthly from authenticated;
grant select, insert, update, delete on table public.options_flex_sync_state, public.options_legs, public.options_strategy_groups,
  public.options_trades, public.options_cash_events, public.options_positions, public.options_roll_events, public.options_dashboard_monthly to authenticated;
grant select, insert, update, delete on table public.options_flex_sync_state, public.options_legs, public.options_strategy_groups,
  public.options_trades, public.options_cash_events, public.options_positions, public.options_roll_events, public.options_dashboard_monthly to service_role;

-- Household-scoped policies mirror public.options_income.
drop policy if exists options_flex_sync_state_select on public.options_flex_sync_state;
create policy options_flex_sync_state_select on public.options_flex_sync_state for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_flex_sync_state_insert on public.options_flex_sync_state;
create policy options_flex_sync_state_insert on public.options_flex_sync_state for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_flex_sync_state_update on public.options_flex_sync_state;
create policy options_flex_sync_state_update on public.options_flex_sync_state for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_flex_sync_state_delete on public.options_flex_sync_state;
create policy options_flex_sync_state_delete on public.options_flex_sync_state for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_legs_select on public.options_legs;
create policy options_legs_select on public.options_legs for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_legs_insert on public.options_legs;
create policy options_legs_insert on public.options_legs for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_legs_update on public.options_legs;
create policy options_legs_update on public.options_legs for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_legs_delete on public.options_legs;
create policy options_legs_delete on public.options_legs for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_strategy_groups_select on public.options_strategy_groups;
create policy options_strategy_groups_select on public.options_strategy_groups for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_strategy_groups_insert on public.options_strategy_groups;
create policy options_strategy_groups_insert on public.options_strategy_groups for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_strategy_groups_update on public.options_strategy_groups;
create policy options_strategy_groups_update on public.options_strategy_groups for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_strategy_groups_delete on public.options_strategy_groups;
create policy options_strategy_groups_delete on public.options_strategy_groups for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_trades_select on public.options_trades;
create policy options_trades_select on public.options_trades for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_trades_insert on public.options_trades;
create policy options_trades_insert on public.options_trades for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_trades_update on public.options_trades;
create policy options_trades_update on public.options_trades for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_trades_delete on public.options_trades;
create policy options_trades_delete on public.options_trades for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_cash_events_select on public.options_cash_events;
create policy options_cash_events_select on public.options_cash_events for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_cash_events_insert on public.options_cash_events;
create policy options_cash_events_insert on public.options_cash_events for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_cash_events_update on public.options_cash_events;
create policy options_cash_events_update on public.options_cash_events for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_cash_events_delete on public.options_cash_events;
create policy options_cash_events_delete on public.options_cash_events for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_positions_select on public.options_positions;
create policy options_positions_select on public.options_positions for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_positions_insert on public.options_positions;
create policy options_positions_insert on public.options_positions for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_positions_update on public.options_positions;
create policy options_positions_update on public.options_positions for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_positions_delete on public.options_positions;
create policy options_positions_delete on public.options_positions for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_roll_events_select on public.options_roll_events;
create policy options_roll_events_select on public.options_roll_events for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_roll_events_insert on public.options_roll_events;
create policy options_roll_events_insert on public.options_roll_events for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_roll_events_update on public.options_roll_events;
create policy options_roll_events_update on public.options_roll_events for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_roll_events_delete on public.options_roll_events;
create policy options_roll_events_delete on public.options_roll_events for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

drop policy if exists options_dashboard_monthly_select on public.options_dashboard_monthly;
create policy options_dashboard_monthly_select on public.options_dashboard_monthly for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_dashboard_monthly_insert on public.options_dashboard_monthly;
create policy options_dashboard_monthly_insert on public.options_dashboard_monthly for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_dashboard_monthly_update on public.options_dashboard_monthly;
create policy options_dashboard_monthly_update on public.options_dashboard_monthly for update to authenticated using (household_id is not null and public.is_household_writer(household_id)) with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_dashboard_monthly_delete on public.options_dashboard_monthly;
create policy options_dashboard_monthly_delete on public.options_dashboard_monthly for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

do $$
begin
  alter publication supabase_realtime add table public.options_flex_sync_state;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.options_strategy_groups;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.options_positions;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.options_roll_events;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$
begin
  alter publication supabase_realtime add table public.options_dashboard_monthly;
exception when duplicate_object then null; when undefined_object then null; end $$;
