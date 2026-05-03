-- Migration: add_price_cache
-- Purpose: TJ-020 scheduled price cache for frontend Supabase-only reads.

create table if not exists public.price_cache (
  symbol text not null,
  currency text not null,
  price numeric not null,
  as_of timestamptz not null,
  refreshed_at timestamptz not null default now(),
  constraint price_cache_pkey primary key (symbol, currency),
  constraint price_cache_symbol_not_blank check (length(btrim(symbol)) > 0),
  constraint price_cache_currency_not_blank check (length(btrim(currency)) > 0),
  constraint price_cache_price_positive check (price > 0)
);

alter table public.price_cache enable row level security;

revoke all on table public.price_cache from anon;
revoke all on table public.price_cache from authenticated;
grant select on table public.price_cache to authenticated;
grant select, insert, update on table public.price_cache to service_role;

drop policy if exists price_cache_authenticated_select on public.price_cache;
create policy price_cache_authenticated_select
  on public.price_cache
  for select
  to authenticated
  using (true);

drop policy if exists price_cache_service_insert on public.price_cache;
create policy price_cache_service_insert
  on public.price_cache
  for insert
  to service_role
  with check (true);

drop policy if exists price_cache_service_update on public.price_cache;
create policy price_cache_service_update
  on public.price_cache
  for update
  to service_role
  using (true)
  with check (true);

do $$
begin
  alter publication supabase_realtime add table public.price_cache;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
