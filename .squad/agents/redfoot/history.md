1. **Fix #6 (server action ↔ middleware loop):** `middleware.test.ts` exists but only tests pure path-classification logic. No integration or E2E test covers an actual server action routed through middleware. Recommend: Playwright spec that POSTs a server action through an authenticated middleware-protected route.
2. **Fix #11 (FormData preservation):** `CSVImportButton.test.tsx` asserts `expect.any(FormData)` is passed to the action call site, but does not test that Next.js internal plumbing preserves all fields. Recommend: E2E test that submits a multi-field FormData payload through a real server action and asserts all fields arrive.
3. **Fix #12 (Turbopack PostCSS config):** No explicit CSS unit test. Covered implicitly by the build step (Tailwind → postcss → CSS pipeline runs in production build). Acceptable implicit coverage.
4. **Fix #3 (dev-mode hydration):** No automated test possible — dev-experience-only issue. Not applicable to CI.

**Smoke-test pattern crystallized:**
- `timeout 20 npm run dev 2>&1` is sufficient to confirm Turbopack starts and middleware loads for Turbopack-touching bumps. A build passing alone is NOT enough — Turbopack module-resolution failures only surface in dev mode. Always smoke the dev server when the upstream changelog mentions a Turbopack hash or path-resolution change.

**Skill produced:** `.squad/skills/dependency-bump-reviewer-gate/SKILL.md`

## 2026-06-04: Reviewer Gate — squad/deps-next-16-2-7

**Verdict:** ✅ APPROVED
**Gate result:** 13/13 checklist pass

**Verification:**
- Branch: squad/deps-next-16-2-7 (2 commits)
- Build: cold compile 3.7s, exit 0 ✅
- Tests: 789 passed, 9 pre-existing failures (exact baseline) ✅
- npm audit: GHSA-qx2v-qp2m-jg93 cleared, 5 pre-existing remain ✅
- Dev: Turbopack 317ms ready ✅
- Files: package.json + lock only (no scope creep) ✅

**Test-gap recommendations (non-blocking):**
1. Add integration test: server action through middleware round-trip
2. Add E2E test: FormData preservation through server action

**Skill authored:** `.squad/skills/dependency-bump-reviewer-gate/SKILL.md`

**Related decision:** Merged to `.squad/decisions.md` on 2026-06-04T11:00 UTC
