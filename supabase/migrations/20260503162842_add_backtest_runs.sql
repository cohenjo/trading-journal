-- Migration: 20260503162842_add_backtest_runs
-- Purpose: Add TJ-020 result table for queued backtest jobs.

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  compute_job_id uuid references public.compute_jobs(id) on delete set null,
  config jsonb not null,
  result jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists backtest_runs_household_created_at_idx
  on public.backtest_runs (household_id, created_at desc);

alter table public.backtest_runs enable row level security;

revoke all on table public.backtest_runs from anon;
revoke all on table public.backtest_runs from authenticated;
grant select on table public.backtest_runs to authenticated;
grant select, insert, update on table public.backtest_runs to service_role;

drop policy if exists backtest_runs_member_select on public.backtest_runs;
create policy backtest_runs_member_select
  on public.backtest_runs
  for select
  to authenticated
  using (public.is_household_member(household_id));

do $$
begin
  alter publication supabase_realtime add table public.backtest_runs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
