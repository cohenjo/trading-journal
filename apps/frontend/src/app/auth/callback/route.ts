import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PKCE auth callback handler for @supabase/ssr.
 *
 * Supabase redirects here after OAuth (Google) or magic-link confirmation with
 * a `code` query parameter. We exchange it for a session, then redirect to the
 * original destination (or home).
 *
 * Route: /auth/callback
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Validate `next` to prevent open-redirect abuse
      const isSafe = next.startsWith('/') && !next.includes('//') && !next.includes(':');
      const destination = isSafe ? `${origin}${next}` : origin;
      return NextResponse.redirect(destination);
    }
  }

  // Something went wrong — send them back to login with an error hint
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
