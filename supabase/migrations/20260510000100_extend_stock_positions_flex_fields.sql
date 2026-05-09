-- ================================================================
-- Migration: extend_stock_positions_flex_fields
-- Issue: Flex pipeline Phase 1 — delta 1.1
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
-- Adds identifier columns (listing_exchange, cusip, isin, figi,
-- security_id, security_id_type), cost_basis_total, and
-- accrued_interest to stock_positions.  Adds a covering index to
-- support the DISTINCT ON (account_id, ticker) ORDER BY as_of_date
-- DESC pattern used by the /accounts/positions endpoint.
-- ================================================================

alter table public.stock_positions
  add column if not exists cost_basis_total   numeric       null,
  add column if not exists listing_exchange   text          null,
  add column if not exists cusip              text          null,
  add column if not exists isin               text          null,
  add column if not exists figi               text          null,
  add column if not exists security_id        text          null,
  add column if not exists security_id_type   text          null,
  add column if not exists accrued_interest   numeric       null;

-- Index supporting DISTINCT ON latest-snapshot queries.
create index if not exists stock_positions_account_ticker_date_desc_idx
  on public.stock_positions (account_id, ticker, as_of_date desc);
