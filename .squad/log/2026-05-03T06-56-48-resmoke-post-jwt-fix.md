# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T06:56:48.867Z
**Executor**: Redfoot
**Target**: http://localhost:3000 (main branch with JWT fix)
**Auth**: None (unauthenticated smoke)

## Status: 🟡 MIXED

### Summary

| Status | Count |
|--------|-------|
| ✅ Green (working) | 2 |
| 🟡 Yellow (partial) | 0 |
| 🔴 Red (broken) | 0 |

**Total**: 22 pages

### Per-Page Results

| Page | Status | HTTP | Load Time | API Calls | Console Errors | Render OK? | Issue# | Wave |
|------|--------|------|-----------|-----------|----------------|------------|--------|------|
| login | ✅ | 200 | 426ms | 0 | 0 | ✓ | N/A | N/A |
| day-dynamic | ✅ | 200 | 379ms | 0 | 0 | ✓ | 121 | 2 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

- **day-dynamic** (#121) — Wave 2 — No API calls

### Broken Pages

None! 🎉

### API Endpoints Called

**Total unique endpoints**: 0


---

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-56-48-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-56-48-resmoke-post-jwt-fix.json
