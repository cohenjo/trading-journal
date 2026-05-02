#!/usr/bin/env tsx
/**
 * e2e/scripts/seed-test-user.ts
 *
 * One-shot provisioning script for E2E test users.
 *
 * Usage:
 *   npx tsx e2e/scripts/seed-test-user.ts
 *   # or via package.json script:
 *   npm run test:e2e:seed
 *
 * What it does:
 *   1. Creates (or verifies) the long-lived shared test user
 *      (E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD from env or defaults).
 *   2. Polls until the household trigger fires and prints userId + householdId.
 *   3. Exits 0 on success, 1 on failure.
 *
 * Required env vars (read from .env.local or CI secrets):
 *   NEXT_PUBLIC_SUPABASE_URL        — Supabase project URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   — anon key (for password grant)
 *   SUPABASE_SERVICE_ROLE_KEY       — service-role key (admin ops)
 *
 * Optional env vars:
 *   E2E_TEST_USER_EMAIL             — defaults to "e2e+playwright@trading-journal.test"
 *   E2E_TEST_USER_PASSWORD          — defaults to "E2eTestPass!1"
 *   SUPABASE_E2E_ALLOW_PROD         — set to "true" to bypass the prod-URL guard
 *   E2E_HOUSEHOLD_POLL_TIMEOUT_MS   — override poll timeout (default 10000)
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── Load .env.local ──────────────────────────────────────────────────────────
// Done before any other imports so environment is ready when fixtures initialise.
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
    const rawValue = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Dynamic imports AFTER loadEnvLocal() so admin.ts captures env vars correctly.
  // Static `import` is hoisted in tsx/CJS and would run before loadEnvLocal().
  const { getAdminClient } = await import('../fixtures/admin');
  const { provisionTestUser, DEFAULT_E2E_PASSWORD } = await import('../helpers/provision-test-user');

  const SHARED_EMAIL = process.env.E2E_TEST_USER_EMAIL ?? 'e2e+playwright@trading-journal.test';
  const SHARED_PASSWORD = process.env.E2E_TEST_USER_PASSWORD ?? DEFAULT_E2E_PASSWORD;
  console.log('═══════════════════════════════════════════════');
  console.log('  E2E Test-User Provisioning Script');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Target URL : ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)'}`);
  console.log(`  User email : ${SHARED_EMAIL}`);
  console.log('───────────────────────────────────────────────');

  // Verify required vars up front
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('✗ NEXT_PUBLIC_SUPABASE_URL is not set.');
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('✗ SUPABASE_SERVICE_ROLE_KEY is not set.');
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('✗ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
    process.exit(1);
  }

  const admin = getAdminClient();

  // ── Step 1: idempotent user create ──────────────────────────────────────────
  console.log('\n[1/3] Checking for existing shared test user...');

  const { data: listData, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    console.error(`✗ listUsers failed: ${listError.message}`);
    process.exit(1);
  }

  const existing = listData.users.find((u) => u.email === SHARED_EMAIL);
  let userId: string;

  if (existing) {
    console.log(`  ✓ Found existing user: ${existing.id}`);
    userId = existing.id;
  } else {
    console.log(`  → Creating user "${SHARED_EMAIL}"...`);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: SHARED_EMAIL,
      password: SHARED_PASSWORD,
      email_confirm: true,
    });

    if (createError || !created.user) {
      console.error(`✗ createUser failed: ${createError?.message}`);
      process.exit(1);
    }

    userId = created.user.id;
    console.log(`  ✓ Created user: ${userId}`);
  }

  // Set env so provisionTestUser picks up the shared user
  process.env.E2E_TEST_USER_EMAIL = SHARED_EMAIL;
  process.env.E2E_TEST_USER_PASSWORD = SHARED_PASSWORD;

  // ── Step 2: poll for household ───────────────────────────────────────────────
  console.log('\n[2/3] Polling for household (auto-provision trigger)...');

  let testUser;
  try {
    testUser = await provisionTestUser({ sharedMode: true });
  } catch (err) {
    console.error(`✗ Provisioning failed: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`  ✓ household_id : ${testUser.householdId}`);
  console.log(`  ✓ access_token : ${testUser.accessToken.slice(0, 24)}…`);

  // ── Step 3: print results ────────────────────────────────────────────────────
  console.log('\n[3/3] Provisioning complete.');
  console.log('───────────────────────────────────────────────');
  console.log(`  userId      : ${testUser.userId}`);
  console.log(`  email       : ${testUser.email}`);
  console.log(`  householdId : ${testUser.householdId}`);
  console.log('───────────────────────────────────────────────');
  console.log('');
  console.log('Set these in CI secrets / .env.local for shared-user mode:');
  console.log(`  E2E_TEST_USER_EMAIL=${testUser.email}`);
  console.log(`  E2E_TEST_USER_PASSWORD=${SHARED_PASSWORD}`);
  console.log('═══════════════════════════════════════════════');

  process.exit(0);
}

// ─── Teardown helper (--teardown flag) ───────────────────────────────────────
async function runTeardown(): Promise<void> {
  const { getAdminClient } = await import('../fixtures/admin');
  const { teardownTestUser, DEFAULT_E2E_PASSWORD } = await import('../helpers/provision-test-user');

  const SHARED_EMAIL = process.env.E2E_TEST_USER_EMAIL ?? 'e2e+playwright@trading-journal.test';
  void DEFAULT_E2E_PASSWORD; // imported for side-effect of env loading consistency

  console.log('═══════════════════════════════════════════════');
  console.log('  E2E Test-User TEARDOWN');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Deleting shared user: ${SHARED_EMAIL}`);

  const admin = getAdminClient();
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listError) {
    console.error(`✗ listUsers failed: ${listError.message}`);
    process.exit(1);
  }

  const existing = listData.users.find((u) => u.email === SHARED_EMAIL);
  if (!existing) {
    console.log('  User not found — nothing to delete.');
    process.exit(0);
  }

  await teardownTestUser(existing.id);
  console.log(`  ✓ Deleted user ${existing.id} and cascaded household data.`);
  process.exit(0);
}

// ─── Entry point ─────────────────────────────────────────────────────────────
if (process.argv.includes('--teardown')) {
  runTeardown().catch((err) => {
    console.error('[seed-test-user] Fatal:', err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error('[seed-test-user] Fatal:', err);
    process.exit(1);
  });
}
