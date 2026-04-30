-- Migration: 20260430140300_cooked_tables.sql
-- TJ-006: Cooked schema — UI-ready, denormalized, RLS-protected tables
-- McManus (Data/Finance Dev)
--
-- Design contract:
--   • Every table is household-scoped (household_id NOT NULL, FK to households).
--   • RLS enabled on every table; SELECT to authenticated via is_household_member();
--     INSERT/UPDATE restricted to service_role (compute worker writes these rows).
--   • _computed_at timestamptz tracks when the row was last refreshed.
--   • _freshness_seconds implementation note:
--       PostgreSQL 15 rejects now() in GENERATED ALWAYS AS STORED columns because
--       now() is classified as STABLE, not IMMUTABLE — Postgres will raise:
--         "ERROR: generation expression is not immutable"
--       Instead, each cooked table is paired with a <table>_live view that
--       projects  extract(epoch from now() - _computed_at)::int  dynamically at
--       query time. PG 15+ views are SECURITY INVOKER by default, so the view
--       inherits the table's RLS without any additional policy configuration.
--       Trade-off: clients must query the _live views (not the base tables) to
--       get the freshness field. TJ-020 can surface these views through the API.
--
-- NOTE: These are SKELETON tables. Actual domain columns will be added in
--   TJ-011 (compute worker) and TJ-020 (dashboard reads). This migration
--   establishes the structure, access controls, and RLS policies only.
--
-- Tables (3) + companion views (3):
--   cooked.dashboard_summary   / dashboard_summary_live
--   cooked.position_history    / position_history_live
--   cooked.daily_performance   / daily_performance_live
--
-- Idempotent: CREATE TABLE/VIEW IF NOT EXISTS; policies wrapped in DO blocks.

-- ─────────────────────────────────────────────────────────────────────────────
-- cooked.dashboard_summary
-- Top-level household dashboard aggregates: net worth, daily P&L, YTD, etc.
-- Refreshed by the compute worker after each successful P&L run.
-- Skeleton: domain columns will be expanded in TJ-020.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists cooked.dashboard_summary (
    household_id     uuid        not null references public.households(id) on delete cascade,
    period           text        not null default 'day'
        check (period in ('day', 'month', 'year', 'all')),
    as_of_date       date        not null,
    currency         text        not null default 'USD',
    summary_payload  jsonb       not null default '{}'::jsonb,  -- expanded in TJ-020
    source_run_id    uuid        references compute.pnl_runs(run_id),
    _computed_at     timestamptz not null default now(),
    primary key (household_id, period, as_of_date, currency)
);

create index if not exists cooked_dashboard_summary_household_date_idx
    on cooked.dashboard_summary (household_id, as_of_date desc);

alter table cooked.dashboard_summary enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'dashboard_summary'
          and policyname = 'dashboard_summary_select'
    ) then
        create policy dashboard_summary_select
            on cooked.dashboard_summary for select to authenticated
            using (public.is_household_member(household_id));
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'dashboard_summary'
          and policyname = 'dashboard_summary_insert'
    ) then
        create policy dashboard_summary_insert
            on cooked.dashboard_summary for insert to service_role
            with check (true);
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'dashboard_summary'
          and policyname = 'dashboard_summary_update'
    ) then
        create policy dashboard_summary_update
            on cooked.dashboard_summary for update to service_role
            using (true) with check (true);
    end if;
end $$;

grant select on cooked.dashboard_summary to authenticated;
grant all    on cooked.dashboard_summary to service_role;

-- _freshness_seconds view (see design note above re: generated column limitation)
create or replace view cooked.dashboard_summary_live as
select *,
    extract(epoch from now() - _computed_at)::int as _freshness_seconds
from cooked.dashboard_summary;

grant select on cooked.dashboard_summary_live to authenticated;
grant select on cooked.dashboard_summary_live to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- cooked.position_history
-- Latest + historical position snapshots per account/symbol for the household.
-- Written by the compute worker after each position reconciliation run.
-- Skeleton: domain columns (quantity, market_value, etc.) will be added in TJ-011.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists cooked.position_history (
    household_id      uuid        not null references public.households(id) on delete cascade,
    account_id        text        not null default '',
    symbol            text        not null,
    as_of_date        date        not null,
    position_payload  jsonb       not null default '{}'::jsonb,  -- expanded in TJ-011
    source_run_id     uuid        references compute.pnl_runs(run_id),
    _computed_at      timestamptz not null default now(),
    primary key (household_id, account_id, symbol, as_of_date)
);

create index if not exists cooked_position_history_household_date_idx
    on cooked.position_history (household_id, as_of_date desc);

alter table cooked.position_history enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'position_history'
          and policyname = 'position_history_select'
    ) then
        create policy position_history_select
            on cooked.position_history for select to authenticated
            using (public.is_household_member(household_id));
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'position_history'
          and policyname = 'position_history_insert'
    ) then
        create policy position_history_insert
            on cooked.position_history for insert to service_role
            with check (true);
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'position_history'
          and policyname = 'position_history_update'
    ) then
        create policy position_history_update
            on cooked.position_history for update to service_role
            using (true) with check (true);
    end if;
end $$;

grant select on cooked.position_history to authenticated;
grant all    on cooked.position_history to service_role;

create or replace view cooked.position_history_live as
select *,
    extract(epoch from now() - _computed_at)::int as _freshness_seconds
from cooked.position_history;

grant select on cooked.position_history_live to authenticated;
grant select on cooked.position_history_live to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- cooked.daily_performance
-- Daily trading performance metrics per household (realized P&L, win rate, etc.).
-- Supersedes the legacy public.dailysummary table for the household-scoped layer.
-- Skeleton: domain columns will be added in TJ-011 / TJ-020.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists cooked.daily_performance (
    household_id         uuid        not null references public.households(id) on delete cascade,
    date                 date        not null,
    currency             text        not null default 'USD',
    performance_payload  jsonb       not null default '{}'::jsonb,  -- expanded in TJ-020
    source_run_id        uuid        references compute.pnl_runs(run_id),
    _computed_at         timestamptz not null default now(),
    primary key (household_id, date, currency)
);

create index if not exists cooked_daily_performance_household_date_idx
    on cooked.daily_performance (household_id, date desc);

alter table cooked.daily_performance enable row level security;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'daily_performance'
          and policyname = 'daily_performance_select'
    ) then
        create policy daily_performance_select
            on cooked.daily_performance for select to authenticated
            using (public.is_household_member(household_id));
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'daily_performance'
          and policyname = 'daily_performance_insert'
    ) then
        create policy daily_performance_insert
            on cooked.daily_performance for insert to service_role
            with check (true);
    end if;
end $$;

do $$ begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'cooked' and tablename = 'daily_performance'
          and policyname = 'daily_performance_update'
    ) then
        create policy daily_performance_update
            on cooked.daily_performance for update to service_role
            using (true) with check (true);
    end if;
end $$;

grant select on cooked.daily_performance to authenticated;
grant all    on cooked.daily_performance to service_role;

create or replace view cooked.daily_performance_live as
select *,
    extract(epoch from now() - _computed_at)::int as _freshness_seconds
from cooked.daily_performance;

grant select on cooked.daily_performance_live to authenticated;
grant select on cooked.daily_performance_live to service_role;

-- end of migration
