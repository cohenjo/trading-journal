
**Tests:** 789 passed, 9 failed — identical to pre-existing baseline. No new failures from the postcss upgrade. Tailwind CSS class generation, which exercises postcss at build time, produced zero errors in the test suite.

**tsconfig.json:** Mutated by Next build again as expected. Reverted cleanly. Commit staged exactly 2 files (package.json + package-lock.json).

## Learnings

**An npm `overrides` block is the correct tool when a parent version bump doesn't flatten a transitive CVE.** Next.js vendors postcss inside its own node_modules subtree — bumping `next` itself does not update the bundled postcss version. `overrides` forces the resolution regardless of nesting depth. This is different from `resolutions` (Yarn/pnpm) — npm's `overrides` key is the npm-specific equivalent.

**Both the nested AND the top-level postcss were below the fix threshold.** This means two audit entries for the same CVE. After the override, both collapsed to one deduped instance at 8.5.15 — cleaner tree structure as a side-effect.

**Pair every parent version bump with an immediate `npm audit` diff check.** The Next.js bump from 16.2.6 → 16.2.7 did not clear postcss — this was only discovered because Rabin ran a separate security triage. CI should capture `npm audit --json` output before and after a dep bump PR so vuln counts are visible in the PR diff. Filing a decision for this.

## 2026-06-04: Next.js 16.2.6→16.2.7 Bump (Phase 1+2)

**Phase 1 (per Keaton):** Bumped next + eslint-config-next to 16.2.7
- Commit d87a0ac: clean bump, build ✅, tests ✅ (baseline 789/798)
- Middleware deprecation warning observed (expected, scheduled for migration)

**Phase 2 (per Rabin):** Applied postcss override ^8.5.10
- Commit 2eb1ca0: GHSA-qx2v-qp2m-jg93 cleared
- All postcss instances resolve to 8.5.15 (deduped)

**Decisions authored:**
- "middleware.ts Proxy Migration Should Be Scheduled" (separate sprint task)
- "Add npm audit diff step to dependency bump PRs in CI" (proposal for future improvement)

**Skills authored:** `.squad/skills/safe-dependency-patch-bump/SKILL.md` (updated with override pattern)

**Related decision:** Merged to `.squad/decisions.md` on 2026-06-04T11:00 UTC
