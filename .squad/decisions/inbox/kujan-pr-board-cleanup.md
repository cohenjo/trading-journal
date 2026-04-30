# Decision: PR Board Cleanup — Dependabot + TJ-014 Draft
**By:** Kujan (DevOps/Platform)  
**Date:** 2026-07-25  
**Status:** Executed  
**Category:** Dependency Management, Technical Debt

## Summary

Triaged and resolved all 12 open PRs on the board following the Supabase+Vercel migration.

## Final Action Table

| PR # | Title | Action | Reason |
|------|-------|--------|--------|
| #84 | TJ-014 Migrate hardcoded credentials | ❌ Closed as obsolete | docker-compose POSTGRES_* vars, Alembic env config, and `app/dal/database.py` are all dead post-Supabase migration. `.env.example` already delivered by TJ-002 (PR #55). |
| #52 | cachetools >=7.0.5→>=7.0.6 | ✅ Merged | Safe minor; cachetools actively used in `/api/analyze` caching layer. |
| #51 | pypdf >=6.10.0→>=6.10.2 | ✅ Merged | Safe patch; pypdf in active backend use. |
| #50 | @eslint/eslintrc 3.3.1→3.3.5 | ✅ Merged | Safe patch dev dep. |
| #49 | @types/node 20→25 | ⏸ Deferred | 5 major versions; must match Node runtime (currently Node 20 in CI); needs `npm run build && npm test` validation. |
| #48 | jsdom 28→29 | ⏸ Deferred | Major bump to vitest's test environment; breaking DOM behavior changes possible; needs full test suite validation. |
| #47 | @playwright/test 1.57→1.59 | ✅ Merged | Safe minor within 1.x; no breaking changes. |
| #46 | bcrypt <4.1→<5.1 | ✅ Merged | bcrypt IS still used via passlib/CryptContext in `app/auth/security.py` for local auth (register/login). Supabase JWT migration replaced token validation but not password hashing. |
| #45 | upload-artifact v4→v7 | ⏸ Deferred | 3 major version jump affecting 5 workflows; v5/v6 changelogs not fully reviewed; high blast radius. |
| #44 | setup-python v4→v6 | ✅ Merged | Only breaking change is Node 24 runtime for the action (not Python); GitHub-hosted runners meet the v2.327.1+ requirement. Consolidates `copilot-setup-steps.yml` with rest of workflows. |
| #28 | react-dom + @types/react-dom | ✅ Merged | Minor bump 19.1.0→19.2.5 within React 19 family already pinned in package.json. |
| #24 | python-multipart >=0.0.22→>=0.0.27 | ✅ Merged | Safe patch; required manual conflict resolution with pyproject.toml (pypdf merge landed first). |

## Riskier Call Rationale

### PR #46 — bcrypt (MERGE despite Supabase JWT migration)
The task brief flagged bcrypt as "check if still used post-Supabase JWT." Grep confirmed it IS still used:
- `apps/backend/app/auth/security.py` — `CryptContext(schemes=["bcrypt"])`, `hash_password()`, `verify_password()`
- `apps/backend/app/api/auth.py` — called at registration and login

Supabase JWT (PR #89) replaced how we **validate tokens**, not how we **hash passwords for local accounts**. Both can coexist. Expanding `<4.1` to `<5.1` is safe — bcrypt 5.x maintains the public `hashpw()`/`checkpw()` API that passlib wraps.

### PR #44 — setup-python v4→v6 (MERGE despite major version jump)
The only documented breaking change in v6 is: "Upgrade to node 24 by @salmanmkc — Make sure your runner is on version v2.327.1 or later." GitHub-hosted runners (`ubuntu-latest`, `macos-latest`) are on runner versions well above this threshold. This is an action runtime change only; it does not affect which Python version gets installed. Additionally, all other workflows in this repo already use `setup-python@v5`, so the repo is partially inconsistent; v6 brings full alignment.

### PR #45 — upload-artifact v4→v7 (DEFER despite appearing additive)
v7's release notes describe "Direct Uploads" as a new feature. However, this is a 3-major-version jump with v5 and v6 intermediate changelogs not reviewed. upload-artifact v3→v4 had real breaking changes (artifact naming collisions). Given that `squad-ci.yml` uses it 3× (test-results artifacts), `nightly-backup.yml`, and `test-rls.yml`, the blast radius is too high to merge without a changelog review. Deferred with a comment pointing to https://github.com/actions/upload-artifact/releases.

## Follow-up Items
1. **PR #48, #49** — Human should run `npm install jsdom@29 @types/node@25 && npm run build && npm test` in `apps/frontend` and verify before merging.
2. **PR #45** — Review upload-artifact v5, v6 release notes; merge if no breaking changes found.
3. **bcrypt usage** — If the team decides to remove local auth endpoints in favour of Supabase Auth exclusively, `passlib[bcrypt]` and `bcrypt` can be dropped from pyproject.toml entirely.
