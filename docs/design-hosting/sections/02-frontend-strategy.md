# 02 — Frontend Strategy & UX Flows

**Owner:** Fenster — Frontend Dev  
**Scope:** Next.js 15 App Router frontend, Supabase SSR auth, Vercel hosting, hybrid Server Actions + FastAPI backend integration.

## Current frontend touch points

The current frontend is a Next.js 15.3 App Router app under `apps/frontend/src/app` and `apps/frontend/src/components`. There is no existing `middleware.ts`, `/signin`, `/auth/callback`, or Supabase client helper in `src` yet. Most UI data access currently uses browser `fetch('/api/...')`, with `apps/frontend/next.config.ts` rewriting `/api/:path*` to the FastAPI backend via `NEXT_PUBLIC_API_URL`.

That means the Supabase migration should be introduced as a new auth layer first, then endpoint-by-endpoint moved away from unauthenticated FastAPI rewrites toward Server Actions and row-level-security-backed Supabase CRUD.

## Vercel deployment specifics for Next.js 15

### Adapter and build target

No custom adapter is needed. Vercel runs Next.js 15 natively, including App Router, React Server Components, Server Actions, Route Handlers, middleware, ISR, image optimization, and preview deployments.

Recommended Vercel project root:

```text
apps/frontend
```

Recommended build settings:

```text
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm ci
Output Directory: .next
Node.js: Vercel default supported LTS for Next.js 15
```

The existing `next.config.ts` ignores TypeScript and ESLint during `next build` because those failures are tracked separately. Keep CI checks separate from Vercel deployment, but do not rely on production builds as the only quality gate.

### Environment variable layout

Use a minimal public/private split:

| Variable | Exposure | Used by | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Browser client, server client, middleware | Public project URL. Safe to expose. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Browser client, server client, middleware | Safe to expose when RLS policies are correct. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only | Server Actions, Route Handlers, worker-only admin operations | Never import into client components. Never prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_APP_URL` | Browser + server | OAuth redirect construction | Production canonical app URL. |
| `NEXT_PUBLIC_API_URL` | Browser + server during transition | Legacy FastAPI calls | Phase down as CRUD moves to Server Actions/Supabase. |
| `FASTAPI_INTERNAL_URL` | Server-only | Server Actions / Route Handlers that proxy heavy compute | Prefer for Vercel-to-FastAPI calls when FastAPI is reachable. |

`SUPABASE_SERVICE_ROLE_KEY` should only appear in server-only modules. Use it for rare privileged operations such as invite administration, account deletion workflows, or server-side data repair. Normal user CRUD should use the request user's Supabase session so RLS remains the enforcement boundary.

### Preview deployments

Vercel preview deployments are valuable for auth UX review, but Google OAuth redirect URIs do not support arbitrary wildcard preview URLs reliably. Use one of these patterns:

1. **Recommended: stable redirect proxy.** Register one stable callback URL with Google/Supabase, such as `https://auth.trading-journal.example.com/auth/callback`. The proxy stores the original preview URL in signed `state` or a short-lived cookie, completes OAuth at the stable domain, then redirects back to the preview deployment.
2. **Fallback: per-PR allowlisting.** A CI/Vercel automation adds the exact preview URL to Supabase and Google OAuth redirect allowlists for the PR, then removes it after merge/close.
3. **Local-only workaround.** For developer machines, keep `http://localhost:3000/auth/callback` explicitly allowlisted.

Do not rely on `*.vercel.app` as the sole plan; provider wildcard behavior is inconsistent and too easy to misconfigure.

### Edge vs Node runtime per route

Default to Node runtime unless there is a measured reason to move a route to Edge.

| Route or operation | Runtime | Why |
| --- | --- | --- |
| `middleware.ts` session refresh | Edge middleware | Required for request-time cookie refresh and route protection. Keep it lightweight. |
| Server Components reading user/session data | Node default | Works with cookies, Supabase SSR, and database access. |
| Server Actions mutating rows | Node default | Needs secure env vars and stable server execution. |
| Route Handlers proxying FastAPI or external APIs | Node default | Avoid Edge limitations for long-running fetches, SDKs, and secrets. |
| Static marketing/help pages | Static/ISR | No auth, cache safely. |
| Authenticated dashboard pages | Dynamic Node | Must respect per-user cookies/session and RLS. |

