# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Trading Journal — personal finance, income tracking, and options trading platform
- **Stack:** Next.js/React (frontend), FastAPI/Python (backend), Supabase (auth, DB, RLS), PostgreSQL, Playwright E2E
- **Created:** 2026-02-23

## Session: 2026-05-01 — Wave Page Blitz (5 agents, 4 PRs merged)

**Date:** 2026-05-01  
**Agents:** Fenster (Wave 1/2/3/4), Hockney (Wave 2b), Redfoot (test harness)  
**Strategy:** 5 dedicated worktrees + Sonnet 4.5 + auth-cookie fixture  
**Outcome:** 4 PRs merged (#128, #130, #131, #129), 1 in flight (#133), 13 issues now functional

### Waves Completed
- **Wave 1 (#101-#105)**: 5 frontend pages → E2E tests + auth-cookie fixture ✅ (PR #128)
- **Wave 2 (#106-#109)**: Backend CRUD for insurance/pension with RLS ✅ (PR #129, #131)
- **Wave 2b (#119-#120)**: Mock/file storage → DB migration (holdings, dividends) ✅ (PR #129)
- **Wave 3 (#110-#113)**: Chart pages (company analysis, technicals, options, risk) ✅ (PR #130)
- **Wave 4 (#114-#117)**: Analysis pages (scenarios, portfolio, volatility, portfolio comparison) ✅ (PR #130)

### Key Discoveries
1. **Auth fixture was broken** (PR #95): Used localStorage instead of @supabase/ssr cookies → all "all green" smoke runs were false positives
2. **JWT validator mismatch** (PR #122): Backend used old HS256 local JWT, frontend sent Supabase RS256 JWT
3. **Wave 2 scope was 3-4x larger** than "add auth": Included mock-to-DB migrations (holdings, dividends)
4. **Process risk**: Wave 2 pushed a docs commit directly to main, bypassing branch protection

### Pattern That Worked
- Dedicated worktrees per agent (no merge conflicts)
- Sonnet 4.5 for sustained multi-hour coding sessions
- auth-cookie fixture (Coordinator + manual debug) unlocked all 5 waves
- Inventory phase critical before scoping CRUD work

### Pending
- PR #133 (Wave 2 frontend): In CI
- Issues #106-#107 (dividends/holdings pages): Pending Wave 2 backend (PR #129 merged)
- Telemetry 401 (#125), DATABASE_URL default (#126), auth.ts deprecation (#127)

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

# Project Context

- **Owner:** {user name}
- **Project:** {project description}
- **Stack:** {languages, frameworks, tools}
- **Created:** {timestamp}

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
