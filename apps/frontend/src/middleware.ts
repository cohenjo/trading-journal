import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase auth session on every request and propagates the
 * updated tokens to both the request (for Server Components) and the response
 * (for the browser).
 *
 * This is the "proxy / middleware" pattern from @supabase/ssr — it must run
 * before any Server Component that calls `supabase.auth.getUser()` or
 * `supabase.auth.getClaims()` so that sessions do not expire mid-navigation.
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
  await supabase.auth.getClaims();

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
