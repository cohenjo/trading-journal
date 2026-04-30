-- Migration: 20260430115000_baseline_legacy_schema
-- Created: 2026-04-30 (McManus)
-- Purpose: Create all legacy public schema tables (baseline for 130xxx migrations)
--
-- This migration creates ALL trading journal legacy tables in public schema.
-- DOES NOT add household_id, owner_user_id, audit columns, or RLS policies.
-- Those are added by subsequent migrations: 130000, 130100, 130200, 130300.
--
-- Generated from Alembic migration chain analysis (22 migrations from 8250ff809a39 through 4d9a58ecd93b).
-- All tables use CREATE TABLE IF NOT EXISTS for idempotency.

-- ================================================================
-- Table: public.execution
-- Source: 8250ff809a39_add_execution_table.py
-- ================================================================
create table if not exists public.execution (
  "execId" text not null primary key,
  "permId" integer not null,
  "orderId" integer not null,
  "clientId" integer not null,
  time timestamptz not null,
  "acctNumber" text not null,
  exchange text not null,
  side text not null,
  shares numeric(18,6) not null,
  price numeric(18,6) not null,
  "avgPrice" numeric(18,6) not null,
  "cumQty" numeric(18,6) not null,
  symbol text not null,
  commission numeric(18,6) not null,
  currency text not null,
  "realizedPNL" numeric(18,6)
);

create index if not exists ix_execution_execId on public.execution ("execId");

-- ================================================================
-- Table: public.manualtrade
-- Source: 335418ec68e3_add_trades_table.py
-- ================================================================
create table if not exists public.manualtrade (
  id serial primary key,
  timestamp timestamptz not null,
  symbol text not null,
  side text not null,
  size numeric(18,6) not null,
  entry_price numeric(18,6) not null,
  exit_price numeric(18,6) not null,
  pnl numeric(18,6) not null,
  notes text
);

-- ================================================================
-- Table: public.trade (simple version, to be transformed by 130000)
-- Source: Inferred from d869bcf363dc downgrade() — original simple schema
-- ================================================================
create table if not exists public.trade (
  id serial primary key,
  timestamp timestamptz not null,
  symbol text not null,
  side text not null,
  size numeric(18,6) not null,
  entry_price numeric(18,6) not null,
  exit_price numeric(18,6) not null,
  pnl numeric(18,6) not null,
  notes text
);

