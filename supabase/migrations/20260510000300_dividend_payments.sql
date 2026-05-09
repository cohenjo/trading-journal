-- ================================================================
-- Migration: dividend_payments
-- Issue: Flex pipeline Phase 1 — delta 1.3
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
-- Landing table for IBKR CashTransaction rows of type:
--   • Dividends
--   • Payment In Lieu Of Dividends
--   • Withholding Tax
-- Idempotency key: (account_id, source_transaction_id).
-- ================================================================

create table if not exists public.dividend_payments (
  id                     bigserial     primary key,
  account_id             text          not null,
  symbol                 text          null,
  con_id                 bigint        null,
  description            text          null,
  currency               text          null,
  date_time              timestamptz   null,
  report_date            date          null,
  settle_date            date          null,
  ex_date                date          null,
  amount                 numeric       null,
  type                   text          null,       -- IBKR raw type field
  dividend_type          text          null,       -- IBKR dividendType attribute
  trade_id               text          null,
  transaction_id         text          null,
  action_id              text          null,
  source_section         text          null,       -- 'CashTransactions'
  source_transaction_id  text          not null,   -- IBKR transactionID; idempotency key
  raw_payload            jsonb         null,
  created_at             timestamptz   not null    default now(),
  constraint dividend_payments_idempotent
    unique (account_id, source_transaction_id)
);

create index if not exists dividend_payments_account_date_idx
  on public.dividend_payments (account_id, report_date desc);

create index if not exists dividend_payments_symbol_idx
  on public.dividend_payments (symbol);

-- RLS
alter table public.dividend_payments enable row level security;

revoke all on public.dividend_payments from anon;
grant select on public.dividend_payments to authenticated;
grant insert, update, delete on public.dividend_payments to authenticated;
grant all on public.dividend_payments to service_role;
