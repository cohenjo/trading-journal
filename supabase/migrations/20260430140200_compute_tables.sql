-- Migration: 20260430140200_compute_tables.sql
-- TJ-006: Compute schema — intermediate workspace tables
-- McManus (Data/Finance Dev)
--
-- Design contract:
--   • Owned exclusively by local Docker compute jobs (P&L worker, position worker).
--   • service_role is the only reader/writer; authenticated has no access.
--   • No RLS applied. Schema-level access control set in 20260430140000.
--   • Rows may be pruned by run; compute tables are not the source of truth.
--   • compute.pnl_runs acts as the parent key for all per-run intermediate tables.
--
-- Tables (3):
--   compute.pnl_runs                — job-level metadata, one row per invocation
--   compute.daily_pnl_intermediates — daily P&L output by household/date/account/symbol
--   compute.position_snapshots      — lot-level position state checkpointed mid-run
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; REVOKE/GRANT safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- compute.pnl_runs
-- Job-level metadata: one row per P&L computation invocation.
-- Parent key for daily_pnl_intermediates and position_snapshots.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compute.pnl_runs (
    run_id       uuid        primary key default gen_random_uuid(),
    household_id uuid        references public.households(id) on delete cascade,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    status       text        not null default 'running'
        check (status in ('running', 'succeeded', 'failed')),
    params       jsonb       not null default '{}'::jsonb,
    error        text
);

create index if not exists compute_pnl_runs_household_started_idx
    on compute.pnl_runs (household_id, started_at desc);

revoke all on compute.pnl_runs from public;
grant  all on compute.pnl_runs to   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- compute.daily_pnl_intermediates
-- Daily P&L output by household / date / account / symbol.
-- Written by the P&L worker; read by the cooked-layer writer.
-- Mirrors the shape of cooked.daily_performance but includes run provenance.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compute.daily_pnl_intermediates (
    run_id         uuid           not null references compute.pnl_runs(run_id) on delete cascade,
    household_id   uuid           not null references public.households(id)    on delete cascade,
    date           date           not null,
    account_id     text           not null default '',
    symbol         text           not null default '',
    realized_pnl   numeric(18, 6) not null default 0,
    unrealized_pnl numeric(18, 6) not null default 0,
    fees           numeric(18, 6) not null default 0,
    taxes          numeric(18, 6) not null default 0,
    trade_count    integer        not null default 0,
    winning_trades integer        not null default 0,
    losing_trades  integer        not null default 0,
    primary key (run_id, household_id, date, account_id, symbol)
);

create index if not exists compute_daily_pnl_intermediates_household_date_idx
    on compute.daily_pnl_intermediates (household_id, date desc);

revoke all on compute.daily_pnl_intermediates from public;
grant  all on compute.daily_pnl_intermediates to   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- compute.position_snapshots
-- Lot-level or account-level position state checkpointed during a compute run.
-- Allows the job to resume from a mid-run checkpoint without full recomputation.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists compute.position_snapshots (
    run_id         uuid           not null references compute.pnl_runs(run_id) on delete cascade,
    household_id   uuid           not null references public.households(id)    on delete cascade,
    account_id     text           not null default '',
    symbol         text           not null,
    as_of          timestamptz    not null,
    quantity       numeric(18, 6) not null default 0,
    avg_cost       numeric(18, 6) not null default 0,
    market_value   numeric(18, 6),
    unrealized_pnl numeric(18, 6),
    lot_details    jsonb          not null default '[]'::jsonb,
    primary key (run_id, household_id, account_id, symbol)
);

create index if not exists compute_position_snapshots_household_idx
    on compute.position_snapshots (household_id, as_of desc);

revoke all on compute.position_snapshots from public;
grant  all on compute.position_snapshots to   service_role;

-- end of migration
