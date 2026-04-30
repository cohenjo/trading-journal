#!/usr/bin/env tsx
/**
 * e2e/scripts/cleanup-stale-users.ts
 *
 * Deletes throwaway E2E users (prefix: e2e_) older than 1 hour.
 * Run with: npm run test:e2e:cleanup
 */
import { getAdminClient } from '../fixtures/admin';

const MAX_AGE_HOURS = 1;

async function cleanupStaleUsers(): Promise<void> {
  const admin = getAdminClient();

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const stale = data.users.filter(
    (u) =>
      u.email?.startsWith('e2e_') &&
      new Date(u.created_at).getTime() < cutoff
  );

  console.log(`Found ${stale.length} stale E2E users to delete.`);

  for (const user of stale) {
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.warn(`  WARN: could not delete ${user.email}: ${delErr.message}`);
    } else {
      console.log(`  Deleted: ${user.email}`);
    }
  }

  console.log('Cleanup complete.');
}

cleanupStaleUsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
