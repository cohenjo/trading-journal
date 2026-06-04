---
name: safe-dependency-patch-bump
author: fenster
created: 2026-06-04T10:51:29.757+03:00
tags: [npm, dependencies, patch-bump, next.js, maintenance]
---

# Safe Dependency Patch Bump

Reusable workflow for applying low-risk patch-version dependency bumps in this repo without introducing regressions or polluting the diff.

---

## When to Use

- A team member or coordinator has approved a patch bump (x.y.Z → x.y.Z+1) for one or more npm packages.
- The change is PIN-only (no new APIs, no config flag changes, no route changes).
- Package manager is **npm** (confirmed by presence of `package-lock.json`; no pnpm/yarn lockfile).

---

## Checklist

### 1. Git Hygiene

```bash
cd /path/to/repo
git status && git branch --show-current
```

- **On `main`/`master`**: create a branch: `git checkout -b squad/deps-{package}-{version}`
- **On a feature branch with uncommitted frontend work**: STOP — do not pollute WIP.
- **On a feature branch with only squad/ or doc files unstaged**: safe to proceed on a new branch from that state.

### 2. Capture Pre-Bump Baseline

Before any changes, capture the current lint/test failure counts:

```bash
cd apps/frontend
npm run lint 2>&1 | tail -3    # capture "X problems (Y errors, Z warnings)"
npm run test 2>&1 | tail -5    # capture "X passed, Y failed"
```

Store these numbers. Any new failures after the bump that weren't in this baseline are regressions.

### 3. Edit package.json — Pins Only

Change only the target package versions. Touch nothing else.

```bash
# Verify the diff is exactly what you expect before installing
git diff apps/frontend/package.json
```

### 4. Install

```bash
cd apps/frontend && npm install
```

Verify the resolved version:

```bash
npm ls <package-name>
# Expected: <package-name>@<new-version>
```

### 5. Validate (stop on genuine regression)

```bash
npm run lint   # compare to baseline — new errors = regression
npm run test   # compare to baseline — new failures = regression
npm run build  # must exit 0
```

#### tsconfig.json guard (Next.js specific)

`next build` silently rewrites `tsconfig.json`:
- Changes `jsx: "preserve"` → `"react-jsx"`
- Injects `.next/dev/types/**/*.ts` into `include`

**Always revert before committing:**

```bash
git checkout -- apps/frontend/tsconfig.json
git diff apps/frontend/tsconfig.json  # must be empty
```

This is enforced by Keaton's merge gate criterion #8. If tsconfig appears in the diff, the PR will be blocked.

### 6. Commit — Staged Files Only

Stage **only** the two modified files:

```bash
git add apps/frontend/package.json apps/frontend/package-lock.json
git status  # confirm nothing else is staged
```

Commit message template:
```
chore(frontend): bump <package> to <version>

Patch release. Notable app-relevant fixes:
- <fix 1>
- <fix 2>

<Optional: note if NOT a security release despite alert framing>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

Do NOT push. Do NOT open a PR. Wait for Coordinator to decide on PR step.

---

## Known Gotchas

| Gotcha | Mitigation |
|--------|-----------|
| `next build` rewrites `tsconfig.json` | Always `git checkout -- apps/frontend/tsconfig.json` post-build |
| Pre-existing lint failures look like regressions | Capture baseline before bump; compare counts, not presence |
| `npm install` may bump transitive packages | Check `npm ls <package>` to confirm only the target changed |
| `middleware` deprecation warning (Next ≥16.2.7) | Expected; `middleware.ts` already has a TODO for proxy migration |

---

## Layering an npm Override for a Transitive CVE the Parent Bump Didn't Clear

### When this pattern applies

A parent package (e.g., `next`) vendors its own copy of a transitive dependency (e.g., `postcss`) inside `node_modules/next/node_modules/postcss/`. Bumping the parent version does NOT upgrade the bundled copy — the CVE persists inside the parent's subtree. Additionally, the top-level copy of the same package may also be below the fix threshold.

Symptoms:
- `npm audit` still shows the CVE after bumping the parent
- `npm ls <package>` shows two entries: one under the parent's subtree (`└─ next → postcss@X.Y.Z`) and one at top-level
- `npm audit fix --force` would suggest downgrading the parent to an ancient version (wrong fix)

### The fix: `overrides` block in package.json

Add at the **top level** of `package.json` (sibling of `dependencies`/`devDependencies`):

```json
"overrides": {
  "postcss": "^8.5.10"
}
```

- If `overrides` already exists, **merge** the new key in — do not overwrite the block.
- Use `"^X.Y.Z"` (caret) to allow patch updates; use `">=X.Y.Z"` for a floor constraint if the exact version doesn't matter.
- `overrides` is the **npm-specific key** (`npm` ≥7). Yarn uses `"resolutions"`, pnpm uses `"pnpm.overrides"`. Do NOT mix them.

### Install and verify

```bash
cd apps/frontend
npm install           # fast — typically changes only 1-3 packages
npm ls <package>      # every entry should show >= fix-threshold, all "deduped"
npm audit             # the CVE should be gone; count should drop
```

Expected `npm ls postcss` output after override (example):
```
frontend@0.1.0
├─┬ @tailwindcss/postcss@4.2.2
│ └── postcss@8.5.15
└─┬ next@16.2.7
  └── postcss@8.5.15 deduped   ← bundled copy now overridden
```

The `deduped` annotation means all consumers are resolving to the same single instance.

### Build validation is mandatory

postcss sits in the CSS build pipeline (Tailwind → postcss → CSS output). A misconfigured override could break CSS processing silently. Always run `npm run build` after the override and confirm:
1. Build exits 0
2. Tailwind CSS classes compile without errors
3. No new warnings about postcss peer deps

### Peer-dep impact

For `postcss` specifically: `@tailwindcss/postcss ^4.x` and `vite ^8.x` both accept higher patch versions of postcss without peer-dep warnings. The override is safe for this repo's dependency surface.

### Commit hygiene

Same as the standard patch bump: stage only `package.json` + `package-lock.json`. The override lives only in `package.json` (adds `"overrides"` block); `package-lock.json` reflects the flattened resolution. The `net_modules/` change is not committed.

Commit message template:
```
chore(frontend): override <package> to ^<version> (GHSA-XXXX-XXXX-XXXX)

<parent>@<version> still bundles <package>@<old-version>, which is vulnerable to
<CVE> (<brief description>).
Severity: <moderate/high/critical> (CVSS <score>). Practical risk: <assessment>.

Forces <package> to ^<version> across all transitive resolutions.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

### Real-world example

2026-06-04 — `next@16.2.7` bundled `postcss@8.4.31` (CVE-2026-41305 / GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS Stringify). Override set to `^8.5.10`. npm installed `postcss@8.5.15`. Vulnerability count: 7 → 5 (2 postcss moderate entries cleared). Build: ✅, Tests: 789/9 (identical baseline). Commit: `2eb1ca0`.

---

## Example Application

This skill was codified from the Next.js 16.2.6 → 16.2.7 bump (2026-06-04, commit `d87a0ac`):
- Two pins changed: `next` and `eslint-config-next`
- `npm install` resolved 5 transitively updated packages
- Build: ✅, Tests: 789 passed / 9 pre-existing failures, Lint: 39 pre-existing errors
- tsconfig.json reverted cleanly
- Commit staged exactly 2 files
