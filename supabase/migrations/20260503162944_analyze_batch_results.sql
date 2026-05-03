-- Migration: analyze_batch_results
-- Purpose: Store TJ-020 scheduled backend analysis results for frontend Supabase reads.

create table if not exists public.analysis_tickers (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  household_id uuid references public.households(id) on delete cascade,
  household_scope uuid generated always as (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  data jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_tickers_ticker_upper_chk check (ticker = upper(btrim(ticker)))
);

create unique index if not exists analysis_tickers_household_scope_ticker_key
  on public.analysis_tickers (household_scope, ticker);

create index if not exists analysis_tickers_refreshed_at_idx
  on public.analysis_tickers (refreshed_at desc);

create index if not exists analysis_tickers_household_id_idx
  on public.analysis_tickers (household_id)
  where household_id is not null;

create table if not exists public.analysis_growth_stories (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  household_id uuid references public.households(id) on delete cascade,
  household_scope uuid generated always as (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  story jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_growth_stories_ticker_upper_chk check (ticker = upper(btrim(ticker)))
);

create index if not exists analysis_growth_stories_household_ticker_refreshed_idx
  on public.analysis_growth_stories (household_id, ticker, refreshed_at desc);

create index if not exists analysis_growth_stories_global_ticker_refreshed_idx
  on public.analysis_growth_stories (ticker, refreshed_at desc)
  where household_id is null;

create unique index if not exists analysis_growth_stories_household_scope_ticker_key
  on public.analysis_growth_stories (household_scope, ticker);

alter table public.analysis_tickers enable row level security;
alter table public.analysis_growth_stories enable row level security;

drop policy if exists analysis_tickers_select on public.analysis_tickers;
create policy analysis_tickers_select on public.analysis_tickers
  for select to authenticated
  using (household_id is null or public.is_household_member(household_id));

drop policy if exists analysis_growth_stories_select on public.analysis_growth_stories;
create policy analysis_growth_stories_select on public.analysis_growth_stories
  for select to authenticated
  using (household_id is null or public.is_household_member(household_id));

revoke all on public.analysis_tickers from anon, authenticated;
revoke all on public.analysis_growth_stories from anon, authenticated;
grant select on public.analysis_tickers to authenticated;
grant select on public.analysis_growth_stories to authenticated;
grant all on public.analysis_tickers to service_role;
grant all on public.analysis_growth_stories to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'analysis_tickers'
    ) then
      alter publication supabase_realtime add table public.analysis_tickers;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'analysis_growth_stories'
    ) then
      alter publication supabase_realtime add table public.analysis_growth_stories;
    end if;
  end if;
end $$;
