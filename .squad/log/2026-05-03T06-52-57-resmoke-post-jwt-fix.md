# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T06:52:57.792Z
**Executor**: Redfoot
**Target**: http://localhost:3000 (main branch with JWT fix)
**Auth**: None (unauthenticated smoke)

## Status: 🟡 MIXED

### Summary

| Status | Count |
|--------|-------|
| ✅ Green (working) | 10 |
| 🟡 Yellow (partial) | 0 |
| 🔴 Red (broken) | 0 |

**Total**: 22 pages

### Per-Page Results

| Page | Status | HTTP | Load Time | API Calls | Console Errors | Render OK? | Issue# | Wave |
|------|--------|------|-----------|-----------|----------------|------------|--------|------|
| root | ✅ | 200 | 202ms | 0 | 0 | ✓ | 101 | 1 |
| summary | ✅ | 200 | 823ms | 0 | 0 | ✓ | 102 | 1 |
| cash-flow | ✅ | 200 | 178ms | 0 | 0 | ✓ | 103 | 1 |
| current-finances | ✅ | 200 | 237ms | 0 | 0 | ✓ | 104 | 1 |
| settings | ✅ | 200 | 137ms | 0 | 0 | ✓ | 105 | 1 |
| after-i-leave | ✅ | 200 | 265ms | 0 | 0 | ✓ | 116 | 4 |
| analyze | ✅ | 200 | 419ms | 0 | 0 | ✓ | 117 | 4 |
| plan | ✅ | 200 | 271ms | 0 | 0 | ✓ | 118 | 4 |
| progress | ✅ | 200 | 263ms | 0 | 0 | ✓ | 119 | 4 |
| trading-accounts | ✅ | 200 | 259ms | 0 | 0 | ✓ | 120 | 2 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

- **root** (#101) — Wave 1 — No API calls
- **summary** (#102) — Wave 1 — No API calls
- **cash-flow** (#103) — Wave 1 — No API calls
- **current-finances** (#104) — Wave 1 — No API calls
- **settings** (#105) — Wave 1 — No API calls
- **after-i-leave** (#116) — Wave 4 — No API calls
- **analyze** (#117) — Wave 4 — No API calls
- **plan** (#118) — Wave 4 — No API calls
- **progress** (#119) — Wave 4 — No API calls
- **trading-accounts** (#120) — Wave 2 — No API calls

### Broken Pages

None! 🎉

### API Endpoints Called

**Total unique endpoints**: 0


---

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-57-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-57-resmoke-post-jwt-fix.json
