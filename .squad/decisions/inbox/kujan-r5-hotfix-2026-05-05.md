# Kujan R5 — security hotfix — 2026-05-05

## Action
- Rebased #275 onto main
- Resolved conflict with #280's vulnerable copy
- Force-pushed and merged
- Main now has env-var pattern (safe)

## Forensic note
PR #280 (Scribe consolidation) somehow included the workflow file. Root cause unknown — possibly an agent `git stash pop` of dirty state or an over-broad `git add`. Future Scribe runs MUST verify their commit's file list before pushing.
