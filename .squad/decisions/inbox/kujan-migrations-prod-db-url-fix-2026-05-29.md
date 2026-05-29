# Kujan — Production Supabase migrations fallback (2026-05-29)

## Context

The `Supabase — Apply Migrations to Production` workflow has failed on every run since 2026-05-12, including the PR #483 merge run on 2026-05-29. The latest failing run (`26639977905`) stopped before checkout because `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` were not set.

Because those failures blocked production migration applies, the credit-card expense pipeline tables never reached production:

- `expense_inbox`
- `expense_categories`
- `credit_card_statements`
- `credit_card_transactions`
- `merchant_category_mappings`

## Decision

Keep the preferred Supabase CLI linked-project path when `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are present. Add `SUPABASE_PROD_DB_URL` as the emergency fallback path when the Management API secrets are unavailable.

The first DB-URL implementation tried Supabase CLI `--db-url`, but the production project still has known migration-history drift from the 2026-05-13 audit. `supabase db push --db-url` correctly connected, then failed because production tracks remote-only migration versions that do not exist locally.

Given that prior Kujan decision says to use targeted direct `psql` applies until drift is reconciled, the fallback now uses direct `psql` for the idempotent credit-card expense pipeline migrations and verifies the five required production tables exist afterward.

The workflow must not print the connection string; it masks the secret before using it.

## Follow-up recommendation

When Jony is available, add the proper `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` GitHub Actions secrets so both migration paths are available. Keep `SUPABASE_PROD_DB_URL` as a break-glass fallback for production incidents.
