# 06 — Data Architecture

**Owner:** McManus (Data/Finance Dev)  
**Requested by:** Jony Vesterman Cohen  
**Status:** Draft for hosting/Supabase design

## Goal

Move the current SQLModel-backed personal finance/trading store to Supabase Postgres in a way that supports:

1. Supabase-managed authentication.
2. Couples/spouses sharing financial data through households.
3. A raw → compute → cooked layering where heavy finance jobs can run locally and the UI reads fast, RLS-protected cooked/OLTP tables.

The design below keeps the project small: Postgres is the source of truth, local Docker jobs do expensive recomputation, and Supabase RLS protects every household-scoped row.

## Existing schema survey

Current SQLModel models live in `apps/backend/app/schema/*.py`. The important finding: the app has a `User` table, but the major financial tables do **not** yet carry a `user_id`, `owner_user_id`, or `household_id` foreign key. Some JSON payloads contain an `owner` string such as `"You"`, `"Partner"`, or `"Spouse"`, but that is a display/domain field, not an authorization boundary.

| Source file | Table / model | Current purpose | Existing user concept? | Notes for migration |
|---|---|---|---|---|
| `user_models.py` | `user` / `User` | Local username/password auth | `id` int PK, no Supabase UUID | Replace/map to Supabase `auth.users.id` UUID; do not keep passwords in app tables. |
| `models.py` | `manualtrade` / `ManualTrade` | Manually entered trade journal rows | No | Add `household_id`; trades are shared household financial history by default. |
| `models.py` | `trade` / `Trade` | Imported IBKR trade rows keyed by `tradeID` | No; has broker `accountId` | Add `household_id`; preserve broker IDs as source identifiers. |
| `models.py` | `execution` / `Execution` | Broker execution rows | No; has broker `acctNumber` | Add `household_id`; link to account config later if possible. |
| `models.py` | `matchedtrade` / `MatchedTrade` | Open/close matched trade P&L | No | Treat as compute/cooked output; add `household_id` and source run metadata if retained. |
| `models.py` | `dailysummary` / `DailySummary` | Daily trade P&L summary | No | Supersede with `compute_pnl_daily` and `cooked_pnl_summary`. |
| `models.py` | `note` / `Note` | Date-keyed journal notes | No | Prefer `owner_user_id` unless notes are explicitly family-visible. |
| `models.py` | `ndx1m` / `Ndx1m` | NDX one-minute OHLCV | No | Market data is global reference data, not household-scoped. |
| `models.py` | `dailybar` / `DailyBar` | Symbol/date OHLCV | No | Global reference data. |
| `trading_models.py` | `trading_account_config` | Broker connection settings | No; has broker `account_id` and linked finance account ID | Split credentials out; account metadata is household-scoped, secrets are owner-private. |
| `trading_models.py` | `trading_account_summary` | Account balance snapshots | No | Add `household_id`; optionally FK to account. |
| `trading_models.py` | `trading_positions` | Broker position snapshots | No | Add `household_id`; include `as_of`/timestamp indexes. |
| `finance_models.py` | `finance_snapshots` | Net-worth snapshot JSON plus totals | No; nested `FinanceItem.owner` string | Add `household_id` to snapshots; keep `owner` for spouse attribution inside household. |
| `plan_models.py` | `plans` | Planning scenarios as JSON | No; nested `PlanItem.owner` / milestones owner | Add `household_id`; plans are normally shared by spouses. |
| `dividend_models.py` | `dividend_positions` | Dividend portfolio positions | No; has account string | Add `household_id`; holdings are shared planning/investment data. |
| `dividend_models.py` | `dividend_accounts` | Dividend account registry | No | Add `household_id`; link to finance item/account. |
| `dividend_models.py` | `dividend_ticker_data` | Dividend market/reference metrics | No | Global reference data. |
| `insurance_models.py` | `insurance_policies` | Insurance inventory | No; has `owner` string | Add `household_id`; policies are household-shared family continuity data. |
| `backtest_models.py` | `optioncontract` | Option contract registry | No | Global reference data. |
| `backtest_models.py` | `historicaloptionbar` | Historical option OHLCV/Greeks | No | Global/reference market data. |
| `backtest_models.py` | `backtestrun` | Backtest configuration/results | No | Use `owner_user_id` by default; optionally promote selected runs to household. |
| `backtest_models.py` | `backtesttrade` | Trades emitted by a backtest run | No; FK to run | Inherit visibility from `backtestrun`. |
| `ladder_models.py`, `options_models.py` | dataclasses / Pydantic only | Bond ladder and options projections | No DB tables | Persist future saved scenarios with household scope unless user marks private. |

