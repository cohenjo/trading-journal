-- Migration: 20260430160100_drop_account_secrets_table
-- Author: Rabin (Security Engineer)
-- Purpose: Defense-in-depth drop for issue #97. Broker secrets are out of scope for
--          this product; no public table should exist for account credentials.
-- Decision reference: .squad/decisions.md "DROP public.trading_account_secrets entirely".

DROP TABLE IF EXISTS public.trading_account_secrets CASCADE;

-- end of migration
