-- ================================================================
-- Migration: flex_bond_holdings_snapshot
-- Issue: Flex pipeline Phase 1 — delta 1.2
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
-- Converts bond_holdings from the manual-ladder shape to a
-- Flex-snapshot-capable table.  Manual rows (source IS NULL or
-- source = 'manual') continue to work unchanged.  Flex BOND rows
-- (source = 'flex') use account_id, as_of_date, con_id for
-- idempotent upserts.
-- ================================================================

-- 1. Add Flex-snapshot columns
alter table public.bond_holdings
  add column if not exists account_id       text          null,
  add column if not exists as_of_date       date          null,
  add column if not exists source           text          null,
  add column if not exists con_id           bigint        null,
  add column if not exists cusip            text          null,
  add column if not exists isin             text          null,
  add column if not exists figi             text          null,
  add column if not exists security_id      text          null,
  add column if not exists security_id_type text          null,
  add column if not exists description      text          null,
  add column if not exists sub_category     text          null,
  add column if not exists mark_price       numeric       null,
  add column if not exists market_value     numeric       null,
  add column if not exists cost_basis_price numeric       null,
  add column if not exists cost_basis_total numeric       null,
  add column if not exists unrealized_pnl   numeric       null,
  add column if not exists accrued_interest numeric       null,
  add column if not exists raw_payload      jsonb         null;

-- 2. Relax NOT NULL constraints that Flex BOND data cannot always satisfy
alter table public.bond_holdings
  alter column coupon_rate      drop not null,
  alter column coupon_frequency drop not null,
  alter column issue_date       drop not null,
  alter column issuer           drop not null;

-- 3. Update the issue/maturity CHECK so it only fires when both dates are present
alter table public.bond_holdings
  drop constraint if exists bond_holdings_maturity_after_issue;

alter table public.bond_holdings
  add constraint bond_holdings_maturity_after_issue
    check (issue_date is null or maturity_date > issue_date);

-- 4. Index for Flex snapshot queries (latest snapshot per bond per account)
create index if not exists bond_holdings_account_conid_date_idx
  on public.bond_holdings (account_id, con_id, as_of_date desc);
