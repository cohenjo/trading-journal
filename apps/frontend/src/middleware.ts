// TODO(next-17): migrate to proxy convention when Next 17 plans removal — preserve edge runtime
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Routes that do NOT require authentication.
 * Add paths here that should be accessible without a login.
 */
const PUBLIC_ROUTES: readonly string[] = [
  '/signin',
  '/login',       // legacy redirect — kept so the redirect itself is not auth-gated
  '/favicon.ico',
];

/** Prefixes whose entire subtree is public (no auth required). */
const PUBLIC_PREFIXES: readonly string[] = [
  '/auth/',         // auth callback, OAuth redirects
  '/_next/',        // Next.js internals
  '/api/auth/',     // next-auth / Supabase auth API routes
  '/api/metrics/',  // telemetry — fire-and-forget, no session required
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Refreshes the Supabase auth session on every request and propagates the
 * updated tokens to both the request (for Server Components) and the response
 * (for the browser).
 *
 * Also enforces authentication: if the user is not signed in and is requesting
 * a protected route, they are redirected to /login?next=<original-path>.
 */
async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  // Do NOT place any code between createServerClient and getClaims().
  // Doing so can cause users to be randomly logged out.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Refresh the session; result is written back via setAll above.
  const { data } = await supabase.auth.getClaims();

  const { pathname } = request.nextUrl;

  // Auth guard: redirect unauthenticated users to /signin
  if (!data?.claims && !isPublicRoute(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/signin';
    loginUrl.searchParams.set('next', pathname);
    // IMPORTANT: copy updated cookies onto the redirect so the session
    // refresh from getClaims() isn't lost.
    const redirectResponse = NextResponse.redirect(loginUrl);
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
      redirectResponse.cookies.set(name, value, opts);
    });
    return redirectResponse;
  }

  // IMPORTANT: return supabaseResponse as-is so the updated cookies reach
  // the browser. If you must return a different response, copy the cookies:
  //   const myResponse = NextResponse.next({ request })
  //   myResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  //   return myResponse
  return supabaseResponse;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - common image asset extensions
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
