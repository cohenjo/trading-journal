'use server';

import { createClient } from '@/lib/supabase/server';
import type { Bond, RungData } from '@/components/Ladder/types';
import { buildIncome, buildOverview, defaultIncomeRange, rungDateRange, rungIdForYear } from './ladder-calculations';

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
type BondRow = Bond & { household_id?: string };
/** Shape of a row returned from the bond_holdings table. */
type BondHoldingRow = {
  id: string;
  ticker: string | null;
  issuer: string | null;
  currency: string | null;
  face_value: number | string;
  coupon_rate: number | string | null;
  coupon_frequency: string | null;
  maturity_date: string;
};
type AddLadderBondPayload = {
  id?: string;
  ticker?: string | null;
  issuer: string;
  currency: string;
  face_value: number;
  coupon_rate: number;
  coupon_frequency: string;
  issue_date?: string;
  maturity_date: string;
};
type UpdateLadderRungPatch = { target_amount?: number };

/** Returns persisted ladder rungs and bonds with current amounts derived from bond face values.
 *  Source of truth is bond_holdings (IBKR live positions); manually added ladder_bonds are merged in.
 */
export async function getLadderOverview(): Promise<ActionResult<{ rungs: RungData[]; bonds: Bond[] }>> {
  const supabase = await createClient();
  const auth = await requireUserAndHousehold(supabase);
  if (!auth.ok) return auth;

  const [rungsResult, manualBondsResult, holdingBonds] = await Promise.all([
    supabase
      .from('ladder_rungs')
      .select('id,year,start_date,end_date,target_amount,current_amount')
      .eq('household_id', auth.householdId)
      .order('year', { ascending: true }),
    supabase
      .from('ladder_bonds')
      .select('id,ticker,issuer,currency,face_value,coupon_rate,coupon_frequency,maturity_date,rung_id')
      .eq('household_id', auth.householdId)
      .order('maturity_date', { ascending: true }),
    fetchHoldingBonds(supabase, auth.householdId),
  ]);

  if (rungsResult.error) {
    console.error('[getLadderOverview] rungs query error:', rungsResult.error.message);
    return { ok: false, error: 'Failed to load ladder rungs' };
  }
  if (manualBondsResult.error) {
    console.error('[getLadderOverview] bonds query error:', manualBondsResult.error.message);
    return { ok: false, error: 'Failed to load ladder bonds' };
  }

  // Merge: bond_holdings (IBKR live positions) + manually-added ladder_bonds, dedup by id
  const holdingIds = new Set(holdingBonds.map((b) => b.id));
  const mergedBonds: Bond[] = [
    ...holdingBonds,
    ...((manualBondsResult.data ?? []) as BondRow[]).filter((b) => !holdingIds.has(b.id)),
  ];

  const currentAmountByRung = computeCurrentAmountByRung(mergedBonds);
  return {
    ok: true,
    data: buildOverview((rungsResult.data ?? []) as RungData[], mergedBonds, currentAmountByRung),
  };
}

/** Calculates future ladder cashflows from bond_holdings plus any manually added ladder bonds. */
export async function getLadderIncome(
  params: { fromDate?: string; toDate?: string } = {},
): Promise<ActionResult<ReturnType<typeof buildIncome>>> {
  const supabase = await createClient();
  const auth = await requireUserAndHousehold(supabase);
  if (!auth.ok) return auth;
  const range = params.fromDate && params.toDate ? { fromDate: params.fromDate, toDate: params.toDate } : defaultIncomeRange();

  const [manualBondsResult, holdingBonds] = await Promise.all([
    supabase
      .from('ladder_bonds')
      .select('id,ticker,issuer,currency,face_value,coupon_rate,coupon_frequency,maturity_date,rung_id')
      .eq('household_id', auth.householdId)
      .order('maturity_date', { ascending: true }),
    fetchHoldingBonds(supabase, auth.householdId),
  ]);

  if (manualBondsResult.error) {
    console.error('[getLadderIncome] bonds query error:', manualBondsResult.error.message);
    return { ok: false, error: 'Failed to load ladder income' };
  }

  const holdingIds = new Set(holdingBonds.map((b) => b.id));
  const mergedBonds: Bond[] = [
    ...holdingBonds,
    ...((manualBondsResult.data ?? []) as Bond[]).filter((b) => !holdingIds.has(b.id)),
  ];

  try {
    return { ok: true, data: buildIncome(mergedBonds, range) };
  } catch (error_) {
    console.error('[getLadderIncome] calculation error:', error_);
    return { ok: false, error: 'Failed to calculate ladder income' };
  }
}

