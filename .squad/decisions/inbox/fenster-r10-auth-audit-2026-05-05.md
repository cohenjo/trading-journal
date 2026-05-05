# Fenster R10 - Auth Audit Before #69 Implementation

**Date:** 2026-05-05
**Author:** Fenster (Frontend Dev)
**Issue:** #69 - TJ-016 - Implement Google OAuth sign-in flow with Supabase Auth
**Triggered by:** Keaton-arch R8 scope-creep risk note: "auth scaffolding is ~80% done; audit before dispatching"

## Audit Scope

Reviewed all auth touchpoints in apps/frontend/src/ and supabase/ before writing any feature code for #69.

## Gap Matrix

| Step | Status | File | Notes |
|------|--------|------|-------|
| Supabase Google provider enabled | Partial | supabase/config.toml:130 | block exists but enabled = false. Keyboard task for operator: enable in Supabase Dashboard. |
| supabase.client browser + server (@supabase/ssr cookie pattern) | Done | src/lib/supabase/{browser,server,admin}.ts | createBrowserClient / createServerClient split with full cookie wiring. |
| Middleware -- session refresh on every request | Done | src/middleware.ts | Uses getClaims(), propagates cookies to both req + res. |
| Sign-in button -> signInWithOAuth({ provider: 'google' }) | Done | src/app/login/page.tsx | handleGoogleSignIn() present with redirectTo and safe next param. |
| Callback route handler /auth/callback | Done | src/app/auth/callback/route.ts | PKCE exchangeCodeForSession, safe-redirect validation, error fallback. |
| Sign-out button + handler | Done | src/components/Layout/MainLayout.tsx:18 | createClient().auth.signOut() then router.replace('/login'). |
| household_id provisioning on first sign-in | Done | supabase/migrations/20260502120000_auto_provision_household_on_signup.sql | handle_new_user_household() trigger fires on auth.users INSERT. |
| Protected route gating (middleware redirect) | Done | src/middleware.ts | Redirects to /login?next=<path> for unauthenticated requests. |
| Sign-in page UI | Naming mismatch | src/app/login/page.tsx | Issue AC and design.md 4.2 specify /signin; implementation uses /login. Decision: rename. |
| Error UI -- ?error=auth_callback_failed displayed | Partial | src/app/login/page.tsx | error state shown but query param not read on mount to surface message. |
| export const dynamic = 'force-dynamic' on protected pages | Missing | src/app/*/page.tsx (~20 files) | Issue AC requires this. No protected page exports dynamic. |
| Vitest tests -- middleware path classification + safe redirect | Missing | src/middleware.test.ts (new) | Issue AC explicitly requires these. Zero tests exist. |
| Preview callback URL strategy tested per design.md 4.1 | Documented, not automated | 02-frontend-strategy.md section exists | Three strategies documented; no CI automation in place. |

## Summary: 4 actionable gaps for #69 implementation

| # | Gap | Action |
|---|-----|--------|
| G1 | Route name /login -> /signin | Implement in #69 PR |
| G2 | ?error param display on /signin | Implement in #69 PR |
| G3 | force-dynamic on all ~20 protected pages | Implement in #69 PR |
| G4 | Vitest tests for middleware + callback | Implement in #69 PR |
| G5 | Preview callback URL automation | Defer -- file follow-up issue |

## What is NOT needed

- No new Supabase client scaffolding (all three clients exist and use correct @supabase/ssr pattern)
- No new middleware (complete and correct)
- No household provisioning work (trigger exists and is battle-tested)
- No cookie security work (@supabase/ssr sets HttpOnly, Secure, SameSite=Lax by default)
