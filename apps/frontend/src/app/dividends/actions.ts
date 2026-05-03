'use server';

import { createClient } from '@/lib/supabase/server';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportableAccount {
  id: string;
  name: string;
  type: string;
  details?: Record<string, unknown> | null;
}

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
 * Returns all dividend account names for the authenticated user's household.
 * Returns empty array on auth failure (graceful degradation for UI).
 */
export async function getDividendAccounts(): Promise<string[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  // RLS on dividend_accounts (is_household_member) filters by household automatically.
  const { data, error } = await supabase
    .from('dividend_accounts')
    .select('name');

  if (error) {
    console.error('[getDividendAccounts] query error:', error.message);
    return [];
  }

  return (data ?? []).map((a: { name: string }) => a.name);
}

/**
 * Returns investment accounts from the latest finance snapshot that are
 * eligible to be linked (category=Investments, not already linked).
 */
export async function getImportableAccounts(): Promise<ImportableAccount[]> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return [];

  // Collect already-linked IDs (RLS filters to household automatically).
  const { data: existing } = await supabase
    .from('dividend_accounts')
    .select('linked_id')
    .not('linked_id', 'is', null);

  const linkedIds = new Set(
    (existing ?? []).map((a: { linked_id: number | null }) => String(a.linked_id)),
  );

  // Fetch the most-recent finance snapshot.
  const { data: snapRow, error: snapError } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapError || !snapRow?.data) return [];

  const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
  if (!Array.isArray(snapshotData.items)) return [];

  return snapshotData.items
    .filter(
      (item) =>
        item.category === 'Investments' && !linkedIds.has(String(item.id)),
    )
    .map((item) => ({
      id: String(item.id),
      name: String(item.name ?? ''),
      type: String(item.type ?? 'Unknown'),
      details: (item.details as Record<string, unknown>) ?? null,
    }));
}

/**
 * Creates an empty dividend account for the authenticated user's household.
 *
 * Security: household_id resolved from session, never from caller input.
 */
export async function createDividendAccount(
  name: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Guard against duplicates within the household.
  const { data: existingRow } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (existingRow) return { ok: false, error: 'Account already exists' };

  const { error: insertError } = await supabase
    .from('dividend_accounts')
    .insert({ name: trimmedName, household_id: householdId });

  if (insertError) {
    console.error('[createDividendAccount] insert error:', insertError.message);
    return { ok: false, error: 'Failed to create account. Please try again.' };
  }

  return { ok: true, name: trimmedName };
}

/**
 * Imports a finance-snapshot investment as a linked dividend account.
 * If the item has RSU grants with vested shares, auto-creates a position row.
 *
 * Errors (400-equivalent):
 *   - Account name already exists in household
 *   - linked_id already used in household
 */
