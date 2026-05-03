'use server';

import { createClient } from '@/lib/supabase/server';
import type { FinanceItem } from '@/components/CurrentFinances/FinanceTabs';
import { saveFinanceSnapshot as saveFinanceSnapshotForDate } from '@/app/finances/actions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinanceMetrics {
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

/** Shape stored in the `data` jsonb column and returned to the client. */
export interface SnapshotData {
  items: FinanceItem[];
  net_worth: number;
  total_assets: number;
  total_liabilities: number;
  total_savings: number;
  total_investments: number;
}

export type SaveSnapshotResult =
  | { success: true }
  | { success: false; error: string };

export type GetSnapshotResult =
  | { success: true; data: SnapshotData | null }
  | { success: false; error: string };

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Looks up the calling user's primary active household_id.
 * household_id must NEVER come from user input — always from the session.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.household_id as string;
}

// ── Server Actions ────────────────────────────────────────────────────────────

/**
 * Upserts a finance snapshot for today into `finance_snapshots`.
 *
 * Security guarantees:
 * - `household_id` is resolved from the authenticated session; never from caller input.
 * - Supabase RLS (`is_household_writer`) enforces write isolation at the DB layer.
 */
export async function saveFinanceSnapshot(
  items: FinanceItem[],
  metrics: FinanceMetrics,
): Promise<SaveSnapshotResult> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return saveFinanceSnapshotForDate(today, { items, ...metrics });
}

/**
 * Fetches the most-recent finance snapshot for the authenticated user's household.
 * Returns `{ data: null }` when no snapshot exists yet (not an error).
 */
export async function getLatestFinanceSnapshot(): Promise<GetSnapshotResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestFinanceSnapshot] query error:', error.message);
    return { success: false, error: 'Failed to load snapshot. Please refresh.' };
  }

  return { success: true, data: (data?.data as SnapshotData) ?? null };
}
