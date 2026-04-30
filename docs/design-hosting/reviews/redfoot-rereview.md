# Redfoot Re-review — design.md (v2)

## Verdict: APPROVED WITH CONDITIONS

## Disposition of Previous Findings
| # | Original Finding | Status | Notes |
|---|------------------|--------|-------|
| 1 | No executable phase gates. | ✅ resolved | §11 now gives phase-by-phase pytest/Vitest/Playwright/SQL/migration gates with explicit pass evidence. |
| 2 | Identity linking is undecided. | ✅ resolved | §§13/17 defer email fallback; Google OAuth only until canonical identity linking is proven. |
| 3 | Preview-to-production data leakage risk is not closed. | ✅ resolved | §§9/11/13/15/17 make preview/dev Supabase isolation and CI ref checks mandatory. |
| 4 | Worker/migration concurrency is undefined. | ✅ resolved | §§9/13/15/17 add worker drain plus advisory-lock rehearsal. |
| 5 | Rollback is described but not rehearsable. | ✅ resolved | §12 has per-phase rollback drills and success criteria. |
| 6 | Observability is too passive. | ✅ resolved | §§4.6/14 add `compute_runs`, `household_refresh_state`, stale checks, banners, and owner alerts. |
| 7 | Local-dev parity has no bug-reproduction recipe. | 🟡 partial | §11 requires Supabase local/dev RLS/auth tests and sanitized seed data, but exact repro commands can land in the implementation runbook. |
| 8 | Invite race conditions need constraints. | ✅ resolved | §§5/11/13 specify duplicate/reciprocal invite collapse and transaction tests. |
| 9 | Removed-member data semantics need acceptance tests. | ✅ resolved | §§5/11/13/15 cover shared-row retention, private-row protection, audit, and immediate access loss. |
| 10 | Supabase pause/resume and connection limits need failure tests. | ✅ resolved | §§8/11/13/16 require retry/idempotency, pause/refusal tests, connection stress, and verification notes. |
| 11 | Cooked-table correctness needs reconciliation tests. | ✅ resolved | §§6/11/13/14/15 require raw→compute→cooked reconciliation before successful publish. |

## Residual Issues (only if any)
- Before Phase 1 execution, add a small local/dev repro runbook with concrete commands for Supabase local/dev + sanitized seed data.

## Final Recommendation
ship with the runbook follow-up tracked; no further design pass needed from Redfoot.
