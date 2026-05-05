# Keaton R3 — squad PR merges — 2026-05-05

## Merged

- **#274** (`ci(e2e): fail-fast secrets guard`): All three E2E jobs covered. Guard fires after checkout, before `Setup Node 20` — no runner time wasted. Secret names verified correct. CI green. ✅ Squash-merged.
- **#276** (`docs(backend): IBKR Flex options Phase 0`): Bug fix correct (`transactionType` as primary lookup in `parse_option_eae`). Test covers the fix and all business-critical fields. Gap #3 (`levelOfDetail` double-count risk) flagged High for Phase 1. CI green. ✅ Squash-merged.

## Blocked

- **#275** (`ci(migrations): auto-apply Supabase migrations`): 🔴 Shell injection risk. The `Determine apply mode` step interpolates `${{ github.event.head_commit.message }}` directly into the `run:` shell script body. A malicious or accidental commit message with metacharacters would execute in the runner that holds `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. **Required fix:** move the commit message into an `env:` variable before the `run:` block, then reference it as `"$COMMIT_MSG"`. Comment posted on PR. Label `needs-changes` applied.

## Issues closed

- **#162** — auto-closed by merge of #274 ✅
- **#245** — auto-closed by merge of #276 ✅
- **#170** — remains OPEN; its PR (#275) is blocked pending injection fix

## Still blocked (pre-existing)

- **#244** (eslint 10) — held pending Next 16 ecosystem; `eslint-config-next@15` does not support ESLint 10. Block comment intact.
- **#236** (Next 16) — held pending human sign-off on major framework bump. Block comment intact.

## Notes for team

- **Kujan:** fix the commit-message injection in #275 (move to `env:` block) and re-request review. Everything else in that workflow is solid.
- **McManus (#265):** `raw_payload.get("notes")` is available without any parser change — unblocked as of #276 merge.
- **Gap #3 follow-up:** Phase 1 must enforce `levelOfDetail == "EXECUTION"` filter in `parse_flex_files` to prevent double-counting ORDER vs EXECUTION rows.