Use explicit route config only when needed:

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

Avoid importing `SUPABASE_SERVICE_ROLE_KEY` into Edge code. Middleware should use the anon key and session cookies only.

### Image optimization

Use Next.js `next/image` for app-owned static images and remote provider images. Configure `remotePatterns` only for trusted domains; do not allow arbitrary user-provided image hosts. For uploaded household documents, prefer signed Supabase Storage URLs with short expiry and validated MIME types.

### ISR and auth interplay

Auth-protected pages must not use public ISR because the rendered result can vary by session and household. Recommended rules:

- Public, non-user-specific pages can use static rendering or ISR.
- Authenticated dashboards, finance pages, settings, household pages, and invite flows should be dynamic.
- Server Components that call `cookies()` or user-scoped Supabase queries will naturally opt into dynamic rendering.
- If a page mixes public shell and private data, cache the shell but fetch private data in dynamic child components or Server Actions.
- For lists that are expensive but user-scoped, use Supabase queries with RLS plus application-level pagination instead of public ISR.

## Supabase SSR auth wiring

Use the canonical `@supabase/ssr` split:

- `createBrowserClient` for Client Components and realtime subscriptions.
- `createServerClient` for Server Components, Server Actions, Route Handlers, and middleware.
- Middleware refreshes the session on each request and writes refreshed cookies back to the response.

Recommended file layout:

```text
apps/frontend/src/middleware.ts
apps/frontend/src/lib/supabase/browser.ts
apps/frontend/src/lib/supabase/server.ts
apps/frontend/src/lib/supabase/action.ts
apps/frontend/src/lib/supabase/route.ts
```

### `middleware.ts` skeleton

```ts
// apps/frontend/src/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const protectedPrefixes = [
  '/',
  '/after-i-leave',
  '/analyze',
  '/backtest',
  '/cash-flow',
  '/current-finances',
  '/dividends',
  '/holdings',
  '/insurance',
  '/ladder',
  '/options',
  '/pension',
  '/plan',
  '/progress',
  '/settings',
  '/tax-condor',
  '/trading',
];

const publicPrefixes = [
  '/signin',
  '/auth/callback',
  '/accept-invite',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return publicPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname) && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/signin';
    redirectUrl.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === '/signin') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

### Server Component helper

```ts
// apps/frontend/src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always set cookies. Middleware refreshes them.
          }
        },
      },
    },
  );
}
```

### Server Action helper

```ts
// apps/frontend/src/lib/supabase/action.ts
'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseActionClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
}
```

### Route Handler helper

```ts
// apps/frontend/src/lib/supabase/route.ts
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export function createSupabaseRouteClient(
  request: NextRequest,
  response: NextResponse = NextResponse.next(),
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );
}
```

### Browser helper

```ts
// apps/frontend/src/lib/supabase/browser.ts
import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

### OAuth callback skeleton

```ts
// apps/frontend/src/app/auth/callback/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase/route';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';
  const response = NextResponse.redirect(new URL(next, request.url));

  if (!code) {
    return NextResponse.redirect(
      new URL('/signin?error=missing_oauth_code', request.url),
    );
  }

  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL('/signin?error=oauth_exchange_failed', request.url),
    );
  }

  return response;
}
```

## Auth UX flows

### First-time sign-in via Google

1. User lands on a protected route and middleware redirects to `/signin?next=/dashboard`.
2. User selects **Continue with Google**; the client calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
3. Google shows account selection and consent, then redirects to `/auth/callback`.
4. The callback route exchanges `code` for a Supabase session and middleware refreshes cookies on the next request.
5. User lands on `/dashboard`; if no profile/household exists, show onboarding to create or join a household before showing financial data.

### Email/password fallback

Email/password should be optional and disabled by default unless Jony wants a non-Google recovery path.

1. User opens `/signin` and selects **Use email instead**.
2. User enters email/password or chooses **Create password account**.
3. Supabase validates credentials or sends confirmation, depending on project settings.
4. On success, redirect to the original `next` route or `/dashboard`.
5. On failure, show an inline error such as “Email or password is incorrect” without revealing whether the email exists.

### Sign-out

