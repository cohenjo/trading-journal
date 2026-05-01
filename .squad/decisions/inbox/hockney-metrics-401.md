# Decision: Optional Auth Pattern for Telemetry Endpoints

**Date:** 2026-05-01  
**Author:** Hockney (Backend Dev)  
**Issue:** #125 — `/api/metrics/page-load` returns 401 on every page  
**PR:** #137

## Problem

The `/api/metrics/page-load` endpoint was returning 401 Unauthorized on every authenticated page load, polluting console logs and losing telemetry data.

**Root cause:**
1. Metrics router mounted with `dependencies=auth_dep` requiring JWT auth
2. Frontend uses `navigator.sendBeacon()` for page-load telemetry
3. **sendBeacon() cannot attach custom HTTP headers** (spec limitation)
4. Result: Every sendBeacon() → 401, even for authenticated users

## Solution

Created **optional auth pattern** for telemetry endpoints:

```python
# app/dependencies.py
async def get_current_user_optional(
    request: Request,
    settings: SupabaseAuthSettings = Depends(_get_settings),
) -> SupabaseClaims | None:
    """Validates auth if present, returns None if absent/invalid."""
    auth_header: str | None = request.headers.get("Authorization")
    if not auth_header:
        return None
    # ... token parsing + validation
    try:
        return await verify_supabase_jwt(token, settings, cache)
    except HTTPException:
        # Degrade to anonymous on invalid/expired token
        return None
```

**Endpoint usage:**
```python
@router.post("/page-load")
def capture_page_load_metrics(
    payload: PageLoadMetrics,
    claims: SupabaseClaims | None = Depends(get_current_user_optional),
):
    attributes = {"path": payload.path}
    if claims is not None:
        attributes["user_id"] = str(claims.sub)  # Capture when available
    page_load_count.add(1, attributes)
    # ...
```

**Router mount:**
```python
# Metrics router handles optional auth internally
app.include_router(telemetry_metrics.router)  # No dependencies=auth_dep
```

## Benefits

1. **sendBeacon() compatibility** — Works without auth headers
2. **Progressive enhancement** — Captures user_id when `apiFetch()` fallback provides token
3. **Reusable pattern** — Canonical for other telemetry endpoints (error reporting, analytics, RUM)
4. **Zero console pollution** — No more 401 noise

## Pattern for Future Telemetry

**When to use optional auth:**
- ✅ Page-load metrics
- ✅ Error reporting / crash telemetry
- ✅ Real User Monitoring (RUM)
- ✅ Analytics events sent via sendBeacon()
- ❌ NOT for business-critical endpoints with PII/RBAC requirements

**Template:**
```python
from app.dependencies import get_current_user_optional

@router.post("/telemetry/something")
async def capture_telemetry(
    payload: TelemetryPayload,
    claims: SupabaseClaims | None = Depends(get_current_user_optional),
):
    attrs = {"event": payload.event}
    if claims:
        attrs["user_id"] = str(claims.sub)
        attrs["user_email"] = claims.email
    # ... record telemetry with optional user context
```

## References

- `apps/backend/app/dependencies.py` — `get_current_user_optional()` implementation
- `apps/backend/app/api/metrics.py` — First consumer of optional auth
- `apps/backend/tests/test_performance.py` — Tests for anonymous + authenticated scenarios
- MDN sendBeacon spec: Cannot set custom headers (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon)
