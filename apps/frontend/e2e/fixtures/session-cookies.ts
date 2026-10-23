import { createChunks, stringToBase64URL } from '@supabase/ssr';
import type { Cookie } from '@playwright/test';

/** Serialize a real session using the same key and chunking as Supabase SSR. */
export function sessionCookies(
  supabaseUrl: string,
  appUrl: string,
  session: { expires_at?: number; expires_in: number },
): Cookie[] {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const target = new URL(appUrl);
  const name = `sb-${ref}-auth-token`;
  const value = `base64-${stringToBase64URL(JSON.stringify(session))}`;
  return createChunks(name, value).map((chunk) => ({
    ...chunk,
    domain: target.hostname,
    path: '/',
    httpOnly: false,
    secure: target.protocol === 'https:',
    sameSite: 'Lax',
    expires: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  }));
}