/** Updates one rung target, or fans out aggregate 3Y-/5Y- targets across their atomic years. */
export async function updateLadderRung(
  id: string,
  patch: UpdateLadderRungPatch,
): Promise<ActionResult<{ rung_id: string; target_amount: number }>> {
  const targetAmount = Number(patch.target_amount);
  if (!Number.isFinite(targetAmount) || targetAmount < 0) {
    return { ok: false, error: 'target_amount must be a nonnegative number' };
  }

  const supabase = await createClient();
  const auth = await requireUserAndHousehold(supabase);
  if (!auth.ok) return auth;

  const rungIds = expandRungIds(id);
  const targetPerRung = targetAmount / rungIds.length;
  for (const rungId of rungIds) {
    const year = Number(rungId);
    const { startDate, endDate } = rungDateRange(year);
    const { error } = await supabase.from('ladder_rungs').upsert({
      household_id: auth.householdId,
      id: rungId,
      year,
      start_date: startDate,
      end_date: endDate,
      target_amount: targetPerRung,
    }, { onConflict: 'household_id,id' });
    if (error) {
      console.error('[updateLadderRung] upsert error:', error.message);
      return { ok: false, error: 'Failed to update ladder rung' };
    }
  }

  return { ok: true, data: { rung_id: id, target_amount: targetAmount } };
}

/** Adds a persisted USD bond to the caller's household-scoped ladder. */
export async function addLadderBond(payload: AddLadderBondPayload): Promise<ActionResult<Bond>> {
  const validation = validateBondPayload(payload);
  if (!validation.ok) return validation;

  const supabase = await createClient();
  const auth = await requireUserAndHousehold(supabase);
  if (!auth.ok) return auth;

  const maturityYear = Number(payload.maturity_date.slice(0, 4));
  const rungId = rungIdForYear(maturityYear);
  const { startDate, endDate } = rungDateRange(maturityYear);
  const { error: rungError } = await supabase.from('ladder_rungs').upsert({
    household_id: auth.householdId,
    id: rungId,
    year: maturityYear,
    start_date: startDate,
    end_date: endDate,
    target_amount: 20_000,
  }, { onConflict: 'household_id,id', ignoreDuplicates: true });
  if (rungError) {
    console.error('[addLadderBond] rung upsert error:', rungError.message);
    return { ok: false, error: 'Failed to prepare ladder rung' };
  }

  const bond: Bond = {
    id: payload.id?.trim() || synthesizeBondId(payload.issuer, payload.maturity_date),
    ticker: payload.ticker ?? null,
    issuer: payload.issuer.trim(),
    currency: payload.currency,
    face_value: Number(payload.face_value),
    coupon_rate: Number(payload.coupon_rate),
    coupon_frequency: payload.coupon_frequency,
    maturity_date: payload.maturity_date,
    rung_id: rungId,
  };
  const { data, error: insertError } = await supabase
    .from('ladder_bonds')
    .insert({ ...bond, household_id: auth.householdId })
    .select('id,ticker,issuer,currency,face_value,coupon_rate,coupon_frequency,maturity_date,rung_id')
    .single();
  if (insertError) {
    console.error('[addLadderBond] insert error:', insertError.message);
    return { ok: false, error: 'Failed to add ladder bond' };
  }

  return { ok: true, data: data as Bond };
}

