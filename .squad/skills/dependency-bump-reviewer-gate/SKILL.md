---
name: dependency-bump-reviewer-gate
author: redfoot
created: 2026-06-04T10:51:29.757+03:00
tags: [npm, dependencies, review, security, testing, quality-gate]
---

# Dependency Bump — Reviewer Gate

Independent verification checklist for Redfoot to sign off on a dependency bump PR before it is pushed. This is the **reviewer** counterpart to Fenster's `safe-dependency-patch-bump` skill.

> Verdict options: ✅ APPROVED | ⚠️ APPROVED WITH NOTES | ❌ REJECTED

---

## When to Use

- A dep-bump branch is waiting for review before push/PR.
- The branch was produced by another agent (usually Fenster).
- The Coordinator or Jony has spawned Redfoot as the reviewer gate.

---

## Checklist

### 1. Branch & Commit Hygiene

```bash
git branch --show-current         # must be squad/deps-{pkg}-{version}
git log --oneline -5               # confirm exactly N commits ahead of main
git diff main...HEAD --name-only   # ONLY package.json + package-lock.json
git log <sha1> -1 --stat           # inspect each commit individually
git diff main...HEAD -- apps/frontend/package.json
```

**Gates:**
- [ ] Branch name matches convention: `squad/deps-*`
- [ ] Exactly the expected number of commits ahead of main
- [ ] `package.json` diff contains ONLY: version pins for the target package(s) + optional new `overrides` block — nothing else
- [ ] `package-lock.json` is the only other file changed
- [ ] `tsconfig.json` is NOT in the diff (Next.js build rewrites it; must be reverted before commit — see SKILL: safe-dependency-patch-bump)

**Red flags that trigger REJECTED:**
- Extra files changed (source code, configs, migrations)
- `tsconfig.json` present in committed diff
- More version bumps than approved (scope creep)

---

### 2. Installed Dependency State

```bash
cd apps/frontend
npm ls <package>           # must show the target version
npm ls <transitive-pkg>    # every entry must be >= fix threshold; look for "deduped"
```

**Gates:**
- [ ] Target package(s) installed at expected version
- [ ] If an `overrides` block was added: every instance of the overridden package in `npm ls` shows the new version + `deduped` annotation on subtree copies
- [ ] No unexpected version at the root level

---

### 3. npm Audit (Independent Re-run)

```bash
npm audit --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d['metadata']['vulnerabilities'])
for name, info in d['vulnerabilities'].items():
    for v in info.get('via', []):
        if isinstance(v, dict):
            print(f'[{info[\"severity\"]}] {name}: {v.get(\"url\")} — {v.get(\"title\")}')
"
```

**Gates:**
- [ ] Any GHSA/CVE that the PR claims to fix is **absent** from output
- [ ] Total vulnerability count did not increase vs main baseline
- [ ] No new HIGH or CRITICAL advisories introduced

**Notes (non-blocking):**
- List all remaining advisories and note they are pre-existing
- Do NOT block the gate on pre-existing advisories outside the PR scope

---

### 4. Cold Build

```bash
rm -rf .next              # cold build — no cached artifacts
npm run build 2>&1
echo "Exit: $?"
```

**Gates:**
- [ ] Exit code 0
- [ ] No new warnings beyond pre-established baseline (e.g., for Next.js bumps: the middleware deprecation warning is pre-existing)
- [ ] `tsconfig.json` is reverted after build if it was modified: `git checkout -- apps/frontend/tsconfig.json`

**Capture:**
- Compile time (sanity check against prior reports)
- Static route count + Dynamic route count (note discrepancy if different from prior baseline — growth is OK, shrinkage is a red flag)

---

### 5. Test Verification

```bash
npm run test 2>&1 | tail -20
```

**Gates:**
- [ ] Pass count matches pre-bump baseline exactly
- [ ] Failure count matches pre-bump baseline exactly
- [ ] **The SPECIFIC failures are the SAME pre-existing ones** (check by test name, not just count)
- [ ] Any new failure not in the prior baseline = **hard REJECT**

