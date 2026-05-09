-- ================================================================
-- Migration: dividend_accruals
-- Issue: Flex pipeline Phase 1 — delta 1.4
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
-- Landing table for IBKR ChangeInDividendAccruals and
-- OpenDividendAccruals sections.  source_section distinguishes
-- 'change' (ChangeInDividendAccruals) from 'open' (OpenDividendAccruals).
-- No unique idempotency key — caller re-deletes by (account_id, report_date,
-- source_section) before each sync window to avoid accumulation.
-- ================================================================

create table if not exists public.dividend_accruals (
  id              bigserial     primary key,
  account_id      text          not null,
  symbol          text          null,
  con_id          bigint        null,
  description     text          null,
  currency        text          null,
  ex_date         date          null,
  pay_date        date          null,
  date            date          null,
  quantity        numeric       null,
  gross_rate      numeric       null,
  gross_amount    numeric       null,
  tax             numeric       null,
  fee             numeric       null,
  net_amount      numeric       null,
  code            text          null,
  report_date     date          null,
  source_section  text          null,    -- 'change' | 'open'
  fx_rate_to_base numeric       null,
  asset_category  text          null,
  raw_payload     jsonb         null,
  created_at      timestamptz   not null default now()
);

create index if not exists dividend_accruals_account_date_idx
  on public.dividend_accruals (account_id, ex_date desc);

create index if not exists dividend_accruals_symbol_idx
  on public.dividend_accruals (symbol);

create index if not exists dividend_accruals_report_date_idx
  on public.dividend_accruals (account_id, report_date desc, source_section);

-- RLS
alter table public.dividend_accruals enable row level security;

revoke all on public.dividend_accruals from anon;
grant select on public.dividend_accruals to authenticated;
grant insert, update, delete on public.dividend_accruals to authenticated;
grant all on public.dividend_accruals to service_role;
