-- Migration: 20260503161310_add_compute_jobs
-- Purpose: Add Supabase-backed worker queue table for TJ-020 compute jobs.

create table if not exists public.compute_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  job_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  result jsonb,
  error text,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists compute_jobs_status_created_at_idx
  on public.compute_jobs (status, created_at);

create index if not exists compute_jobs_household_type_created_at_idx
  on public.compute_jobs (household_id, job_type, created_at desc);

alter table public.compute_jobs enable row level security;

revoke all on table public.compute_jobs from anon;
revoke all on table public.compute_jobs from authenticated;
grant select, insert on table public.compute_jobs to authenticated;
grant select, insert, update on table public.compute_jobs to service_role;

drop policy if exists compute_jobs_member_select on public.compute_jobs;
create policy compute_jobs_member_select
  on public.compute_jobs
  for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists compute_jobs_member_insert on public.compute_jobs;
create policy compute_jobs_member_insert
  on public.compute_jobs
  for insert
  to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists compute_jobs_service_update on public.compute_jobs;
create policy compute_jobs_service_update
  on public.compute_jobs
  for update
  to service_role
  using (true)
  with check (true);

do $$
begin
  alter publication supabase_realtime add table public.compute_jobs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