## Multi-tenancy and household model

Supabase already owns identity in `auth.users`. Application tables should reference `auth.users.id` directly and avoid storing passwords. Households are the tenancy boundary for shared financial data.

### Core tenancy DDL

```sql
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

-- Decision #2 (2026-04-30): enum is canonical `household_role` (not household_member_role).
-- Matches the implementation in migration 20260430120000_households_and_members.sql.
create type public.household_role as enum ('owner', 'member', 'viewer');

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.household_role not null default 'viewer',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx
  on public.household_members (user_id, household_id);
```

Recommended signup flow:

1. Supabase creates `auth.users`.
2. App creates `public.users` row for the same UUID.
3. App creates a default personal household such as `Jony Household`.
4. App inserts owner membership in `household_members`.
5. Imported or existing rows backfill to that household.

### Per-table sharing rules

Default rule: if a row contributes to family net worth, retirement, taxes, income, insurance, trading P&L, or dashboards, scope it by `household_id`. If it is a personal note, credential/secret, or sandbox experiment, scope it by `owner_user_id`. Global market/reference data has neither and is readable by authenticated users or server jobs.

| Data set | Existing table(s) | Scope | Reason |
|---|---|---|---|
| Supabase/app profile | `user_profile` | `id` = user | Identity row; 1:1 with `auth.users`. Created by trigger on auth.users INSERT. |
| Household registry | new `households`, `household_members` | Household membership | Tenant boundary. |
| Broker/trading account metadata | `trading_account_config`, `dividend_accounts` | `household_id` | Spouses need shared balance/planning visibility. No credential columns — manual entry only. |
| Imported trades and executions | `trade`, `manualtrade`, `execution` | `household_id` | Trading P&L affects household wealth and dashboards. |
| Positions/account summaries | `trading_positions`, `trading_account_summary`, `dividend_positions` | `household_id` | Shared current holdings and income view. |
| Finance snapshots | `finance_snapshots` | `household_id` | Net worth and cash-flow planning are household-level. Keep nested item `owner` for attribution. |
| Plans and budgets | `plans`; future `budgets` | `household_id` | Plans/budgets model couple-level cash flow by default. |
| Insurance policies | `insurance_policies` | `household_id` | Family continuity/beneficiary data should be visible to spouse. |
| Journal notes | `note` | `owner_user_id` by default | Notes may be private. Add optional `household_id` only for shared notes. |
| Backtest runs/trades | `backtestrun`, `backtesttrade` | `owner_user_id` | Research sandbox is personal unless explicitly shared. |
| Matched trades and daily summaries | `matchedtrade`, `dailysummary` | `household_id` or recompute into cooked | Derived from shared trades. Prefer replace with compute/cooked tables. |
| Market data | `dailybar`, `ndx1m`, `optioncontract`, `historicaloptionbar`, `dividend_ticker_data`, `raw_market_data` | Global/reference | Same symbols/prices for all households; no RLS by household needed. |
| Raw imports | new `raw_trades_import`, `raw_broker_statement` | `household_id` plus `uploaded_by` | Source documents belong to a household but upload provenance matters. |
| Cooked dashboards | new `cooked_*` | `household_id` | UI reads household-authorized summaries only. |

### Backfill migration: single user to personal household

For the current single-user database, create one Supabase user mapping and one household, then stamp all household-shared rows with that household. A concrete migration shape:

```sql
-- Inputs supplied by deployment/migration script after Supabase user exists.
\set app_user_id '00000000-0000-0000-0000-000000000000'

insert into public.users (id, display_name)
values (:'app_user_id'::uuid, 'Jony')
on conflict (id) do nothing;

with h as (
  insert into public.households (name, created_by)
  values ('Personal Household', :'app_user_id'::uuid)
  returning id
), m as (
  insert into public.household_members (household_id, user_id, role)
  select id, :'app_user_id'::uuid, 'owner'::public.household_role
  from h
  returning household_id
)
select household_id from m;
```

Then add nullable `household_id` columns, backfill them, and make them non-null where appropriate:

