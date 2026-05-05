# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T07:14:49.827Z
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
| after-i-leave | ✅ | 200 | 332ms | 0 | 0 | ✓ | 116 | 4 |
| analyze | ✅ | 200 | 541ms | 0 | 0 | ✓ | 117 | 4 |
| plan | ✅ | 200 | 711ms | 0 | 0 | ✓ | 118 | 4 |
| progress | ✅ | 200 | 514ms | 0 | 0 | ✓ | 119 | 4 |
| trading-accounts | ✅ | 200 | 405ms | 0 | 0 | ✓ | 120 | 2 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

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

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T07-14-49-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T07-14-49-resmoke-post-jwt-fix.json
