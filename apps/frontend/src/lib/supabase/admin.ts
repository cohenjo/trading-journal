import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates a privileged Supabase client that uses the service-role key.
 *
 * ⚠️  SERVER-ONLY — throws immediately if called in a browser context.
 *     The service-role key bypasses Row Level Security (RLS). Never expose it
 *     to the client bundle. Import this module only from Server Components,
 *     Server Actions, Route Handlers, or backend scripts.
 *
 * The env var intentionally lacks the `NEXT_PUBLIC_` prefix so that
 * Next.js does NOT embed it in the browser bundle.
 *
 * @example
 * ```ts
 * // In a Route Handler or Server Action only:
 * const adminSupabase = createAdminClient();
 * await adminSupabase.auth.admin.deleteUser(userId);
 * ```
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[supabase/admin] createAdminClient() must only be called on the server. ' +
        'The service-role key must never be exposed to the browser.',
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      '[supabase/admin] SUPABASE_SERVICE_ROLE_KEY environment variable is not set.',
    );
  }

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        // Disable automatic token refresh — the admin client uses a long-lived
        // service-role key and does not participate in user session management.
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
