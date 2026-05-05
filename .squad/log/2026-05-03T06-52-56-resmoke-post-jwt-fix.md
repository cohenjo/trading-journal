# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T06:52:56.525Z
**Executor**: Redfoot
**Target**: http://localhost:3000 (main branch with JWT fix)
**Auth**: None (unauthenticated smoke)

## Status: 🟡 MIXED

### Summary

| Status | Count |
|--------|-------|
| ✅ Green (working) | 7 |
| 🟡 Yellow (partial) | 0 |
| 🔴 Red (broken) | 0 |

**Total**: 22 pages

### Per-Page Results

| Page | Status | HTTP | Load Time | API Calls | Console Errors | Render OK? | Issue# | Wave |
|------|--------|------|-----------|-----------|----------------|------------|--------|------|
| dividends | ✅ | 200 | 314ms | 0 | 0 | ✓ | 106 | 2 |
| dividends-estimations | ✅ | 200 | 673ms | 0 | 0 | ✓ | 107 | 2 |
| holdings | ✅ | 200 | 249ms | 0 | 0 | ✓ | 108 | 2 |
| insurance | ✅ | 200 | 249ms | 0 | 0 | ✓ | 109 | 2 |
| pension | ✅ | 200 | 200ms | 0 | 0 | ✓ | 110 | 2 |
| login | ✅ | 200 | 195ms | 0 | 0 | ✓ | N/A | N/A |
| day-dynamic | ✅ | 200 | 156ms | 0 | 0 | ✓ | 121 | 2 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

- **dividends** (#106) — Wave 2 — No API calls
- **dividends-estimations** (#107) — Wave 2 — No API calls
- **holdings** (#108) — Wave 2 — No API calls
- **insurance** (#109) — Wave 2 — No API calls
- **pension** (#110) — Wave 2 — No API calls
- **day-dynamic** (#121) — Wave 2 — No API calls

### Broken Pages

None! 🎉

### API Endpoints Called

**Total unique endpoints**: 0


---

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-56-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-56-resmoke-post-jwt-fix.json
