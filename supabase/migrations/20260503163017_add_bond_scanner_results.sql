-- Migration: 20260503163017_add_bond_scanner_results
-- Purpose: Store daily TJ-020 bond scanner batch results for Supabase-only frontend reads.

create table if not exists public.bond_scanner_results (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  data jsonb not null,
  refreshed_at timestamptz not null default now(),
  constraint bond_scanner_results_symbol_key unique (symbol)
);

create index if not exists bond_scanner_results_refreshed_at_idx
  on public.bond_scanner_results (refreshed_at desc);

alter table public.bond_scanner_results enable row level security;

revoke all on table public.bond_scanner_results from anon;
revoke all on table public.bond_scanner_results from authenticated;
grant select on table public.bond_scanner_results to authenticated;
grant select, insert, update on table public.bond_scanner_results to service_role;

drop policy if exists bond_scanner_results_authenticated_select on public.bond_scanner_results;
create policy bond_scanner_results_authenticated_select
  on public.bond_scanner_results
  for select
  to authenticated
  using (true);

drop policy if exists bond_scanner_results_service_insert on public.bond_scanner_results;
create policy bond_scanner_results_service_insert
  on public.bond_scanner_results
  for insert
  to service_role
  with check (true);

drop policy if exists bond_scanner_results_service_update on public.bond_scanner_results;
create policy bond_scanner_results_service_update
  on public.bond_scanner_results
  for update
  to service_role
  using (true)
  with check (true);

do $$
begin
  alter publication supabase_realtime add table public.bond_scanner_results;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