```sql
alter table public.trade add column household_id uuid references public.households(id);
alter table public.finance_snapshots add column household_id uuid references public.households(id);
alter table public.plans add column household_id uuid references public.households(id);

update public.trade set household_id = :'household_id'::uuid where household_id is null;
update public.finance_snapshots set household_id = :'household_id'::uuid where household_id is null;
update public.plans set household_id = :'household_id'::uuid where household_id is null;

alter table public.trade alter column household_id set not null;
alter table public.finance_snapshots alter column household_id set not null;
alter table public.plans alter column household_id set not null;
```

Repeat for each household-scoped table. For SQLModel tables whose physical names are currently generated defaults (`trade`, `manualtrade`, `backtestrun`, etc.), either preserve those names in migration or standardize names in a deliberate breaking migration. Do not silently rename in the Supabase move.

## Raw / compute / cooked schema

Use three logical schemas in Postgres:

- `raw`: immutable-ish source facts from imports, brokers, and market feeds.
- `compute`: run metadata and intermediate results from local Docker jobs.
- `cooked`: UI-optimized summaries/snapshots refreshed from compute/raw.

```sql
create schema if not exists raw;
create schema if not exists compute;
create schema if not exists cooked;
```

### Concrete table list

| Layer | Table | Purpose | Scope |
|---|---|---|---|
| Raw | `raw.raw_trades_import` | Normalized row-level broker/trade import payloads | `household_id`, `uploaded_by` |
| Raw | `raw.raw_market_data` | Symbol/time OHLCV or vendor payloads | Global/reference |
| Raw | `raw.raw_broker_statement` | Uploaded broker statements and parsed metadata | `household_id`, `uploaded_by` |
| Compute | `compute.compute_pnl_runs` | One row per P&L computation run | Run-level metadata |
| Compute | `compute.compute_pnl_daily` | Daily P&L output by household/date/symbol/account | `household_id` |
| Compute | `compute.compute_position_lots` | Optional lot-level intermediate state | `household_id` |
| Cooked | `cooked.cooked_pnl_summary` | Dashboard-ready P&L summaries | `household_id` |
| Cooked | `cooked.cooked_position_snapshot` | Latest position/account snapshot for UI | `household_id` |
| Cooked | `cooked.cooked_planning_dashboard` | Net worth, income, expenses, FI/retirement dashboard | `household_id` |

### Example raw DDL

```sql
create table raw.raw_trades_import (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  uploaded_by uuid not null references public.users(id),
  source text not null check (source in ('ibkr', 'schwab', 'manual', 'other')),
  source_account_id text,
  source_trade_id text,
  trade_timestamp timestamptz,
  symbol text,
  asset_category text,
  side text,
  quantity numeric(18, 6),
  price numeric(18, 6),
  currency text not null default 'USD',
  commission numeric(18, 6),
  taxes numeric(18, 6),
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (household_id, source, source_trade_id)
);

create index raw_trades_import_household_time_idx
  on raw.raw_trades_import (household_id, trade_timestamp desc);
create index raw_trades_import_symbol_time_idx
  on raw.raw_trades_import (symbol, trade_timestamp desc);
```

### Example compute DDL

```sql
create table compute.compute_pnl_runs (
  run_id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  params jsonb not null default '{}'::jsonb,
  error text
);

create table compute.compute_pnl_daily (
  run_id uuid not null references compute.compute_pnl_runs(run_id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  account_id text not null default '',
  symbol text not null default '',
  realized_pnl numeric(18, 6) not null default 0,
  unrealized_pnl numeric(18, 6) not null default 0,
  fees numeric(18, 6) not null default 0,
  taxes numeric(18, 6) not null default 0,
  net_pnl numeric(18, 6) generated always as
    (realized_pnl + unrealized_pnl - fees - taxes) stored,
  trade_count integer not null default 0,
  winning_trades integer not null default 0,
  losing_trades integer not null default 0,
  primary key (run_id, household_id, date, account_id, symbol)
);

create index compute_pnl_daily_household_date_idx
  on compute.compute_pnl_daily (household_id, date desc);
```

If the generated `net_pnl` expression is too restrictive for older tooling, make it a normal column populated by the job. Keep `numeric(18, 6)` for all money-like amounts.

### Example cooked DDL

For a small project, use tables refreshed transactionally by the local job rather than a materialized view first; tables are easier to RLS, incrementally upsert, and annotate with refresh metadata.