**How to identify pre-existing failures:** Compare test names in this run against the failure list documented in the bump skill or history. For this repo's frontend:
- `dividend-positions.test.ts` — TTM yield ×2
- `UnresolvedQueue.test.tsx` — Hebrew UI elements ×6
- `SettingsContext.test.tsx` — default params ×1

---

### 6. Dev Server Smoke Test (Critical for Turbopack-touching bumps)

```bash
timeout 20 npm run dev 2>&1
```

**Gates:**
- [ ] Turbopack starts without module resolution errors
- [ ] No stack traces in startup output
- [ ] Middleware loads (deprecation warning acceptable; runtime failure is not)
- [ ] `✓ Ready in Xs` line appears

**When this matters most:** Any Next.js bump that includes a Turbopack change (fix #7 in 16.2.7 = base40→base38 hash encoding). A broken Turbopack hash silently fails module resolution in dev mode.

---

### 7. Regression Risk Assessment (for app-relevant fixes)

For each fix in the upstream changelog that touches this app's surface:

1. Does the test suite exercise the affected code path?
2. If not, flag as a **test-gap recommendation** (non-blocking).
3. Only block if a test explicitly fails due to the bump.

**Template for test-gap note:**
> Fix #{N} ({description}) is not covered by automated tests. Recommendation: add {test type} that exercises {specific code path} to prevent silent regression.

---

### 8. Decision-Trail Audit

- [ ] Read all relevant inbox files before the bump (`keaton-*.md`, `rabin-*.md`, `fenster-*.md`)
- [ ] Confirm implementation matches every approved decision
- [ ] Confirm no decisions were silently violated (e.g., scope expansion, extra file changes, wrong package manager key used for overrides)

---

## Output Format

```
✅/⚠️/❌  VERDICT — one sentence

### Checklist results
[table or list, one line per gate]

### Remaining advisories (non-blocking)
[list]

### Test-gap recommendations
[list, non-blocking]

### Push/PR command (if APPROVED)
git push -u origin <branch>
gh pr create ...
```

---

## REJECT Protocol

If you issue a ❌ REJECTED verdict:
- Name the **specific failing gate** (not just "something looks wrong")
- Name a **specific next agent (NOT Fenster)** to address the concern — per Reviewer Rejection Protocol, Fenster is locked out of revising rejected work on this artifact
- Drop the verdict in `.squad/decisions/inbox/redfoot-{slug}-verdict.md`

---

## Known Gotchas for This Repo

| Gotcha | What to look for |
|---|---|
| `tsconfig.json` rewrite by `next build` | Check it is NOT in `git diff main...HEAD --name-only` |
| `npm ls` showing 2 postcss entries | Expected if no override — check for deduped after override |
| Route count drift vs old baseline | App grows; count can increase. Shrinkage = red flag |
| Test exit code 0 despite 9 failures | Vitest exits 0 for known pre-existing failures — check test names, not just exit code |
| Turbopack hash change in Next.js bump | Always smoke the dev server; build success alone doesn't confirm Turbopack module resolution |
| TLS warning in build output | `NODE_TLS_REJECT_UNAUTHORIZED=0` from env.local — pre-existing, not a new warning |
| `npm audit` counts packages not CVEs | `metadata.vulnerabilities.total` counts unique packages; total individual CVEs can be higher |

---

## Real-World Application

2026-06-04 — squad/deps-next-16-2-7 (next 16.2.6→16.2.7 + postcss override):
- All 13 gates passed
- GHSA-qx2v-qp2m-jg93 cleared by `overrides: { postcss: "^8.5.10" }`
- 789 passed / 9 pre-existing failures (exact baseline)
- Build: exit 0, 3.7s cold compile
- Dev: Turbopack ready in 317ms
- Route count: 23 static + 13 dynamic (growth from baseline, expected)
- Verdict: ✅ APPROVED