export async function importDividendAccount(
  linkedId: string,
  name: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const validLinkedId = typeof linkedId === 'string' ? linkedId.trim() : '';
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!validLinkedId) return { ok: false, error: 'Linked ID must not be empty' };
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Guard: duplicate account name.
  const { data: existingName } = await supabase
    .from('dividend_accounts')
    .select('name')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (existingName) return { ok: false, error: 'Account name already exists' };

  // Guard: linked_id already in use — compare as string to handle int/string mismatch.
  const { data: existingRows } = await supabase
    .from('dividend_accounts')
    .select('linked_id')
    .eq('household_id', householdId)
    .not('linked_id', 'is', null);

  const alreadyLinked = (existingRows ?? []).some(
    (r: { linked_id: number | null }) => String(r.linked_id) === validLinkedId,
  );
  if (alreadyLinked) return { ok: false, error: 'This investment account is already linked' };

  // Fetch latest snapshot for RSU auto-position logic.
  const { data: snapRow } = await supabase
    .from('finance_snapshots')
    .select('data')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Insert the account row.
  const { error: insertError } = await supabase
    .from('dividend_accounts')
    .insert({ name: trimmedName, linked_id: validLinkedId, household_id: householdId });

  if (insertError) {
    console.error('[importDividendAccount] insert error:', insertError.message);
    return { ok: false, error: 'Failed to import account. Please try again.' };
  }

  // Auto-populate RSU positions when applicable.
  if (snapRow?.data) {
    const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
    if (Array.isArray(snapshotData.items)) {
      const item = snapshotData.items.find((i) => String(i.id) === validLinkedId);
      if (item?.details) {
        const details = item.details as Record<string, unknown>;
        const stockSymbol = details.stock_symbol as string | undefined;
        const grants = Array.isArray(details.rsu_grants) ? details.rsu_grants : [];

        let totalShares = 0;
        for (const g of grants as Array<Record<string, unknown>>) {
          totalShares += Number(g.vested ?? 0);
        }

        if (stockSymbol && totalShares > 0) {
          const { error: posError } = await supabase
            .from('dividend_positions')
            .insert({
              account: trimmedName,
              ticker: stockSymbol,
              shares: totalShares,
              household_id: householdId,
            });

          if (posError) {
            // Non-fatal: account was created; log for visibility.
            console.error('[importDividendAccount] position insert error:', posError.message);
          }
        }
      }
    }
  }

  return { ok: true, name: trimmedName };
}

/**
 * Deletes a dividend account and all its positions.
 * If the account was linked to a finance snapshot item, zeroes out
 * that item's `details.dividend_yield` in the latest snapshot.
 */
export async function deleteDividendAccount(
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) return { ok: false, error: 'Name must not be empty' };
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return { ok: false, error: 'No active household found for your account' };
  }

  // Fetch the account to get its linked_id before deleting.
  const { data: account, error: fetchError } = await supabase
    .from('dividend_accounts')
    .select('name, linked_id')
    .eq('name', trimmedName)
    .eq('household_id', householdId)
    .maybeSingle();

  if (fetchError || !account) {
    return { ok: false, error: 'Account not found' };
  }

  const linkedId = (account as { linked_id: number | null }).linked_id;

  // Delete associated positions first.
  const { error: posDeleteError } = await supabase
    .from('dividend_positions')
    .delete()
    .eq('account', trimmedName)
    .eq('household_id', householdId);

  if (posDeleteError) {
    console.error('[deleteDividendAccount] positions delete error:', posDeleteError.message);
    return { ok: false, error: 'Failed to delete account positions.' };
  }

  // Delete the account row.
  const { error: deleteError } = await supabase
    .from('dividend_accounts')
    .delete()
    .eq('name', trimmedName)
    .eq('household_id', householdId);

  if (deleteError) {
    console.error('[deleteDividendAccount] delete error:', deleteError.message);
    return { ok: false, error: 'Failed to delete account. Please try again.' };
  }

  // If linked, zero out dividend_yield in the latest snapshot item.
  if (linkedId != null) {
    const { data: snapRow } = await supabase
      .from('finance_snapshots')
      .select('date, data')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapRow?.data) {
      const snapshotData = snapRow.data as { items?: Array<Record<string, unknown>> };
      if (Array.isArray(snapshotData.items)) {
        let mutated = false;
        for (const item of snapshotData.items) {
          if (String(item.id) === String(linkedId)) {
            if (!item.details || typeof item.details !== 'object') {
              item.details = {};
            }
            (item.details as Record<string, unknown>).dividend_yield = 0;
            mutated = true;
            break;
          }
        }

        if (mutated) {
          const { error: snapUpdateError } = await supabase
            .from('finance_snapshots')
            .update({ data: snapshotData })
            .eq('household_id', householdId)
            .eq('date', (snapRow as { date: string }).date);

          if (snapUpdateError) {
            // Non-fatal: account and positions were deleted successfully.
            console.error(
              '[deleteDividendAccount] snapshot update error:',
              snapUpdateError.message,
            );
          }
        }
      }
    }
  }

  return { ok: true };
}
