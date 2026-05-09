-- Migration: options_phase4_capital_margin
-- Purpose: Phase 4 capital-at-risk history and account-wide margin utilization gauges for #249.

alter table public.options_strategy_groups
  add column if not exists capital_at_risk_open numeric(18,6),
  add column if not exists risk_calculation_method text;

alter table public.options_strategy_groups
  drop constraint if exists options_strategy_groups_risk_calculation_method_check,
  add constraint options_strategy_groups_risk_calculation_method_check
    check (risk_calculation_method is null or risk_calculation_method in (
      'csp_net_premium', 'vertical_spread_max_loss', 'roll_chain_latest_leg', 'ungrouped'
    ));

update public.options_strategy_groups
   set capital_at_risk_open = coalesce(capital_at_risk_open, capital_at_risk),
       risk_calculation_method = coalesce(risk_calculation_method, 'ungrouped')
 where capital_at_risk is not null
    or risk_calculation_method is null;

create table if not exists public.options_strategy_capital_history (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.options_strategy_groups(id) on delete cascade,
  effective_at timestamptz not null,
  capital_at_risk numeric(18,6),
  risk_calculation_method text not null check (risk_calculation_method in (
    'csp_net_premium', 'vertical_spread_max_loss', 'roll_chain_latest_leg', 'ungrouped'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_strategy_capital_history_group_effective_key unique (group_id, effective_at)
);

create index if not exists options_strategy_capital_history_group_effective_idx
  on public.options_strategy_capital_history (group_id, effective_at desc);

create table if not exists public.options_margin_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id text not null,
  account_config_id integer references public.trading_account_config(id) on delete cascade,
  captured_at timestamptz not null,
  margin_used numeric(18,6),
  margin_available numeric(18,6),
  buying_power numeric(18,6),
  source text not null check (source in ('ib_gateway', 'flex', 'synthetic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_margin_snapshots_account_captured_key unique (account_id, captured_at)
);

create index if not exists options_margin_snapshots_account_captured_idx
  on public.options_margin_snapshots (account_id, captured_at desc);
create index if not exists options_margin_snapshots_household_account_captured_idx
  on public.options_margin_snapshots (household_id, account_id, captured_at desc);

alter table public.options_dashboard_monthly
  add column if not exists avg_capital_at_risk numeric(18,6),
  add column if not exists return_on_capital_at_risk_pct numeric(8,4),
  add column if not exists latest_margin_used numeric(18,6),
  add column if not exists latest_margin_available numeric(18,6),
  add column if not exists margin_utilization_pct numeric(5,2);

-- Keep updated_at consistent with the rest of the public schema.
drop trigger if exists trg_options_strategy_capital_history_updated_at on public.options_strategy_capital_history;
create trigger trg_options_strategy_capital_history_updated_at
  before update on public.options_strategy_capital_history
  for each row execute function public.tg_update_timestamp();

drop trigger if exists trg_options_margin_snapshots_updated_at on public.options_margin_snapshots;
create trigger trg_options_margin_snapshots_updated_at
  before update on public.options_margin_snapshots
  for each row execute function public.tg_update_timestamp();

alter table public.options_strategy_capital_history enable row level security;
alter table public.options_margin_snapshots enable row level security;

revoke all on table public.options_strategy_capital_history, public.options_margin_snapshots from anon;
revoke all on table public.options_strategy_capital_history, public.options_margin_snapshots from authenticated;
grant select, insert, update, delete on table public.options_strategy_capital_history, public.options_margin_snapshots to authenticated;
grant select, insert, update, delete on table public.options_strategy_capital_history, public.options_margin_snapshots to service_role;

-- Capital history inherits household scope through its strategy group.
drop policy if exists options_strategy_capital_history_select on public.options_strategy_capital_history;
create policy options_strategy_capital_history_select on public.options_strategy_capital_history
  for select to authenticated using (
    exists (
      select 1 from public.options_strategy_groups g
       where g.id = group_id and g.household_id is not null and public.is_household_member(g.household_id)
    )
  );
drop policy if exists options_strategy_capital_history_insert on public.options_strategy_capital_history;
create policy options_strategy_capital_history_insert on public.options_strategy_capital_history
  for insert to authenticated with check (
    exists (
      select 1 from public.options_strategy_groups g
       where g.id = group_id and g.household_id is not null and public.is_household_writer(g.household_id)
    )
  );
drop policy if exists options_strategy_capital_history_update on public.options_strategy_capital_history;
create policy options_strategy_capital_history_update on public.options_strategy_capital_history
  for update to authenticated using (
    exists (
      select 1 from public.options_strategy_groups g
       where g.id = group_id and g.household_id is not null and public.is_household_writer(g.household_id)
    )
  ) with check (
    exists (
      select 1 from public.options_strategy_groups g
       where g.id = group_id and g.household_id is not null and public.is_household_writer(g.household_id)
    )
  );
drop policy if exists options_strategy_capital_history_delete on public.options_strategy_capital_history;
create policy options_strategy_capital_history_delete on public.options_strategy_capital_history
  for delete to authenticated using (
    exists (
      select 1 from public.options_strategy_groups g
       where g.id = group_id and g.household_id is not null and public.is_household_writer(g.household_id)
    )
  );

-- Margin snapshots are account-wide, scoped directly by household for efficient latest-snapshot reads.
drop policy if exists options_margin_snapshots_select on public.options_margin_snapshots;
create policy options_margin_snapshots_select on public.options_margin_snapshots
  for select to authenticated using (household_id is not null and public.is_household_member(household_id));
drop policy if exists options_margin_snapshots_insert on public.options_margin_snapshots;
create policy options_margin_snapshots_insert on public.options_margin_snapshots
  for insert to authenticated with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_margin_snapshots_update on public.options_margin_snapshots;
create policy options_margin_snapshots_update on public.options_margin_snapshots
  for update to authenticated using (household_id is not null and public.is_household_writer(household_id))
  with check (household_id is not null and public.is_household_writer(household_id));
drop policy if exists options_margin_snapshots_delete on public.options_margin_snapshots;
create policy options_margin_snapshots_delete on public.options_margin_snapshots
  for delete to authenticated using (household_id is not null and public.is_household_writer(household_id));

do $$
begin
  alter publication supabase_realtime add table public.options_margin_snapshots;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin
  alter publication supabase_realtime add table public.options_strategy_capital_history;
exception when duplicate_object then null; when undefined_object then null; end $$;
