# LURVG Validation Note — PR #375 RLS Policies Fix

**From:** Redfoot (Tester)
**Date:** 2026-05-11
**PR:** #375 — `fix(security): add RLS policies for dividend tables, disable RLS on security_reference (#374)`
**Issue:** #374
**Commit validated:** `7856c87`

---

## Verdict: 🟢 APPROVED — SAFE TO MERGE

---

## Summary

PR #375 removes the `createAdminClient()` workaround (PR #368) from `getDividendPositions()` and switches to standard `createClient()`. The migration `20260511102251_add_rls_policies_dividend_disable_security_reference` — already applied to production DB — enables this by:

1. Adding household-scoped SELECT policies on `dividend_payments` + `dividend_accruals`
2. Disabling RLS on `security_reference` (global reference table, no per-household data)

This LURVG validates that the standard cookie-client can read through the new policies.

---

## Evidence

### DB State (Supabase MCP `execute_sql`)

| Check | Result |
|-------|--------|
| `pg_policy` on `dividend_payments` | `dividend_payments_select` (r) ✅ |
| `pg_policy` on `dividend_accruals` | `dividend_accruals_select` (r) ✅ |
| `pg_tables.rowsecurity` for `security_reference` | `false` ✅ |
| Migration version in `supabase_migrations` | `20260511102251` tracked ✅ |
| `SELECT count(*) FROM security_reference` | 75 rows (accessible, RLS disabled) ✅ |

### Unit Tests

- **518/519** passing (1 pre-existing failure)
- Failing test: `LadderPage — displays coupon_rate as percentage string, not raw decimal` (`"4.250%"` ≠ `"4.25%"`)
- Confirmed same failure on `main` branch — **pre-existing, unrelated to #375** ✅
- Recommendation: file separate follow-up issue for coupon formatting

### Playwright LURVG (5/5 passed)

| Test | Result |
|------|--------|
| `/dividends` IBKR — table populated (JEPI, O, GS) via `createClient()` | ✅ PASS |
| `/dividends` Schwab — correct empty state | ✅ PASS |
| `/ladder` IBKR — bonds populated, no regression | ✅ PASS |
| `/summary` — loads, no regression | ✅ PASS |
| `/trading/accounts` — 3 tabs visible (regression #371) | ✅ PASS |

### DOM Evidence (dividends-positions-table)

```
dividend-row-GS  — 100 qty, $50.00 price, TTM yield 31.00%, Fwd Annual $1,800.00
dividend-row-JEPI — 100 qty, $50.00 price, TTM yield 28.40%, Fwd Annual $537.00
dividend-row-O    — 100 qty, $50.00 price, TTM yield 23.72%, Fwd Annual $325.00
```

### Negative Test (unauthenticated)

`curl http://localhost:3000/dividends` → `307` redirect (auth redirect — NOT 500) ✅

---

## RLS Seed Strategy Note (for future validators)

The new RLS policy uses:
```sql
account_id IN (
  SELECT account_id FROM trading_account_config
  WHERE is_household_member(household_id)
)
```

**Critical:** Seed `trading_account_config` with the **real** IBKR broker number (`U2515365`), not a generated fake string. A fake account_id causes the RLS join to return 0 rows — the dividends table shows empty state, which is visually indistinguishable from an RLS block. The test passes for the wrong reason.

Also: filter `trading_account_config` selects by **both** `account_id` AND `household_id` after seeding `U2515365`, because this account_id already exists in Jony's household row — `.single()` fails with multiple rows without the household filter.

---

## Screenshots

- `apps/frontend/e2e/lurvg-evidence/pr375-postfix-dividends-ibkr-populated.png`
- `apps/frontend/e2e/lurvg-evidence/pr375-postfix-dividends-schwab-empty.png`
- `apps/frontend/e2e/lurvg-evidence/pr375-postfix-ladder-ibkr-populated.png`
- `apps/frontend/e2e/lurvg-evidence/pr375-postfix-summary.png`
- `apps/frontend/e2e/lurvg-evidence/pr375-postfix-accounts-tabs.png`

---

**Validated by Redfoot (Tester) per LURVG Path 2. Commit `7856c87`.**