```sql
create table cooked.cooked_pnl_summary (
  household_id uuid not null references public.households(id) on delete cascade,
  date date not null,
  period text not null check (period in ('day', 'month', 'year', 'all')),
  currency text not null default 'USD',
  realized_pnl numeric(18, 6) not null default 0,
  unrealized_pnl numeric(18, 6) not null default 0,
  net_pnl numeric(18, 6) not null default 0,
  trade_count integer not null default 0,
  win_rate numeric(9, 6),
  max_drawdown numeric(18, 6),
  refreshed_at timestamptz not null default now(),
  source_run_id uuid references compute.compute_pnl_runs(run_id),
  primary key (household_id, period, date, currency)
);

create index cooked_pnl_summary_household_period_date_idx
  on cooked.cooked_pnl_summary (household_id, period, date desc);
```

A materialized view is still useful for global/reference summaries or when refreshes are full-table and simple:

```sql
create materialized view cooked.cooked_market_symbol_latest as
select distinct on (symbol)
  symbol, ts, close, volume
from raw.raw_market_data
order by symbol, ts desc;
```

## Refresh strategy

Use explicit compute jobs as the primary refresh mechanism. Avoid doing heavy P&L, lot matching, or planning simulations in synchronous API requests or Postgres triggers.

| Event | Recommended refresh | Why |
|---|---|---|
| User uploads trades/broker statement | Insert into `raw.*`, enqueue or mark household dirty | Raw writes stay fast and auditable. |
| Small derived metadata (row counts, import status) | Lightweight trigger allowed | Safe if it only updates import status, never recalculates portfolio history. |
| P&L/lot matching | Local Docker job pulls dirty households, writes `compute.*`, upserts `cooked.*` | Heavy jobs run locally per user request; failures are visible in `compute_pnl_runs`. |
| Market data updates | Scheduled job or local connector writes `raw.raw_market_data`; refresh latest snapshots | Market data is shared/global and can be batched. |
| Planning dashboard | Refresh after finance snapshot/plan/budget change, or nightly | Planning is less latency-sensitive than trade import. |
| Supabase-hosted cron | Use `pg_cron` only for small maintenance or refresh flags if available | Supabase plan support varies; do not depend on it for CPU-heavy jobs. |

Suggested pattern:

1. Add `public.household_refresh_state(household_id, domain, dirty_since, last_run_id, last_refreshed_at)`.
2. Raw/OLTP writes set `dirty_since = now()` for domains such as `pnl`, `positions`, `planning`.
3. Local Docker job runs on demand or every few minutes:
   - Claim dirty households.
   - Insert `compute_pnl_runs` row.
   - Recompute deterministic outputs.
   - Upsert cooked rows inside a transaction.
   - Mark refresh state clean.
4. UI reads cooked tables and can show `refreshed_at` plus a “refreshing” indicator if dirty.

## Indexing and partitioning

### Indexing recommendations

- Every household-scoped OLTP/cooked table: first index column should be `household_id`, followed by the UI filter/sort key.
- Trades/imports: `(household_id, trade_timestamp desc)`, `(household_id, symbol, trade_timestamp desc)`, and unique source IDs to make imports idempotent.
- Positions: `(household_id, timestamp desc)`, `(household_id, account_config_id, symbol)`.
- Plans/budgets: `(household_id, updated_at desc)`.
- Market data: `(symbol, date desc)` for daily bars; `(symbol, ts desc)` for intraday; BRIN on timestamp for large append-only feeds.
- Raw JSON payloads: add GIN indexes only after a real query needs them; unnecessary JSONB GIN indexes are write overhead.

### Partitioning rules

Keep partitioning minimal until tables are large enough to justify it.

| Table type | Partitioning recommendation |
|---|---|
| `raw.raw_market_data` | Partition by time (`range` monthly or yearly depending volume). Symbol hash partitioning is overkill initially; use `(symbol, ts)` indexes. |
| `raw.raw_trades_import` | No partition initially for a personal app. If imports exceed millions of rows, range partition by `trade_timestamp` year. |
| `compute.compute_pnl_daily` | No partition initially; compute data can be pruned by run. If it grows, partition by year on `date`. |
| `cooked.cooked_pnl_summary` | No partition initially. If multi-year daily data grows, partition by year. Do **not** partition by household for a small household count. |
| `cooked.cooked_position_snapshot` | No partition; keep only latest plus limited history if needed. |

Partition by household only if the app becomes multi-tenant at scale with many unrelated households. For the current couples/personal framing, household partitioning adds operational complexity without benefit.

## RLS policy patterns

