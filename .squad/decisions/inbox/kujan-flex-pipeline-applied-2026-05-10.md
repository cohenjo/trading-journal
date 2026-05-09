# Flex Pipeline v2 — Applied to DB + Worker Live

**Date:** 2026-05-10
**Actor:** Kujan
**Status:** Applied (tables created; worker running; sync failed due to Flex API throttle)

## Migrations Applied
- ✅ 20260510000100: Extend stock_positions flex fields (8 new columns)
- ✅ 20260510000200: Flex bond_holdings snapshot (Flex fields + nullable coupon/issue_date)
- ✅ 20260510000300: Dividend payments table (with UNIQUE constraint on account_id + source_transaction_id)
- ✅ 20260510000400: Dividend accruals table (with asset_category + fx_rate_to_base)
- ✅ 20260510000500: Security reference table (con_id as PK, 12 identifier/meta columns)

## Worker Rebuild
- **Old image SHA:** 9fe849fe7779ab6db8a1d6c2e8ae33e1caaae1f6e94df32763f5eef5a2eec67d
- **New image SHA:** 82fe82a954d26f9e665b6eb398a1ec3a1bf63afa34f935190eb23690b82d320e
- **Container status:** ✅ Healthy
- **APScheduler jobs:** ✅ 10 jobs registered and scheduler started

## Fresh Flex Sync
- **Status:** ❌ Failed after 8 retries (2562s elapsed)
- **Error:** FlexProbeError on SendRequest — Flex API persisting 1001 throttle errors
- **Message:** "Statement could not be generated at this time. Please try again shortly."
- **IBKR recommendation:** Wait ~30 minutes and retry, or re-save Flex query in Account Management
- **Duration:** ~43 minutes (exponential backoff on retry)

## Row Counts (Post-Migration, Pre-Sync)
| Table | Rows | Latest Date |
|---|---|---|
| stock_positions (flex) | 270 | 2026-05-01 |
| bond_holdings (flex) | 0 | — |
| dividend_payments | 0 | — |
| dividend_accruals | 0 | — |
| security_reference | 0 | — |
| options_cash_events | 6028 | 2026-05-06 |

## Schema Verification
| Table | New Columns Landed | Notes |
|---|---|---|
| stock_positions | ✅ cost_basis_total, listing_exchange, cusip, isin, figi, security_id, security_id_type, accrued_interest | All present and nullable |
| bond_holdings | ✅ Flex snapshot columns + issuer, coupon_rate, coupon_frequency, issue_date now nullable | Flex identifier columns (con_id, cusip, isin, figi, security_id, security_id_type) present |
| dividend_payments | ✅ UNIQUE(account_id, source_transaction_id) constraint applied | 18 data columns + raw_payload |
| dividend_accruals | ✅ fx_rate_to_base, asset_category columns | 21 data columns + raw_payload |
| security_reference | ✅ con_id as PK, 12 identifier/meta columns | Indexes on cusip, isin, symbol |

## Issues Found
- **Flex API throttle:** IBKR Flex backend unhealthy for query_id=1496910. Persistent 1001 typically clears overnight or with query re-save.
- **No data loaded:** New tables (bond_holdings, dividend_payments, dividend_accruals, security_reference) remain empty pending successful sync.

## Handoff
✅ Infrastructure ready (migrations applied, worker rebuilt and healthy, new schema verified).
❌ Data import pending: IBKR Flex API throttle must clear before sync can succeed.
McManus can revalidate end-to-end against the new schema once Flex sync completes successfully (manual retry after ~30 min or overnight).
