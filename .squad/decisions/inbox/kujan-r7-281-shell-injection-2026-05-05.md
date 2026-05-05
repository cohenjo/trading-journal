# Decision: Kujan R7 — Shell-Injection Hardening for playwright-e2e.yml (Issue #281)

**Date:** 2026-05-05
**Author:** Kujan (DevOps/Platform)
**Squad version:** 0.9.4
**Issue:** [#281](https://github.com/cohenjo/trading-journal/issues/281)
**PR:** [#289](https://github.com/cohenjo/trading-journal/pull/289)
**Precedent:** PR #275 (supabase-migrations.yml, Round 4)

---

## What Was Found

Two `${{ ... }}` expressions were interpolated directly into `run:` shell bodies in `.github/workflows/playwright-e2e.yml`:

| Location | Expression | Risk |
|---|---|---|
| Line 297 — `case` statement | `${{ inputs.suite }}` | LOW — `type: choice` constrains values today, but violates hardening convention |
| Line 305 — `npx playwright test` arg | `${{ steps.grep.outputs.pattern }}` | LOW — output is derived from the same constrained input, but still unsafe pattern |

A full sweep of all other `.github/workflows/*.yml` files found **no additional occurrences** of user-controlled expressions inside `run:` bodies.

## What Was Fixed

Both occurrences were moved to step-scoped `env:` variables, following the same pattern established in PR #275:

```yaml
# Before (unsafe):
run: |
  case "${{ inputs.suite }}" in ...

# After (safe):
env:
  SUITE: ${{ inputs.suite }}
run: |
  case "$SUITE" in ...
```

```yaml
# Before (unsafe):
run: npx playwright test --grep "${{ steps.grep.outputs.pattern }}"

# After (safe):
env:
  GREP_PATTERN: ${{ steps.grep.outputs.pattern }}
run: npx playwright test --grep "$GREP_PATTERN"
```

No workflow logic was changed.

## Decision

**Going forward:** All user-controlled GitHub Actions expressions (`inputs.*`, `github.event.*`, `github.head_ref`, `github.ref_name`, step outputs) MUST be passed to shell via step-scoped `env:` variables and referenced as quoted shell variables (`"$VAR"`). Direct interpolation into `run:` bodies is prohibited.

This completes the shell-injection audit started in Round 3 and remediated across:
- Round 4: `supabase-migrations.yml` (PR #275)
- Round 7: `playwright-e2e.yml` (PR #289)

**No follow-up issues were filed** — the audit found no remaining unsafe patterns.