Coordinate this section with Rabin’s security/RLS design: [05 — Security, Auth, and RLS](./05-security-auth-rls.md). The data architecture assumes Rabin owns final policy hardening, but all household-scoped tables should use the same helper predicate.

```sql
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner_or_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = hid
      and hm.user_id = auth.uid()
      and hm.role in ('owner', 'member')
  );
$$;
```

Apply the pattern to every household-scoped OLTP, raw, compute, and cooked table that the client can read or write:

```sql
alter table cooked.cooked_pnl_summary enable row level security;

create policy cooked_pnl_summary_select
on cooked.cooked_pnl_summary
for select
to authenticated
using (public.is_household_member(household_id));

create policy cooked_pnl_summary_write
on cooked.cooked_pnl_summary
for insert
to authenticated
with check (public.is_household_owner_or_member(household_id));

create policy cooked_pnl_summary_update
on cooked.cooked_pnl_summary
for update
to authenticated
using (public.is_household_owner_or_member(household_id))
with check (public.is_household_owner_or_member(household_id));
```

For owner-private tables:

```sql
alter table public.private_notes enable row level security;

create policy private_notes_owner_only
on public.private_notes
for all
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());
```

For global market/reference tables, either:

- expose read-only to authenticated users, with writes only through service-role jobs; or
- keep them server-only and expose via API endpoints.

```sql
alter table raw.raw_market_data enable row level security;

create policy raw_market_data_read_authenticated
on raw.raw_market_data
for select
to authenticated
using (true);
```

Do not grant browser clients write access to compute tables if local jobs use a service role. If authenticated users can trigger refreshes, write only a request/dirty flag row and let the job perform compute writes.

## Data retention and archival

Small-project defaults should favor simplicity and recoverability over aggressive deletion.

| Data | Retention | Archival approach |
|---|---|---|
| `raw.raw_trades_import` | Keep indefinitely | It is the audit trail for P&L. Compress/archive only if storage becomes an issue. |
| `raw.raw_broker_statement` | Keep parsed metadata indefinitely; large original files optional | Store file in Supabase Storage with path in DB; allow user deletion/export. |
| `raw.raw_market_data` daily bars | Keep indefinitely for symbols used in portfolios/backtests | Daily bars are small and valuable. |
| `raw.raw_market_data` intraday/minute bars | Keep 1–3 years by default | Archive older intraday bars to compressed CSV/Parquet outside Postgres if needed. |
| `compute.*` run intermediates | Keep last 30–90 days or last N successful runs per household | Cooked tables are authoritative for UI; compute runs are for debugging/repro. |
| `cooked.*` | Keep current dashboard history needed by UI | Rebuildable from raw, but cheap to keep. |
| Private notes/plans/snapshots | User-controlled retention | Provide export before destructive deletion. |

Add a simple archival job later only when storage pressure is real. First implementation can be a documented SQL script plus `pg_dump` backups.

## Backups and point-in-time recovery

Supabase plan capabilities vary. Treat managed backups/PITR as a plan-dependent convenience, not the only safety net.

Recommended baseline:

1. Use Supabase automated backups/PITR where the selected plan supports it.
2. Add a local scheduled `pg_dump` offload for fallback, especially on free tier or before risky migrations.
3. Store dumps encrypted in a private location outside the project repo.
4. Test restore into a local Docker Postgres before trusting the backup process.

Example local backup command shape:

```bash
# Run from a secure machine; do not commit DATABASE_URL or dump files.
pg_dump "$SUPABASE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "backups/trading-journal-$(date +%Y%m%d-%H%M%S).dump"
```

For this repository, keep `backups/` gitignored if it is ever created. Never place dumps in `docs/`, `.squad/`, or source directories.

## Migration checklist

1. Create Supabase project and auth users.
2. Create tenancy tables (`users`, `households`, `household_members`) and helper functions.
3. Add `household_id` / `owner_user_id` columns per sharing table above.
4. Backfill one personal household for existing data.
5. Enable RLS and verify spouse/member access with two test users.
6. Create `raw`, `compute`, and `cooked` schemas.
7. Move/import broker trades into `raw.raw_trades_import`; keep old `trade` table read-only until parity is verified.
8. Implement local Docker refresh job that writes `compute_pnl_runs`, `compute_pnl_daily`, and `cooked_pnl_summary`.
9. Point UI dashboards at cooked tables/API wrappers.
10. Add scheduled `pg_dump` fallback and restore test.
