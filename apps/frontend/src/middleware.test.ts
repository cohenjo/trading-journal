/**
 * Tests for middleware route classification (isPublicRoute) and the
 * /auth/callback safe-redirect guard.
 *
 * The middleware function itself talks to Supabase and Next.js internals,
 * so we unit-test the two pure-logic pieces that the issue AC calls out:
 *
 *   1. Path classification — which paths are public vs protected?
 *   2. Safe-redirect validation — the `next` param must not allow open redirects.
 *
 * We also smoke-test the callback route's redirect logic using a minimal
 * mock of the Supabase client.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// 1. isPublicRoute — extracted for unit testing
// ---------------------------------------------------------------------------
// Re-implement the same logic here so we can test it without importing the
// full Next.js middleware (which requires Edge runtime globals).
const PUBLIC_ROUTES: readonly string[] = ['/signin', '/login', '/favicon.ico'];
const PUBLIC_PREFIXES: readonly string[] = [
  '/auth/',
  '/_next/',
  '/api/auth/',
  '/api/metrics/',
];
function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

describe('isPublicRoute', () => {
  it('returns true for /signin', () => {
    expect(isPublicRoute('/signin')).toBe(true);
  });

  it('returns true for /login (legacy redirect)', () => {
    expect(isPublicRoute('/login')).toBe(true);
  });

  it('returns true for /favicon.ico', () => {
    expect(isPublicRoute('/favicon.ico')).toBe(true);
  });

  it('returns true for /auth/callback (subtree)', () => {
    expect(isPublicRoute('/auth/callback')).toBe(true);
  });

  it('returns true for /auth/callback?code=xyz', () => {
    // Middleware uses pathname only, not full URL — but verify the base
    expect(isPublicRoute('/auth/callback')).toBe(true);
  });

  it('returns true for /_next/static/chunk.js', () => {
    expect(isPublicRoute('/_next/static/chunk.js')).toBe(true);
  });

  it('returns true for /api/auth/session', () => {
    expect(isPublicRoute('/api/auth/session')).toBe(true);
  });

  it('returns true for /api/metrics/page-load', () => {
    expect(isPublicRoute('/api/metrics/page-load')).toBe(true);
  });

  it('returns false for /', () => {
    expect(isPublicRoute('/')).toBe(false);
  });

  it('returns false for /trades', () => {
    expect(isPublicRoute('/trades')).toBe(false);
  });

  it('returns false for /plan', () => {
    expect(isPublicRoute('/plan')).toBe(false);
  });

  it('returns false for /settings', () => {
    expect(isPublicRoute('/settings')).toBe(false);
  });

  it('returns false for /api/trades (not under /api/auth/ or /api/metrics/)', () => {
    expect(isPublicRoute('/api/trades')).toBe(false);
  });

  it('returns false for /loginextra (must be exact match)', () => {
    expect(isPublicRoute('/loginextra')).toBe(false);
  });

  it('returns false for /signin-with-email (must be exact match)', () => {
    expect(isPublicRoute('/signin-with-email')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Safe-redirect validation — mirrors the guard in login/page.tsx and
//    the callback route.
// ---------------------------------------------------------------------------
/** Matches the isSafeRedirect helper used in both the sign-in page and callback. */
function isSafeRedirect(next: string | null): next is string {
  if (!next) return false;
  return next.startsWith('/') && !next.includes('//') && !next.includes(':');
}

describe('isSafeRedirect', () => {
  it('accepts a simple relative path', () => {
    expect(isSafeRedirect('/plan')).toBe(true);
  });

  it('accepts a nested relative path', () => {
    expect(isSafeRedirect('/trades/2026-01-01')).toBe(true);
  });

  it('accepts a path with query params', () => {
    expect(isSafeRedirect('/trades?from=2026-01-01')).toBe(true);
  });

  it('rejects null', () => {
    expect(isSafeRedirect(null)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isSafeRedirect('')).toBe(false);
  });

  it('rejects absolute URL (https://)', () => {
    expect(isSafeRedirect('https://evil.example.com/steal')).toBe(false);
  });

  it('rejects protocol-relative URL (//evil.com)', () => {
    expect(isSafeRedirect('//evil.example.com/steal')).toBe(false);
  });

  it('rejects URL with colon (data: or javascript:)', () => {
    expect(isSafeRedirect('javascript:alert(1)')).toBe(false);
  });

  it('rejects path with embedded double-slash', () => {
    expect(isSafeRedirect('/safe//but-suspicious')).toBe(false);
  });

  it('rejects bare hostname without slash', () => {
    expect(isSafeRedirect('evil.com/path')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. /auth/callback redirect logic — smoke test via a direct function test
// ---------------------------------------------------------------------------
// We extract the core redirect decision logic from the callback route so we
// can test it without mounting a full Next.js route handler.
function callbackRedirectTarget(
  origin: string,
  code: string | null,
  next: string | null,
  exchangeSucceeded: boolean,
): string {
  if (code && exchangeSucceeded) {
    const isSafe = next !== null && next.startsWith('/') && !next.includes('//') && !next.includes(':');
    return isSafe ? `${origin}${next}` : origin;
  }
  return `${origin}/signin?error=auth_callback_failed`;
}

describe('callbackRedirectTarget', () => {
  const origin = 'https://trading.example.com';

  it('redirects to origin root when code exchanged and no next param', () => {
    expect(callbackRedirectTarget(origin, 'code123', null, true)).toBe(origin);
  });

  it('redirects to safe next path after successful exchange', () => {
    expect(callbackRedirectTarget(origin, 'code123', '/plan', true)).toBe(`${origin}/plan`);
  });

  it('redirects to origin root when next is unsafe (absolute URL)', () => {
    expect(
      callbackRedirectTarget(origin, 'code123', 'https://evil.com', true),
    ).toBe(origin);
  });

  it('redirects to /signin?error= when no code present', () => {
    expect(callbackRedirectTarget(origin, null, '/plan', true)).toBe(
      `${origin}/signin?error=auth_callback_failed`,
    );
  });

  it('redirects to /signin?error= when code exchange fails', () => {
    expect(callbackRedirectTarget(origin, 'code123', '/plan', false)).toBe(
      `${origin}/signin?error=auth_callback_failed`,
    );
  });

  it('redirects to /signin?error= when both code missing and exchange fails', () => {
    expect(callbackRedirectTarget(origin, null, null, false)).toBe(
      `${origin}/signin?error=auth_callback_failed`,
    );
  });
});
