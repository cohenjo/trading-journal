#!/usr/bin/env tsx
/**
 * Cleanup script: deletes e2e_* Supabase auth users older than 1 hour.
 *
 * Run via: npm run test:e2e:cleanup
 * Or directly: npx tsx e2e/scripts/cleanup-stale-users.ts
 *
 * Reads from .env.local (or environment):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import * as path from 'path';
import * as fs from 'fs';

// Load .env.local manually (avoid importing dotenv as a prod dep)
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

import { getAdminClient } from '../fixtures/admin';

const ONE_HOUR_MS = 60 * 60 * 1000;
const E2E_EMAIL_PREFIX = 'e2e_';

async function main(): Promise<void> {
  console.log('[cleanup] Starting stale e2e user cleanup...');

  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - ONE_HOUR_MS);

  let page = 1;
  let deleted = 0;
  let scanned = 0;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) {
      console.error('[cleanup] listUsers error:', error.message);
      process.exit(1);
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      const email = user.email ?? '';
      if (!email.startsWith(E2E_EMAIL_PREFIX)) continue;

      scanned++;
      const createdAt = new Date(user.created_at);
      if (createdAt > cutoff) continue;

      console.log(`[cleanup] Deleting stale user: ${email} (created ${createdAt.toISOString()})`);
      const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
      if (delErr) {
        console.warn(`[cleanup]   ⚠ Failed: ${delErr.message}`);
      } else {
        deleted++;
      }
    }

    if (users.length < 100) break;
    page++;
  }

  console.log(`[cleanup] Done. Scanned ${scanned} e2e users, deleted ${deleted}.`);
}

main().catch((err) => {
  console.error('[cleanup] Fatal:', err);
  process.exit(1);
});