1. User opens the account menu in the app shell.
2. User chooses **Sign out** and confirms if there is unsaved form state.
3. A Server Action or client action calls `supabase.auth.signOut()` and clears UI caches.
4. App redirects to `/signin?signed_out=1`.
5. Middleware prevents browser back navigation from showing authenticated pages by redirecting protected routes back to `/signin`.

### Invite spouse

1. Owner opens **Settings → Household → Invite spouse**.
2. Owner enters spouse email and chooses permissions, defaulting to shared household access rather than owner/admin.
3. A Server Action creates an `household_invites` row and triggers Supabase email/magic-link delivery.
4. Spouse receives the link and opens `/accept-invite?token=...`.
5. After acceptance, both users see the same household-scoped data through RLS policies keyed by `household_id`.

### Accept invite when not yet signed up

1. Spouse clicks invite link and lands on `/accept-invite?token=...`.
2. The page validates the token server-side and stores the invite intent in a secure short-lived cookie or signed state value.
3. If no session exists, spouse is sent to `/signin?invite=...` to sign in with Google or create an account.
4. After callback, a Server Action consumes the invite token, creates membership, and marks the invite accepted.
5. Spouse lands on `/dashboard?household=...` with a success message: “You joined Jony’s household.”

### Switch household context

1. User opens the household switcher in the top nav or Settings.
2. UI lists households where the user has active membership, including role labels.
3. User selects a household; a Server Action validates membership and writes selected `household_id` to a server-side profile preference or secure cookie.
4. App calls `router.refresh()` so Server Components re-query under the new context.
5. Dashboard and navigation update, with a visible household label to avoid editing the wrong household.

### Account deletion / leave household

1. User opens **Settings → Account → Delete account** or **Settings → Household → Leave household**.
2. UI explains consequences, including whether shared household data remains for other members.
3. User confirms with a destructive confirmation pattern and re-authentication if required.
4. Server Action removes membership or schedules account deletion; owner deletion either transfers ownership or blocks until another owner is assigned.
5. App signs out deleted users or refreshes household context for users who only left one household.

## Server Actions vs API Routes vs FastAPI calls

Use this default decision rule:

| Operation | Preferred pattern | Examples |
| --- | --- | --- |
| Read user-scoped lists or details | Server Component + Supabase SSR client | Current finances list, plans, insurance policies, household settings. |
| Mutate a row from a form | Server Action + Supabase SSR client | Add trade, update insurance policy, invite spouse, switch household. |
| Client-only realtime update | Browser Supabase client subscription + Server Action for writes | Dashboard updates, job status progress, household member list. |
| Webhook or OAuth callback | Route Handler | `/auth/callback`, Supabase webhook endpoints, external provider callbacks. |
| Heavy compute or long-running analysis | FastAPI job or direct FastAPI call | Backtests, plan simulations, ticker analysis, pension report parsing. |
| External API call requiring secrets | Server Action or Route Handler | Broker sync, market data API, email invite customizations. |
| Legacy endpoints during migration | Existing `/api` rewrite | Keep temporarily, but add Supabase JWT and phase out for CRUD. |

Avoid adding new unauthenticated Next API Routes as thin CRUD wrappers. If the operation is normal CRUD, use Server Actions and Supabase RLS. If it is compute-heavy, use FastAPI with explicit auth.

## Where FastAPI is still called

FastAPI remains the compute and integration backend. Frontend CRUD should move to Supabase, but these operations still belong in FastAPI or a FastAPI-adjacent worker:

- Backtest runs (`/api/backtest/run`) over historical datasets.
- Plan simulations (`/api/plans/simulate`) if projections remain CPU-heavy or need Python finance libraries.
- Tax condor recommendations (`/api/tax-condor/recommend`).
- Market data sync (`/api/ndx/sync/{date}`) and external broker/API imports.
- Pension report upload/parsing (`/api/pension/upload`) due to file parsing and validation.
- Company analysis endpoints (`/api/analyze/*`) that depend on yfinance, AI synthesis, or long-running data collection.
- Trading account sync (`/api/trading/sync`, `/api/trading/sync-to-dividends`).
- Bond scanner operations (`/api/bonds/scanner`) when they query or compute across large external datasets.

### Pattern A — direct FastAPI fetch with Supabase JWT

