# Re-Smoke Test Post-JWT Fix (PR #122)

**Date**: 2026-05-03T06:52:54.818Z
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
| backtest | ✅ | 200 | 800ms | 0 | 0 | ✓ | 111 | 3 |
| ladder | ✅ | 200 | 127ms | 0 | 0 | ✓ | 112 | 3 |
| ladder-scanner | ✅ | 200 | 161ms | 0 | 0 | ✓ | 113 | 3 |
| options | ✅ | 200 | 190ms | 0 | 0 | ✓ | 114 | 3 |
| tax-condor | ✅ | 200 | 267ms | 0 | 0 | ✓ | 115 | 3 |

### Green Pages (Auto-Closeable)

These pages are fully functional and their corresponding issues can be closed:

- **backtest** (#111) — Wave 3 — No API calls
- **ladder** (#112) — Wave 3 — No API calls
- **ladder-scanner** (#113) — Wave 3 — No API calls
- **options** (#114) — Wave 3 — No API calls
- **tax-condor** (#115) — Wave 3 — No API calls

### Broken Pages

None! 🎉

### API Endpoints Called

**Total unique endpoints**: 0


---

**Report saved to**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-54-resmoke-post-jwt-fix.md
**JSON data**: /Users/jocohe/projects/trading-journal/.squad/log/2026-05-03T06-52-54-resmoke-post-jwt-fix.json