async function requireUserAndHousehold(
  supabase: SupabaseLike,
): Promise<{ ok: true; householdId: string } | { ok: false; error: string }> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { ok: false, error: 'Not authenticated' };
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();
  if (error || !data?.household_id) return { ok: false, error: 'No active household found for your account' };
  return { ok: true, householdId: String(data.household_id) };
}

/**
 * Reads live bond positions from bond_holdings (IBKR Flex snapshot).
 * coupon_rate is stored in percentage units (e.g. 4.25 = 4.25%); divided by 100
 * here so Bond.coupon_rate matches the decimal convention used by ladder-calculations.
 */
async function fetchHoldingBonds(supabase: SupabaseLike, householdId: string): Promise<Bond[]> {
  const { data, error } = await supabase
    .from('bond_holdings')
    .select('id,ticker,issuer,currency,face_value,coupon_rate,coupon_frequency,maturity_date')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('maturity_date', { ascending: true });
  if (error) {
    console.error('[fetchHoldingBonds] query error:', error.message);
    return [];
  }
  return ((data ?? []) as BondHoldingRow[]).map((row) => {
    const maturityYear = new Date(`${row.maturity_date}T00:00:00Z`).getUTCFullYear();
    return {
      id: row.id,
      ticker: row.ticker ?? null,
      // issuer may be NULL for IBKR flex bonds; fall back to ticker which encodes it
      issuer: row.issuer ?? row.ticker ?? row.id,
      currency: row.currency ?? 'USD',
      face_value: Number(row.face_value),
      // bond_holdings stores coupon_rate in PERCENTAGE units (4.25 = 4.25%);
      // divide by 100 to match the decimal convention expected by ladder-calculations
      coupon_rate: Number(row.coupon_rate ?? 0) / 100,
      // coupon_frequency may be NULL for flex bonds; US bonds default to semi-annual
      coupon_frequency: row.coupon_frequency ?? 'SEMI_ANNUAL',
      maturity_date: String(row.maturity_date),
      rung_id: rungIdForYear(maturityYear),
    };
  });
}

/** Computes face-value sum per rung from a merged bond list. */
function computeCurrentAmountByRung(bonds: Bond[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const bond of bonds) {
    totals.set(bond.rung_id, (totals.get(bond.rung_id) ?? 0) + Number(bond.face_value));
  }
  return totals;
}

function validateBondPayload(payload: AddLadderBondPayload): ActionResult<null> {
  if (!payload.issuer?.trim()) return { ok: false, error: 'issuer is required' };
  if (payload.currency !== 'USD') return { ok: false, error: 'Only USD bonds are supported' };
  if (!Number.isFinite(Number(payload.face_value)) || Number(payload.face_value) <= 0) return { ok: false, error: 'face_value must be positive' };
  if (!Number.isFinite(Number(payload.coupon_rate)) || Number(payload.coupon_rate) < 0) return { ok: false, error: 'coupon_rate must be nonnegative' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.maturity_date)) return { ok: false, error: 'maturity_date must be an ISO date' };
  if (payload.issue_date && payload.maturity_date <= payload.issue_date) return { ok: false, error: 'maturity_date must be after issue_date' };
  return { ok: true, data: null };
}

function expandRungIds(id: string): string[] {
  const aggregateMatch = /^(3Y|5Y)-(\d{4})$/.exec(id);
  if (!aggregateMatch) return [id];
  const span = aggregateMatch[1] === '3Y' ? 3 : 5;
  const startYear = Number(aggregateMatch[2]);
  return Array.from({ length: span }, (_, index) => String(startYear + index));
}

function synthesizeBondId(issuer: string, maturityDate: string): string {
  return `bond-${maturityDate.slice(0, 4)}-${issuer.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