-- ================================================================
-- Transform public.trade to full IB Flex schema
-- Source: d869bcf363dc_add_new_trades_table.py
-- ================================================================
-- Drop the simple schema columns (we'll add the full schema instead)
alter table public.trade drop column if exists id cascade;
alter table public.trade drop column if exists timestamp cascade;
alter table public.trade drop column if exists symbol cascade;
alter table public.trade drop column if exists side cascade;
alter table public.trade drop column if exists size cascade;
alter table public.trade drop column if exists entry_price cascade;
alter table public.trade drop column if exists exit_price cascade;
alter table public.trade drop column if exists pnl cascade;
alter table public.trade drop column if exists notes cascade;

-- Add full IB Flex schema columns
alter table public.trade add column if not exists "tradeID" bigint not null;
alter table public.trade add column if not exists "accountId" text not null;
alter table public.trade add column if not exists "acctAlias" text;
alter table public.trade add column if not exists model text;
alter table public.trade add column if not exists currency text not null;
alter table public.trade add column if not exists "fxRateToBase" numeric(18,6) not null;
alter table public.trade add column if not exists "assetCategory" text not null;
alter table public.trade add column if not exists "subCategory" text;
alter table public.trade add column if not exists symbol text not null;
alter table public.trade add column if not exists description text;
alter table public.trade add column if not exists conid bigint not null;
alter table public.trade add column if not exists "securityID" text;
alter table public.trade add column if not exists "securityIDType" text;
alter table public.trade add column if not exists cusip text;
alter table public.trade add column if not exists isin text;
alter table public.trade add column if not exists figi text;
alter table public.trade add column if not exists "listingExchange" text;
alter table public.trade add column if not exists "underlyingConid" text;
alter table public.trade add column if not exists "underlyingSymbol" text;
alter table public.trade add column if not exists "underlyingSecurityID" text;
alter table public.trade add column if not exists "underlyingListingExchange" text;
alter table public.trade add column if not exists issuer text;
alter table public.trade add column if not exists "issuerCountryCode" text;
alter table public.trade add column if not exists multiplier integer not null;
alter table public.trade add column if not exists "relatedTradeID" text;
alter table public.trade add column if not exists strike text;
alter table public.trade add column if not exists "reportDate" date;
alter table public.trade add column if not exists expiry text;
alter table public.trade add column if not exists "dateTime" timestamptz not null;
alter table public.trade add column if not exists "putCall" text;
alter table public.trade add column if not exists "tradeDate" date;
alter table public.trade add column if not exists "principalAdjustFactor" text;
alter table public.trade add column if not exists "settleDateTarget" date;
alter table public.trade add column if not exists "transactionType" text;
alter table public.trade add column if not exists exchange text;
alter table public.trade add column if not exists quantity numeric(18,6) not null;
alter table public.trade add column if not exists "tradePrice" numeric(18,6) not null;
alter table public.trade add column if not exists "tradeMoney" numeric(18,6) not null;
alter table public.trade add column if not exists proceeds numeric(18,6) not null;
alter table public.trade add column if not exists taxes numeric(18,6) not null;
alter table public.trade add column if not exists "ibCommission" numeric(18,6) not null;
alter table public.trade add column if not exists "ibCommissionCurrency" text;
alter table public.trade add column if not exists "netCash" numeric(18,6) not null;
alter table public.trade add column if not exists "closePrice" numeric(18,6) not null;
alter table public.trade add column if not exists "openCloseIndicator" text;
alter table public.trade add column if not exists notes text;
alter table public.trade add column if not exists cost numeric(18,6) not null;
alter table public.trade add column if not exists "fifoPnlRealized" numeric(18,6) not null;
alter table public.trade add column if not exists "mtmPnl" numeric(18,6) not null;
alter table public.trade add column if not exists "origTradePrice" numeric(18,6);
alter table public.trade add column if not exists "origTradeDate" text;
alter table public.trade add column if not exists "origTradeID" text;
alter table public.trade add column if not exists "origOrderID" bigint;
alter table public.trade add column if not exists "origTransactionID" bigint;
alter table public.trade add column if not exists "buySell" text;
alter table public.trade add column if not exists "clearingFirmID" text;
alter table public.trade add column if not exists "ibOrderID" bigint;
alter table public.trade add column if not exists "transactionID" bigint;
alter table public.trade add column if not exists "ibExecID" text;
alter table public.trade add column if not exists "relatedTransactionID" text;
alter table public.trade add column if not exists rtn text;
alter table public.trade add column if not exists "brokerageOrderID" text;
alter table public.trade add column if not exists "orderReference" text;
alter table public.trade add column if not exists "volatilityOrderLink" text;
alter table public.trade add column if not exists "exchOrderId" text;
alter table public.trade add column if not exists "extExecID" text;
alter table public.trade add column if not exists "orderTime" timestamptz;
alter table public.trade add column if not exists "openDateTime" text;
alter table public.trade add column if not exists "holdingPeriodDateTime" text;
alter table public.trade add column if not exists "whenRealized" text;
alter table public.trade add column if not exists "whenReopened" text;
alter table public.trade add column if not exists "levelOfDetail" text;
alter table public.trade add column if not exists "changeInPrice" numeric(18,6);
alter table public.trade add column if not exists "changeInQuantity" numeric(18,6);
alter table public.trade add column if not exists "orderType" text;
alter table public.trade add column if not exists "traderID" text;
alter table public.trade add column if not exists "isAPIOrder" text;
alter table public.trade add column if not exists "accruedInt" numeric(18,6);
alter table public.trade add column if not exists "initialInvestment" text;
alter table public.trade add column if not exists "serialNumber" text;
alter table public.trade add column if not exists "deliveryType" text;
alter table public.trade add column if not exists "commodityType" text;
alter table public.trade add column if not exists fineness numeric(18,6);
alter table public.trade add column if not exists weight numeric(18,6);

-- Set primary key on tradeID
alter table public.trade drop constraint if exists trade_pkey;
alter table public.trade add primary key ("tradeID");

-- ================================================================
-- Table: public.ndx1m
-- Source: fb4bdd3a199b_add_ndx1m_table.py
-- ================================================================
create table if not exists public.ndx1m (
  timestamp timestamptz not null primary key,
  open numeric(18,6) not null,
  high numeric(18,6) not null,
  low numeric(18,6) not null,
  close numeric(18,6) not null,
  volume integer not null
);

-- ================================================================
-- Table: public.dailysummary
-- Source: b2d42d55f559_add_daily_summary_table.py
-- ================================================================
create table if not exists public.dailysummary (
  date date not null primary key,
  total_pnl numeric(18,6) not null,
  winning_trades integer not null,
  losing_trades integer not null,
  win_rate numeric(18,6) not null,
  avg_win numeric(18,6) not null,
  avg_loss numeric(18,6) not null
);

-- ================================================================
-- Table: public.note
-- Source: b2d42d55f559_add_daily_summary_table.py
-- ================================================================
create table if not exists public.note (
  date date not null primary key,
  content text not null
);

-- ================================================================
-- Table: public.matchedtrade
-- Source: e4d61af894a7_add_matched_trade_table.py + b8f9cb81d6e3 (nullability)
-- ================================================================
create table if not exists public.matchedtrade (
  id serial primary key,
  symbol text not null,
  open_transaction_id bigint,
  open_date timestamptz not null,
  close_transaction_id bigint,
  close_date timestamptz not null,
  open_price numeric(18,6) not null,
  close_price numeric(18,6) not null,
  pnl numeric(18,6) not null,
  notes text
);

-- ================================================================
-- Table: public.backtestrun
-- Source: b8f9cb81d6e3_add_backtest_tables.py
-- ================================================================
create table if not exists public.backtestrun (
  id serial primary key,
  created_at timestamptz not null,
  start_date date not null,
  end_date date not null,
  initial_capital numeric(18,6) not null,
  parameters text not null,
  final_equity numeric(18,6) not null,
  total_realized_pnl numeric(18,6) not null,
  total_unrealized_pnl numeric(18,6) not null
);

-- ================================================================
-- Table: public.optioncontract
-- Source: b8f9cb81d6e3_add_backtest_tables.py + 3d7ac526bd6a (conid bigint)
-- ================================================================
create table if not exists public.optioncontract (
  conid bigint not null primary key,
  symbol text not null,
  expiration date not null,
  strike numeric(18,6) not null,
  "right" text not null, -- 'C' or 'P'
  multiplier text not null
);

create index if not exists ix_optioncontract_symbol on public.optioncontract (symbol);
create index if not exists ix_optioncontract_expiration on public.optioncontract (expiration);

-- ================================================================
-- Table: public.backtesttrade
-- Source: b8f9cb81d6e3_add_backtest_tables.py
-- ================================================================
create table if not exists public.backtesttrade (
  id serial primary key,
  run_id integer not null references public.backtestrun(id),
  date timestamptz not null,
  action text not null,
  conid bigint not null,
  quantity numeric(18,6) not null,
  price numeric(18,6) not null,
  commission numeric(18,6) not null,
  notes text
);

-- ================================================================
-- Table: public.historicaloptionbar
-- Source: b8f9cb81d6e3_add_backtest_tables.py
-- ================================================================
create table if not exists public.historicaloptionbar (
  id serial primary key,
  conid bigint not null references public.optioncontract(conid),
  date timestamptz not null,
  open numeric(18,6) not null,
  high numeric(18,6) not null,
  low numeric(18,6) not null,
  close numeric(18,6) not null,
  volume integer not null,
  implied_vol numeric(18,6),
  delta numeric(18,6),
  gamma numeric(18,6),
  theta numeric(18,6),
  vega numeric(18,6),
  underlying_price numeric(18,6) not null
);

create index if not exists ix_historicaloptionbar_conid on public.historicaloptionbar (conid);
create index if not exists ix_historicaloptionbar_date on public.historicaloptionbar (date);

-- ================================================================
-- Table: public.dailybar
-- Source: bccb9af01233_add_daily_bar_table.py
-- ================================================================
create table if not exists public.dailybar (
  symbol text not null,
  date date not null,
  open numeric(18,6) not null,
  high numeric(18,6) not null,
  low numeric(18,6) not null,
  close numeric(18,6) not null,
  volume integer not null,
  primary key (symbol, date)
);

-- ================================================================
-- Table: public.finance_snapshots
-- Source: 6093b5cc0229_add_finance_snapshots_table.py
-- ================================================================
create table if not exists public.finance_snapshots (
  date date not null primary key,
  data jsonb not null,
  net_worth numeric(18,6) not null,
  total_assets numeric(18,6) not null,
  total_liabilities numeric(18,6) not null
);

-- ================================================================
-- Table: public.plans
-- Source: b75e2a944c8b_add_plans_table.py
-- ================================================================
create table if not exists public.plans (
  id serial primary key,
  name text not null,
  description text,
  data jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- ================================================================
-- Table: public.dividend_positions
-- Source: 710cafd9a8c6_add_dividend_positions_table_retry.py
-- ================================================================
create table if not exists public.dividend_positions (
  id serial primary key,
  account text not null,
  ticker text not null,
  shares numeric(18,6) not null
);

create index if not exists ix_dividend_positions_account on public.dividend_positions (account);

-- ================================================================
-- Table: public.dividend_accounts
-- Source: 84ee53f97357_add_dividend_accounts_table.py + 93b8104cc90e (linked_id)
-- ================================================================
create table if not exists public.dividend_accounts (
  name text not null primary key,
  linked_id integer
);

-- ================================================================
-- Table: public.dividend_ticker_data
-- Source: cb9ab42f6156_add_dividend_cache.py
-- ================================================================
create table if not exists public.dividend_ticker_data (
  ticker text not null primary key,
  last_updated timestamptz not null,
  price numeric(18,6) not null,
  currency text not null,
  dividend_yield numeric(18,6) not null,
  dividend_rate numeric(18,6) not null,
  dgr_3y numeric(18,6) not null,
  dgr_5y numeric(18,6) not null,
  previous_close numeric(18,6) not null
);

-- ================================================================
-- Enum: public.tradingaccounttype
-- Source: 5fe76bf46802_add_schwab_support_to_trading_models.py
-- ================================================================
do $$ begin
  create type public.tradingaccounttype as enum ('IBKR', 'SCHWAB');
exception when duplicate_object then null;
end $$;

-- ================================================================
-- Table: public.trading_account_config
-- Source: 0bf5a6151a3f_add_tradingaccountconfig.py + aaf944172360 (last_synced)
--         + 5fe76bf46802 (name, account_type)
-- NOTE: trading_account_secrets is a stub table dropped by migration 130300;
--       trading_account_config columns (name, account_type, etc.) are real and persist.
-- ================================================================
create table if not exists public.trading_account_config (
  id serial primary key,
  name text not null default 'My Trading Account',
  account_type public.tradingaccounttype not null default 'IBKR',
  host text not null,
  port integer not null,
  client_id integer not null,
  linked_account_id text,
  account_id text,
  last_synced timestamptz
);

-- ================================================================
-- Table: public.trading_account_summary
-- Source: aaf944172360_add_persistent_trading_models.py
--         + 5fe76bf46802 (account_config_id FK)
-- ================================================================
create table if not exists public.trading_account_summary (
  id serial primary key,
  net_liquidation numeric(18,6) not null,
  total_cash numeric(18,6) not null,
  currency text not null,
  timestamp timestamptz not null
);

alter table public.trading_account_summary
  add column if not exists account_config_id integer references public.trading_account_config(id);

-- ================================================================
-- Table: public.trading_positions
-- Source: aaf944172360_add_persistent_trading_models.py
--         + 5fe76bf46802 (account_config_id FK)
-- ================================================================
create table if not exists public.trading_positions (
  id serial primary key,
  symbol text not null,
  amount numeric(18,6) not null,
  sec_type text not null,
  avg_cost numeric(18,6) not null,
  con_id integer not null,
  timestamp timestamptz not null
);

alter table public.trading_positions
  add column if not exists account_config_id integer references public.trading_account_config(id);

-- ================================================================
-- Table: public.insurance_policies
-- Source: acadd4bc6806_add_insurance_policies_table.py
-- ================================================================
create table if not exists public.insurance_policies (
  id text not null primary key,
  owner text not null,
  type text not null,
  provider text not null,
  policy_number text,
  sum_insured text not null,
  monthly_premium numeric(18,6),
  beneficiaries text,
  expiry_date text,
  website text,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- ================================================================
-- Stub Table: public.trading_account_secrets
-- Source: Decision #3 — dropped by migration 130300.
-- trading_account_secrets is a stub table dropped by migration 130300;
-- trading_account_config columns are real and persist.
-- We create a minimal stub here so 130300 can drop it cleanly.
-- ================================================================
create table if not exists public.trading_account_secrets (
    id serial primary key
);
comment on table public.trading_account_secrets is 'Stub for clean removal by migration 130300. Original table dropped per design decision (no broker secrets in YOLO scope).';

-- ================================================================
-- End of baseline legacy schema migration
-- ================================================================
-- Next migrations (130000, 130100, 130200, 130300) will add:
--   * audit columns (created_at, updated_at, deleted_at)
--   * household_id foreign keys
--   * owner_user_id columns
--   * RLS policies
-- ================================================================
