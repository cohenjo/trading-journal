# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T07:14:50.209Z
**Executor**: Redfoot
**Target**: http://localhost:3000 (main branch with JWT fix)
**Auth**: None (unauthenticated smoke)

## Status: 🟡 MIXED

### Summary

| Status | Count |
|--------|-------|
| ✅ Green (working) | 5 |
| 🟡 Yellow (partial) | 0 |
| 🔴 Red (broken) | 0 |

**Total**: 22 pages

### Per-Page Results

| Page | Status | HTTP | Load Time | API Calls | Console Errors | Render OK? | Issue# | Wave |
|------|--------|------|-----------|-----------|----------------|------------|--------|------|
| root | ✅ | 200 | 389ms | 0 | 0 | ✓ | 101 | 1 |
| summary | ✅ | 200 | 588ms | 0 | 0 | ✓ | 102 | 1 |
| cash-flow | ✅ | 200 | 484ms | 0 | 0 | ✓ | 103 | 1 |
| current-finances | ✅ | 200 | 474ms | 0 | 0 | ✓ | 104 | 1 |
| settings | ✅ | 200 | 528ms | 0 | 0 | ✓ | 105 | 1 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

- **root** (#101) — Wave 1 — No API calls
- **summary** (#102) — Wave 1 — No API calls
- **cash-flow** (#103) — Wave 1 — No API calls
- **current-finances** (#104) — Wave 1 — No API calls
- **settings** (#105) — Wave 1 — No API calls

### Broken Pages

None! 🎉

### API Endpoints Called

**Total unique endpoints**: 0


---

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T07-14-50-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T07-14-50-resmoke-post-jwt-fix.json
