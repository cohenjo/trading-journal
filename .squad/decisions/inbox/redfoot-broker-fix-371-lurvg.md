# LURVG Validation Result: PR #371 — broker-form fix (#359)

**Author:** Redfoot (Tester)
**Date:** 2026-05-12
**Validator commit:** squad/359-broker-form-fix @ 57019b6

---

## Verdict: 🟢 APPROVED

PR #371 (`fix(settings): normalize account_type to lowercase + surface save errors`) is validated and ready to merge.

---

## Pre-fix Reproduction (Reproduce-Before-Fix Rule)

**Bug reproduced on main:** ✅

The original `account_type: "IBKR"` uppercase bug was already patched in `cf2fd19` (`.toLowerCase()` added to `normalizeConfigInput`). However, a related unfixed behavior was identified and reproduced:

- **On main:** `saveTradingConfig` has no duplicate-prevention check. Inserting a second `account_type=schwab` row for the same household silently succeeds (no unique DB constraint on `(household_id, account_type)`). The form shows a **success banner** when it should show a rejection error.
- **Evidence:** `apps/frontend/e2e/lurvg-evidence/pr371-prebug-broker-add-silent-fail.png`
- **Spec:** `e2e/lurvg-pr371-prefix.spec.ts` passed on main ✅ (bug confirmed visible)

---

## Post-fix Validation

**Hockney's spec (2/2):** ✅
- `adds a Schwab account via Settings form and shows success; all 3 tabs visible after reload` ✅
- `negative: second Schwab add shows "already configured" error (duplicate prevention)` ✅
- **Evidence:** `add-broker-schwab-success.png`, `add-broker-schwab-after-reload.png`, `add-broker-schwab-duplicate-error.png`

**`data-testid` verified:**
- `account-tab-ibkr`, `account-tab-schwab`, `account-tab-ira` all visible after reload ✅
- `settings-save-success`, `settings-save-error` both present and functional ✅

---

## Spec Defect Found and Fixed

**Issue:** `add-broker-form.spec.ts` used `page.getByLabel(/account name/i)` to locate the Account Name input. The `TradingAccountSettings.tsx` `<label>` element has **no `htmlFor` attribute** — so Playwright's `getByLabel` can't resolve the association. Both tests timed out.

**Fix applied by Redfoot:** `getByLabel(/account name/i)` → `getByTitle('Account Name')` in both test cases.

**Recommendation for Hockney/Fenster:** Add `htmlFor` / `id` pairing to label+input elements in `TradingAccountSettings.tsx` so `getByLabel` works as expected in future specs.

---

## Smoke Regressions

| Route | Result |
|-------|--------|
| `/dividends` | ✅ Loads, main visible |
| `/ladder` | ✅ Loads, main visible |
| `/summary` | ✅ Loads, main visible |

---

## Test Counts

| Suite | Count |
|-------|-------|
| Unit tests (fix branch) | 492/492 ✅ |
| `account-type.test.ts` (new) | 17/17 ✅ |
| `add-broker-form.spec.ts` (Hockney's e2e) | 2/2 ✅ |
| Smoke e2e | 3/3 ✅ |

---

## DB State

- Production rows intact: `id=1 ibkr/InteractiveBrokers`, `id=71 schwab/Schwab`, `id=72 ira/LeumiIRA` ✅
- Stale test households cleaned up via Supabase MCP ✅
- Note: Pre-existing orphaned E2E rows (ids 181–193) are from prior test runs with no linked households — no impact on production queries (RLS-scoped).

---

## LURVG Closure Checklist

1. ✅ **Deployment SHA verified** — `squad/359-broker-form-fix` @ 57019b6
2. ✅ **DOM assertion** — `account-tab-ibkr`, `account-tab-schwab`, `account-tab-ira` all visible after reload
3. ✅ **`data-testid` presence** — `settings-save-success`, `settings-save-error` confirmed in rendered DOM
4. ✅ **Form save** — success banner visible after Schwab add; error banner visible for duplicate
5. ✅ **Empty-state** — N/A (not applicable for this PR)
6. ✅ **Signed:** Validated by Redfoot (Tester) per LURVG rule. Commit 57019b6.

---

## Notes for Coordinator

- Do **not** merge until this note is reviewed — the spec fix (`getByLabel` → `getByTitle`) is committed on the fix branch. The PR diff will show this change.
- The underlying label-association issue in `TradingAccountSettings.tsx` should be tracked as a follow-up (Fenster domain).
- The orphaned E2E rows in `trading_account_config` (pre-existing from prior sprints) are benign but worth cleanup in a maintenance window.
