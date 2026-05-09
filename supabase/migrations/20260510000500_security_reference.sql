-- ================================================================
-- Migration: security_reference
-- Issue: Flex pipeline Phase 1 — delta 1.5
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-10
-- ================================================================
-- Canonical identifier cross-reference seeded from OpenPositions
-- (source='open_positions') and updated from FinancialInstrumentInformation
-- (source='fii') rows.  con_id is the primary key; all other fields are
-- upserted on each sync so the table stays current.
-- ================================================================

create table if not exists public.security_reference (
  con_id            bigint        primary key,
  symbol            text          null,
  description       text          null,
  asset_category    text          null,
  sub_category      text          null,
  currency          text          null,
  listing_exchange  text          null,
  cusip             text          null,
  isin              text          null,
  figi              text          null,
  security_id       text          null,
  security_id_type  text          null,
  issuer            text          null,
  maturity          date          null,    -- populated from FII when available
  issue_date        date          null,    -- populated from FII when available
  raw_payload       jsonb         null,
  source            text          null,    -- 'open_positions' | 'fii'
  last_seen_at      timestamptz   not null default now()
);

create index if not exists security_reference_symbol_idx
  on public.security_reference (symbol);

create index if not exists security_reference_isin_idx
  on public.security_reference (isin)
  where isin is not null;

create index if not exists security_reference_cusip_idx
  on public.security_reference (cusip)
  where cusip is not null;

-- RLS: service_role writes; authenticated reads
alter table public.security_reference enable row level security;

revoke all on public.security_reference from anon;
grant select on public.security_reference to authenticated;
grant all on public.security_reference to service_role;
