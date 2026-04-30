# Rabin — RLS Rollout for Public Tables (#97)

## Decision

Enable RLS on the 20 remaining public tables flagged by Supabase advisor and keep `public.trading_account_secrets` dropped. Do not redesign ownership in this pass; use the ownership columns and helper functions that already landed in the Phase 1 sharing migrations.

## Policy shape

- **Household-scoped tables** (`manualtrade`, `trade`, `execution`, `matchedtrade`, `dailysummary`, `trading_account_summary`, `trading_positions`, `finance_snapshots`, `plans`, `dividend_positions`, `dividend_accounts`, `insurance_policies`):
  - `SELECT TO authenticated`: `public.is_household_member(household_id)`.
  - `INSERT/UPDATE/DELETE TO authenticated`: `public.is_household_writer(household_id)`.
  - `household_id IS NOT NULL` is required in every predicate; legacy null-owned rows stay hidden until a data-aware backfill assigns tenancy.

- **Owner-private tables** (`note`, `backtestrun`):
  - Use `owner_user_id = auth.uid()` because migration `20260430130200_add_owner_user_id.sql` explicitly classified them as owner-private.
  - Deviation from household helper template is intentional; no safe household default exists for legacy personal notes/backtest runs.

- **Inherited-owner table** (`backtesttrade`):
  - No direct ownership column. Access is inherited through `backtesttrade.run_id -> backtestrun.id` with parent `owner_user_id = auth.uid()`.
  - This follows the documented design in `20260430130200_add_owner_user_id.sql` and avoids duplicating owner columns.

- **Reference / market data tables** (`dailybar`, `ndx1m`, `optioncontract`, `historicaloptionbar`, `dividend_ticker_data`):
  - `SELECT TO authenticated USING (true)` only.
  - No anon policies and no authenticated write policies. Market-data writes remain service-role job responsibility.

- **Secrets table** (`trading_account_secrets`):
  - Keep dropped. Broker secrets are out of product scope; if broker integrations return, use Supabase Vault or a dedicated secret design rather than a public table.

## Helper signature

No new helper signatures were introduced. Household policies use existing `p_household_id` helpers from `20260430150000_sharing_rls_policies.sql`: `is_household_member(p_household_id uuid)` and `is_household_writer(p_household_id uuid)`.

## Rollout plan

1. Apply migrations to **dev project only** (`zvbwgxdgxwgduhhzdwjj`) with `supabase db push`.
2. Verify Supabase advisor has `0` `rls_disabled_in_public` errors in dev.
3. Merge PR after CI.
4. Production rollout remains a manual gated operation: apply the same committed migrations to prod after dev smoke testing and any Redfoot E2E isolation tests pass.

## Migration replay note

While validating with `supabase start`, migration `20260430150000_sharing_rls_policies.sql` failed on a fresh database because the older helper migration used parameter name `hid`, while the established helper signature is `p_household_id`. I aligned `20260430120100_rls_helpers.sql` to `p_household_id` so fresh replay matches the already-approved decision and the later `CREATE OR REPLACE FUNCTION` statements can run cleanly.
