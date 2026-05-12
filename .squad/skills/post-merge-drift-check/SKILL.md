---
name: post-merge-drift-check
description: Detect whether a delayed/stacked PR needs rebase after other PRs merged to main
author: keaton
created: 2026-05-12
triggers:
  - reviewer gate on PRs opened >1 sprint ago
  - PRs with "UNSTABLE" or "BEHIND" merge state
  - stacked branch reviews
---

# Post-Merge Drift Check

## Purpose

When a PR was opened against an older main and multiple sprints have since merged, determine whether a rebase is required before merge. Avoids both unnecessary rebases (churn) and missed conflicts (silent breakage).

## Algorithm

1. **Identify the PR's touched files:**
   ```bash
   gh pr view {N} --repo {owner}/{repo} --json files --jq '.files[].path'
   ```

2. **List PRs merged to main since the branch point:**
   ```bash
   gh pr list --repo {owner}/{repo} --state merged --base main --search "merged:>{branch-date}" --json number,title,files
   ```
   Or enumerate known sprint PRs and check their files.

3. **Compare file sets:** If intersection is empty → no rebase needed (even if main HEAD advanced). If files overlap → check whether the overlap is semantic (logic changes) or cosmetic (formatting, comments).

4. **Check decisions.md for superseding directives:** If a newer decision contradicts the PR's approach, flag as CHANGES_REQUESTED regardless of file overlap.

5. **Verdict matrix:**

| File overlap | Decision conflict | Verdict |
|---|---|---|
| None | None | No rebase needed |
| None | Yes | CHANGES_REQUESTED (approach outdated) |
| Cosmetic only | None | Rebase recommended but not blocking |
| Semantic | None | Rebase required — potential merge conflict or logic divergence |
| Any | Yes | CHANGES_REQUESTED + rebase |

## Usage in review body

Include a "Round N drift check" section with:
- Main HEAD SHA at review time
- List of merged PRs checked
- File overlap result (none / list)
- Decision conflict result (none / specifics)
- Conclusion: "no rebase needed" or "rebase required before merge"

## Example

```
### Round 9 drift check
No rebase needed. Round 9 PRs #433–#438 touched options/, plan/, summary/,
settings/ — zero file overlap with this PR's dividends/, lib/currency.ts,
and components/trading/accounts/ paths. GitHub reports MERGEABLE.
Main HEAD is b1defd0.
```
