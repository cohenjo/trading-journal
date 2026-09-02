-- Migration: Add dividend health metrics and rating columns to stock_positions
-- Enables traffic-light color coding on the /dividends page (Good, OK, Bad)
-- Supported by background Yahoo Finance worker

ALTER TABLE public.stock_positions
  ADD COLUMN IF NOT EXISTS dgr_3y                  NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS dgr_5y                  NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS revenue_growth          NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS payout_ratio            NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS dividend_rating         VARCHAR(16),
  ADD COLUMN IF NOT EXISTS dividend_rating_details JSONB;

-- Index for filtering by dividend_rating if queried directly
CREATE INDEX IF NOT EXISTS stock_positions_dividend_rating_idx
  ON public.stock_positions (dividend_rating);
