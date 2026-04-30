import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Creates a server-side Supabase client scoped to the current request.
 *
 * Use this in Server Components, Server Actions, and Route Handlers.
 * The client reads/writes auth tokens via the request cookie store.
 *
 * @example
 * ```ts
 * const supabase = await createClient();
 * const { data } = await supabase.from('trades').select('*');
 * ```
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll may be called from a Server Component where cookies are
            // read-only. Safe to ignore — the middleware will keep sessions fresh.
          }
        },
      },
    },
  );
}