Use when FastAPI is reachable from Vercel and the response is short enough for a request/response interaction.

```ts
const supabase = createSupabaseBrowserClient();
const {
  data: { session },
} = await supabase.auth.getSession();

const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/backtest/run`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  },
  body: JSON.stringify(payload),
});
```

FastAPI must validate the Supabase JWT against the project JWKS, derive `user_id`, and enforce `household_id` membership before doing work.

### Pattern B — jobs table queue

Use when FastAPI should not be publicly reachable from Vercel, or when work may exceed Vercel request limits.

1. Server Action inserts a row into `jobs` with `type`, `household_id`, `created_by`, `input`, and `status = 'queued'`.
2. FastAPI worker polls or subscribes to queued jobs using a service role in its private environment.
3. Worker validates the job, runs compute, writes progress/results to `jobs` or `job_results`.
4. Frontend listens to Supabase realtime on the job row or polls a Server Component refresh.
5. User sees progress, completion, and clear retry/error actions.

This queue pattern is preferred for backtests, large imports, pension parsing, broker sync, and AI/company-analysis generation.

## State management

Recommended default:

- **Server Components + Server Actions** for initial data and mutations.
- **Supabase realtime subscriptions** for collaborative or job-status data that can change outside the current tab.
- **Small local React state** for forms, filters, chart period selectors, and transient UI.
- **SWR/React Query only where Supabase is not the source of truth**, such as FastAPI compute results or external market-data endpoints.

For this app, Supabase becomes the primary server-state store for CRUD and household data. Adding React Query globally would duplicate cache invalidation with Server Components and Supabase realtime. Use it selectively for `/api/analyze/*`, scanner, backtest, and other FastAPI endpoints where retries, stale time, and request deduplication are useful.

## Preview deployments and auth

The preview auth plan needs to be explicit before enabling Google OAuth in production:

1. Register production and localhost callbacks in Supabase and Google.
2. For previews, prefer a stable redirect proxy domain that is always allowlisted.
3. Encode the target preview URL in signed OAuth `state`; reject unsigned or non-Vercel/project URLs.
4. After callback, redirect only to validated internal URLs to prevent open redirects.
5. If the proxy is not available, use per-PR allowlisting automation and document that manual preview auth may fail until allowlisting completes.

Also ensure Supabase Auth URL configuration includes the production site URL, and redirect allowlists include only the expected domains.

## Accessibility and error states

Auth and household flows must be keyboard accessible, screen-reader friendly, and explicit about recoverable failures.

Minimum UX requirements:

- `/signin` has one `h1`, visible focus states, and buttons with accessible names such as “Continue with Google”.
- Form errors use `aria-live="polite"` and are associated with inputs via `aria-describedby`.
- Loading states use disabled buttons plus visible text such as “Signing in…” rather than spinner-only feedback.
- Invite screens distinguish **expired invite**, **already accepted invite**, **wrong account**, **wrong household**, and **locked account**.
- Destructive account/household actions use confirmation copy that explains data ownership and recovery.
- OAuth callback failures redirect to `/signin` with a safe error code mapped to human-friendly copy.
- Household switcher keeps the selected household visible in the app chrome to prevent accidental edits.

Recommended error copy examples:

| Case | Message |
| --- | --- |
| Expired invite | “This invite has expired. Ask the household owner to send a new invite.” |
| Wrong account | “This invite was sent to another email address. Sign in with that email or ask for a new invite.” |
| Wrong household | “You do not have access to this household. Switch households or request access.” |
| Locked account | “This account is locked. Contact support or the household owner before continuing.” |
| OAuth failure | “Google sign-in did not complete. Try again or use another sign-in method.” |

## Migration checklist

1. Add Supabase SSR helpers and middleware.
2. Add `/signin`, `/auth/callback`, `/accept-invite`, and household settings UI.
3. Add RLS-backed household/profile/invite tables before exposing shared data.
4. Move simple CRUD pages from `fetch('/api/...')` to Server Components + Server Actions.
5. Add Supabase JWT verification to FastAPI for remaining compute endpoints.
6. Convert long-running compute to the jobs-table queue pattern.
7. Remove or narrow the broad `/api/:path*` rewrite once CRUD migration is complete.
