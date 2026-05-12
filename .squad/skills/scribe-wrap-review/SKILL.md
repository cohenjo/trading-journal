# Scribe Wrap PR Review

Fast-track review protocol for Scribe round-wrap PRs (administrative metadata only).

## Trigger

PR title matches `scribe: wrap round *` or branch matches `squad/round*-scribe-wrap`.

## Review Checklist (all must pass for APPROVE)

1. **Scope — administrative only:**
   - Allowed paths: `.squad/decisions.md`, `.squad/agents/*/history.md`, `.squad/log/`, `.squad/orchestration-log/`, `.squad/skills/`, `.copilot/skills/`
   - Forbidden: any source code (`apps/`, `packages/`, `scripts/`), test files (`*.test.*`, `*.spec.*`), config (`package.json`, `pyproject.toml`, `tsconfig.json`)
   - If forbidden paths touched → CHANGES_REQUESTED, assign Keaton or Ralph

2. **Merge safety — union strategy:**
   - `.gitattributes` declares `merge=union` for all `.squad/` append-only files
   - GitHub must report `MERGEABLE` — if not, a rebase is needed (non-blocking note)
   - Append-only conflicts between rounds auto-resolve; no manual rebase required

3. **Decision entries — accuracy:**
   - Each decision claimed in PR body exists in `.squad/decisions.md` diff
   - Author, date, and PR cross-references match reality
   - Deferred items reference the correct issue number

4. **Skill content (if `.copilot/skills/` touched):**
   - SKILL.md has correct trigger paths
   - Instructions align with actual scripts/commands
   - No secrets or hardcoded paths

## Verdict Rules

| Condition | Verdict |
|-----------|---------|
| All 4 checks pass | APPROVE |
| Only rebase needed (MERGEABLE=false) | APPROVE with "subject to rebase" note |
| Source code touched | CHANGES_REQUESTED → assign Keaton |
| Decision entries inaccurate | CHANGES_REQUESTED → assign Scribe |

## Notes

- E2E/CI failures are expected to be unrelated (no source changes) — note but don't block
- Scribe wraps are high-frequency, low-risk; review turnaround target < 5 minutes
- Created 2026-05-12 from PR #427 review pattern
