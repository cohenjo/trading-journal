/**
 * Supabase Database type stub.
 *
 * To generate the real types, link your project and run:
 *   supabase gen types typescript --linked > src/types/database.ts
 *
 * NOTE: Requires Phase 1 migrations (PR #85) to be applied first so that
 * auth.users and all application tables exist in the remote schema.
 *
 * Until then, this `any` placeholder keeps the codebase compilable while
 * the real Database type is not yet generated.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
