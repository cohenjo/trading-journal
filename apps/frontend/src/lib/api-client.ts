/**
 * Central API client for all FastAPI backend calls.
 *
 * Every fetch against the backend MUST go through `apiFetch` so that the
 * Supabase JWT is forwarded and backend RLS can enforce per-user isolation.
 *
 * Usage (Client Component or hook):
 *   import { apiFetch } from '@/lib/api-client';
 *   const res = await apiFetch('/api/example');
 *   const data = await res.json();
 */

/** Thrown when the backend returns 401 or 403. */
export class ApiAuthError extends Error {
  constructor(public readonly status: 401 | 403, message?: string) {
    super(message ?? `Backend returned ${status} — session may have expired.`);
    this.name = 'ApiAuthError';
  }
}

async function buildAuthHeaders(): Promise<HeadersInit> {
  // Dynamic import avoids initializing the Supabase browser client at module
  // evaluation time, which would fail during Next.js static generation where
  // NEXT_PUBLIC_SUPABASE_URL is not available.
  const { createClient } = await import('@/lib/supabase/browser');
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

/**
 * Drop-in replacement for `fetch` that attaches the Supabase JWT.
 *
 * - Merges Authorization header before any caller-supplied headers so callers
 *   can still override if needed.
 * - Throws `ApiAuthError` on 401/403 so callers don't silently consume
 *   permission errors.
 * - Returns the raw `Response`; callers still call `.json()`, `.text()`, etc.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authHeaders = await buildAuthHeaders();

  const response = await fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...init?.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new ApiAuthError(response.status as 401 | 403);
  }

  return response;
}
