-- Migration: add dividend_yield and market_value_local to stock_positions
-- Directive 2026-05-11-1745: capture point-in-time broker export fields on import
-- Adds:
--   dividend_yield       NUMERIC(8,6)  — annual dividend yield fraction (e.g. 0.1664 = 16.64%)
--   market_value_local   NUMERIC(18,4) — market value in the account's local currency (ILS for Leumi)

ALTER TABLE stock_positions
  ADD COLUMN IF NOT EXISTS dividend_yield     NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS market_value_local NUMERIC(18,4);
