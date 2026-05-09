-- Hotfix: bond_holdings missing listing_exchange column
-- Referenced by _sync_bond_positions() in options_sync.py but not added in 20260510000200.
-- Discovered during Phase E of the Flex pipeline v2 backfill (commit eacd8d4).

ALTER TABLE public.bond_holdings
  ADD COLUMN IF NOT EXISTS listing_exchange TEXT;

COMMENT ON COLUMN public.bond_holdings.listing_exchange
  IS 'IBKR Flex listingExchange field (e.g., NYSE, ARCA). Populated from OpenPositions row.';
