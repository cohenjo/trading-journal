# Supabase Client Usage Guide

This document explains which Supabase client to use and when.
All clients read credentials from environment variables — never from hardcoded values.

## Environment Variables

| Variable | Prefix | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon / publishable key — safe for browsers |
| `SUPABASE_SERVICE_ROLE_KEY` | **No prefix** | Service-role key — server-only, bypasses RLS |

---

## Client Decision Table

| Context | File | Function | Notes |
|---|---|---|---|
| Server Component | `src/lib/supabase/server.ts` | `createClient()` | Async; reads cookies via `next/headers` |
| Server Action | `src/lib/supabase/server.ts` | `createClient()` | Same as above |
| Route Handler | `src/lib/supabase/server.ts` | `createClient()` | Same as above |
| Client Component | `src/lib/supabase/browser.ts` | `supabaseBrowser` (singleton) | Runs in browser; uses cookie storage |
| Privileged server op | `src/lib/supabase/admin.ts` | `createAdminClient()` | Bypasses RLS; **never** in browser code |

---

## Usage Examples

### Server Component
```ts
import { createClient } from '@/lib/supabase/server';

export default async function TradePage() {
  const supabase = await createClient();
  const { data } = await supabase.from('trades').select('*');
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

### Client Component
```tsx
'use client';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function SignOutButton() {
  const handleSignOut = () => supabaseBrowser.auth.signOut();
  return <button onClick={handleSignOut}>Sign out</button>;
}
```

### Server Action / Route Handler (privileged)
```ts
import { createAdminClient } from '@/lib/supabase/admin';

export async function deleteUser(userId: string) {
  'use server';
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
}
```

---

## Middleware

`src/middleware.ts` runs on every non-static request and calls
`supabase.auth.getClaims()` to silently refresh expired tokens.
The updated session is propagated to both the incoming request
(so Server Components see it) and the outgoing response (so the
browser stores the refreshed token).

**Do not remove `getClaims()` from middleware** — without it, users
may be randomly logged out on SSR navigation.

---

## Database Types

The `src/types/database.ts` file exports a `Database` type used to
strongly type all Supabase client calls.

**To generate real types** (once linked to the remote project):
```bash
supabase gen types typescript --linked > src/types/database.ts
```

> ⚠️ Requires Phase 1 migrations (PR #85) to be applied to the remote
> project first — `auth.users` and application tables must exist in
> the schema before type generation will succeed.
