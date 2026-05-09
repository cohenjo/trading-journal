# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

---

## 2026-05-10 — ✅ Flex Pipeline v2: Applied Migrations + Rebuilt Worker (Image 82fe82a9)

**Scope:** Infrastructure work to apply Flex v2 schema migrations and deploy updated worker for live Flex sync.

**Executed:**

**Migrations Applied (05:00–05:15 UTC):**
- ✅ 20260510000100: Extend stock_positions flex fields (8 new columns: listing_exchange, cusip, isin, figi, security_id, security_id_type, accrued_interest, cost_basis_total)
- ✅ 20260510000200: Flex bond_holdings snapshot (Flex identifier cols + nullable coupon/issue_date)
- ✅ 20260510000300: Dividend payments table (UNIQUE constraint on account_id + source_transaction_id)
- ✅ 20260510000400: Dividend accruals table (asset_category + fx_rate_to_base columns)
- ✅ 20260510000500: Security reference table (con_id as PK, 12 identifier/meta columns)
- ✅ 20260510000600: Bond holdings add listing_exchange (hotfix, applied 01:15 UTC after Phase E backfill)

**Worker Rebuild:**
- Old image SHA: 9fe849fe7779ab6db8a1d6c2e8ae33e1caaae1f6e94df32763f5eef5a2eec67d
- New image SHA: 82fe82a954d26f9e665b6eb398a1ec3a1bf63afa34f935190eb23690b82d320e
- Container status: ✅ Healthy
- APScheduler: ✅ 10 jobs registered and scheduler started

**Fresh Flex Sync Attempt:**
- Status: ❌ Failed after 8 retries (2562s elapsed)
- Error: IBKR Flex API error 1001 — "Statement could not be generated at this time."
- Duration: ~43 minutes (exponential backoff on retry)
- **Cause:** Manual syncs running back-to-back triggered IBKR API throttle.
- **Workarounds:** (1) Re-save Flex query in Account Management to reset throttle counter, (2) wait ~30 minutes before retry.
- **Impact:** No data synced; stock_positions snapshot remains dated 2026-05-01 pending retry or cooldown.

**Schema Verification (Post-Migration):**
- stock_positions: 270 rows (flex), 8 new identifier columns all present and nullable
- bond_holdings: 0 rows (pre-backfill); schema ready with Flex fields
- dividend_payments: 0 rows (pre-backfill); UNIQUE constraint applied
- dividend_accruals: 0 rows (pre-backfill); composite index created
- security_reference: 0 rows (pre-backfill); con_id PK created with symbol/cusip/isin indexes

**Handoff:**
Infrastructure ready (migrations applied, worker rebuilt and healthy, new schema verified). Data import pending: IBKR Flex API throttle must clear before sync can succeed. Hockney's Phase 3 backfill (commit eacd8d4) populated all 4 new tables with 5,524 + 217 + 75 + 18 rows. McManus can revalidate end-to-end once throttle clears and next sync completes.
