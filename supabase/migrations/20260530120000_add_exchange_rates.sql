-- Migration: add_exchange_rates
-- Purpose: Persist periodic currency exchange rates against ILS so all financial
-- conversions (dividends, bonds, options, current finances, net worth) reflect
-- current market rates rather than static values.
--
-- CONVENTION:
--   rate_to_ils represents how many ILS per 1 unit of currency (e.g. USD -> ~3.10 ILS).
--   ILS always has rate_to_ils = 1.0.

create table if not exists public.exchange_rates (
  currency text not null,
  rate_to_ils numeric(18, 6) not null,
  as_of timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  constraint exchange_rates_pkey primary key (currency),
  constraint exchange_rates_currency_not_blank check (length(btrim(currency)) > 0),
  constraint exchange_rates_rate_positive check (rate_to_ils > 0)
);

alter table public.exchange_rates enable row level security;

revoke all on table public.exchange_rates from anon;
revoke all on table public.exchange_rates from authenticated;
grant select on table public.exchange_rates to authenticated;
grant select on table public.exchange_rates to anon;
grant select, insert, update on table public.exchange_rates to service_role;

drop policy if exists exchange_rates_select on public.exchange_rates;
create policy exchange_rates_select
  on public.exchange_rates
  for select
  to authenticated, anon
  using (true);

drop policy if exists exchange_rates_service_insert on public.exchange_rates;
create policy exchange_rates_service_insert
  on public.exchange_rates
  for insert
  to service_role
  with check (true);

drop policy if exists exchange_rates_service_update on public.exchange_rates;
create policy exchange_rates_service_update
  on public.exchange_rates
  for update
  to service_role
  using (true)
  with check (true);

-- Seed baseline initial values so table is immediately populated
insert into public.exchange_rates (currency, rate_to_ils, as_of, refreshed_at)
values
  ('ILS', 1.000000, now(), now()),
  ('USD', 3.100000, now(), now()),
  ('EUR', 3.400000, now(), now()),
  ('GBP', 4.000000, now(), now())
on conflict (currency) do nothing;
