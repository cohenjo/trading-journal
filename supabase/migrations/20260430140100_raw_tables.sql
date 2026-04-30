-- Migration: 20260430140100_raw_tables.sql
-- TJ-006: Raw schema — ingestion landing zones
-- McManus (Data/Finance Dev)
--
-- Design contract:
--   • Append-only: rows are never updated or deleted by application code.
--   • Every table carries _loaded_at timestamptz and _source text.
--   • No business-key uniqueness enforced (re-imports produce duplicate rows;
--     deduplication happens in the compute layer).
--   • No RLS. Access is restricted at the schema level (20260430140000).
--   • service_role is the only reader/writer; import jobs use the service key.
--   • Household-scoped tables carry household_id for compute joins;
--     global/reference tables have no household scope.
--
-- Tables (4):
--   raw.broker_trade_events    — individual trade/execution events per household
--   raw.market_data_quotes     — OHLCV / quote snapshots (global reference)
--   raw.dividend_announcements — corporate action / dividend events (global reference)
--   raw.broker_statements      — uploaded broker statement files per household
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; REVOKE/GRANT safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- raw.broker_trade_events
-- Individual trade/execution events from broker APIs or file imports.
-- One row per atomic broker event; duplicate rows are expected on re-import.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists raw.broker_trade_events (
    id                uuid        not null default gen_random_uuid(),
    household_id      uuid        not null references public.households(id) on delete cascade,
    _loaded_at        timestamptz not null default now(),
    _source           text        not null,
    source_account_id text,
    source_trade_id   text,
    event_timestamp   timestamptz,
    symbol            text,
    asset_category    text,
    side              text,
    quantity          numeric(18, 6),
    price             numeric(18, 6),
    currency          text        not null default 'USD',
    raw_payload       jsonb       not null default '{}'::jsonb
);

create index if not exists raw_broker_trade_events_household_ts_idx
    on raw.broker_trade_events (household_id, event_timestamp desc nulls last);

revoke all on raw.broker_trade_events from public;
grant  all on raw.broker_trade_events to   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- raw.market_data_quotes
-- Symbol-level OHLCV / quote snapshots from market data feeds.
-- Global reference data: no household scope; identical across all households.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists raw.market_data_quotes (
    id              uuid        not null default gen_random_uuid(),
    _loaded_at      timestamptz not null default now(),
    _source         text        not null,
    symbol          text        not null,
    quote_timestamp timestamptz not null,
    open            numeric(18, 6),
    high            numeric(18, 6),
    low             numeric(18, 6),
    close           numeric(18, 6),
    volume          bigint,
    interval_label  text,                          -- e.g. '1m', '1d', 'tick'
    raw_payload     jsonb       not null default '{}'::jsonb
);

create index if not exists raw_market_data_quotes_symbol_ts_idx
    on raw.market_data_quotes (symbol, quote_timestamp desc);

revoke all on raw.market_data_quotes from public;
grant  all on raw.market_data_quotes to   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- raw.dividend_announcements
-- Corporate action / dividend event records from data feeds.
-- Global reference data: no household scope.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists raw.dividend_announcements (
    id             uuid        not null default gen_random_uuid(),
    _loaded_at     timestamptz not null default now(),
    _source        text        not null,
    symbol         text        not null,
    ex_date        date,
    pay_date       date,
    declared_date  date,
    amount         numeric(18, 6),
    currency       text        not null default 'USD',
    dividend_type  text,                           -- 'regular', 'special', 'return_of_capital'
    raw_payload    jsonb       not null default '{}'::jsonb
);

create index if not exists raw_dividend_announcements_symbol_ex_date_idx
    on raw.dividend_announcements (symbol, ex_date desc nulls last);

revoke all on raw.dividend_announcements from public;
grant  all on raw.dividend_announcements to   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- raw.broker_statements
-- Uploaded broker statement files and their parsed metadata.
-- Household-scoped: tracks provenance (who uploaded, when) for audit and
-- re-processing. References auth.users(id) directly because public.users
-- is not yet in a migration (planned in a future batch).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists raw.broker_statements (
    id             uuid        not null default gen_random_uuid(),
    household_id   uuid        not null references public.households(id) on delete cascade,
    uploaded_by    uuid        not null references auth.users(id),
    _loaded_at     timestamptz not null default now(),
    _source        text        not null,
    broker         text,
    account_id     text,
    statement_date date,
    period_start   date,
    period_end     date,
    file_name      text,
    file_checksum  text,
    parse_status   text        not null default 'pending'
        check (parse_status in ('pending', 'processing', 'done', 'error')),
    parse_error    text,
    raw_payload    jsonb       not null default '{}'::jsonb
);

create index if not exists raw_broker_statements_household_ts_idx
    on raw.broker_statements (household_id, _loaded_at desc);

revoke all on raw.broker_statements from public;
grant  all on raw.broker_statements to   service_role;

-- end of migration
