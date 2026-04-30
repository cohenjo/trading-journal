import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Module-level singleton browser client.
 *
 * Use this in Client Components and browser-side hooks.
 * The client stores auth tokens in cookies so they are accessible to SSR.
 *
 * @example
 * ```ts
 * import { supabaseBrowser } from '@/lib/supabase/browser';
 * const { data } = await supabaseBrowser.from('trades').select('*');
 * ```
 */
export const supabaseBrowser: SupabaseClient<Database> = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

/**
 * Factory function alternative — useful when you need a fresh reference or
 * a different option set in tests.
 */
export function createClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
