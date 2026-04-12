# Decision: Add Security Headers Middleware

**Author:** Hockney (Backend Dev)
**Date:** 2025-07-18
**Status:** Accepted
**Issue:** #10

## Context

The trading journal backend had no security headers on HTTP responses. This leaves the application vulnerable to clickjacking, MIME-type sniffing, and other client-side attacks.

## Decision

Added a Starlette `BaseHTTPMiddleware` that injects six security headers on **every** response:

| Header | Value | Purpose |
|--------|-------|---------|
| X-Frame-Options | DENY | Prevent clickjacking |
| X-Content-Type-Options | nosniff | Stop MIME-type sniffing |
| Strict-Transport-Security | max-age=31536000; includeSubDomains | Enforce HTTPS |
| Referrer-Policy | strict-origin-when-cross-origin | Limit referrer leakage |
| Content-Security-Policy | default-src 'self' | Restrict resource origins |
| Permissions-Policy | camera=(), microphone=(), geolocation=() | Disable sensitive browser APIs |

Headers are defined as a constant dict in `security_headers.py` so tests and future middleware can reference the single source of truth.

## Consequences

- All responses (including errors) now carry these headers.
- The CSP `default-src 'self'` is intentionally strict; if the frontend needs to load external resources it should be relaxed per-directive rather than weakening the default.
- HSTS assumes HTTPS in production; harmless over plain HTTP in dev.
