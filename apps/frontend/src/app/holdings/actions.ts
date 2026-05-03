'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const BOND_HOLDING_SELECT =
  'id, ticker, issuer, currency, face_value, coupon_rate, coupon_frequency, issue_date, maturity_date, created_at, updated_at';
const COUPON_FREQUENCIES = ['ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY'] as const;

export type CouponFrequency = (typeof COUPON_FREQUENCIES)[number];

export interface BondHolding {
  id: string;
  ticker: string | null;
  issuer: string;
  currency: string;
  face_value: number;
  coupon_rate: number;
  coupon_frequency: CouponFrequency;
  issue_date: string;
  maturity_date: string;
  created_at?: string;
  updated_at?: string;
}

export type BondHoldingPayload = {
  id: string;
  ticker?: string | null;
  issuer: string;
  currency: string;
  face_value: number;
  coupon_rate: number;
  coupon_frequency: CouponFrequency;
  issue_date: string;
  maturity_date: string;
};

export type BondHoldingPatch = Partial<Omit<BondHoldingPayload, 'id'>>;

export type BondHoldingActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

async function requireHousehold(): Promise<BondHoldingActionResult<string>> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return { ok: false, error: 'Not authenticated' };

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) return { ok: false, error: 'No active household found for your account' };

  return { ok: true, data: householdId };
}

function nullableTrim(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isCouponFrequency(value: unknown): value is CouponFrequency {
  return typeof value === 'string' && COUPON_FREQUENCIES.includes(value as CouponFrequency);
}

function normalizeHolding(row: Record<string, unknown>): BondHolding {
  return {
    id: String(row.id),
    ticker: nullableTrim(row.ticker as string | null | undefined),
    issuer: String(row.issuer ?? ''),
    currency: String(row.currency ?? ''),
    face_value: normalizeNumber(row.face_value),
    coupon_rate: normalizeNumber(row.coupon_rate),
    coupon_frequency: isCouponFrequency(row.coupon_frequency) ? row.coupon_frequency : 'ANNUAL',
    issue_date: String(row.issue_date ?? ''),
    maturity_date: String(row.maturity_date ?? ''),
    created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

function normalizeNonnegativeNumber(value: unknown, fieldName: string): BondHoldingActionResult<number> {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return { ok: false, error: `${fieldName} must be a non-negative number` };
  }
  return { ok: true, data: numberValue };
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function validateHoldingPayload(
  payload: BondHoldingPayload | BondHoldingPatch,
  options: { partial: boolean },
): BondHoldingActionResult<Record<string, string | number | null>> {
  const row: Record<string, string | number | null> = {};

  if (!options.partial) {
    const id = 'id' in payload && typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, error: 'Bond id is required' };
    row.id = id;
  }

  if ('ticker' in payload) row.ticker = nullableTrim(payload.ticker);

  if (!options.partial || 'issuer' in payload) {
    const issuer = typeof payload.issuer === 'string' ? payload.issuer.trim() : '';
    if (!issuer) return { ok: false, error: 'Issuer is required' };
    row.issuer = issuer;
  }

  if (!options.partial || 'currency' in payload) {
    const currency = typeof payload.currency === 'string' ? payload.currency.trim().toUpperCase() : '';
    if (!currency) return { ok: false, error: 'Currency is required' };
    row.currency = currency;
  }

  if (!options.partial || 'face_value' in payload) {
    const faceValue = normalizeNonnegativeNumber(payload.face_value, 'Face value');
    if (!faceValue.ok) return faceValue;
    row.face_value = faceValue.data;
  }

  if (!options.partial || 'coupon_rate' in payload) {
    const couponRate = normalizeNonnegativeNumber(payload.coupon_rate, 'Coupon rate');
    if (!couponRate.ok) return couponRate;
    row.coupon_rate = couponRate.data;
  }

  if (!options.partial || 'coupon_frequency' in payload) {
    if (!isCouponFrequency(payload.coupon_frequency)) {
      return { ok: false, error: 'Invalid coupon frequency' };
    }
    row.coupon_frequency = payload.coupon_frequency;
  }

  if (!options.partial || 'issue_date' in payload) {
    const issueDate = typeof payload.issue_date === 'string' ? payload.issue_date.trim() : '';
    if (!isValidDateString(issueDate)) return { ok: false, error: 'Issue date is required' };
    row.issue_date = issueDate;
  }

  if (!options.partial || 'maturity_date' in payload) {
    const maturityDate = typeof payload.maturity_date === 'string' ? payload.maturity_date.trim() : '';
    if (!isValidDateString(maturityDate)) return { ok: false, error: 'Maturity date is required' };
    row.maturity_date = maturityDate;
  }

  const issueDate = typeof row.issue_date === 'string' ? row.issue_date : undefined;
  const maturityDate = typeof row.maturity_date === 'string' ? row.maturity_date : undefined;
  if (issueDate && maturityDate && maturityDate <= issueDate) {
    return { ok: false, error: 'Maturity date must be after issue date' };
  }

  return { ok: true, data: row };
}

function revalidateHoldingsPages(): void {
  revalidatePath('/holdings');
  revalidatePath('/ladder');
}

export async function listBondHoldings(): Promise<BondHolding[]> {
  const household = await requireHousehold();
  if (!household.ok) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bond_holdings')
    .select(BOND_HOLDING_SELECT)
    .eq('household_id', household.data)
    .is('deleted_at', null)
    .order('maturity_date', { ascending: true });

  if (error) {
    console.error('[listBondHoldings] query error:', error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => normalizeHolding(row));
}

export async function createBondHolding(
  payload: BondHoldingPayload,
): Promise<BondHoldingActionResult<BondHolding>> {
  const household = await requireHousehold();
  if (!household.ok) return household;

  const validation = validateHoldingPayload(payload, { partial: false });
  if (!validation.ok) return validation;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bond_holdings')
    .insert({ ...validation.data, household_id: household.data })
    .select(BOND_HOLDING_SELECT)
    .single();

  if (error || !data) {
    console.error('[createBondHolding] insert error:', error?.message);
    return { ok: false, error: 'Failed to create bond holding. Please try again.' };
  }

  revalidateHoldingsPages();
  return { ok: true, data: normalizeHolding(data as Record<string, unknown>) };
}

export async function updateBondHolding(
  id: string,
  patch: BondHoldingPatch,
): Promise<BondHoldingActionResult<BondHolding>> {
  const holdingId = typeof id === 'string' ? id.trim() : '';
  if (!holdingId) return { ok: false, error: 'Bond id is required' };

  const household = await requireHousehold();
  if (!household.ok) return household;

  const validation = validateHoldingPayload(patch, { partial: true });
  if (!validation.ok) return validation;
  if (Object.keys(validation.data).length === 0) return { ok: false, error: 'No changes provided' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bond_holdings')
    .update({ ...validation.data, updated_at: new Date().toISOString() })
    .eq('id', holdingId)
    .eq('household_id', household.data)
    .is('deleted_at', null)
    .select(BOND_HOLDING_SELECT)
    .maybeSingle();

  if (error) {
    console.error('[updateBondHolding] update error:', error.message);
    return { ok: false, error: 'Failed to update bond holding. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Bond not found' };

  revalidateHoldingsPages();
  return { ok: true, data: normalizeHolding(data as Record<string, unknown>) };
}

export async function deleteBondHolding(
  id: string,
): Promise<BondHoldingActionResult<{ id: string }>> {
  const holdingId = typeof id === 'string' ? id.trim() : '';
  if (!holdingId) return { ok: false, error: 'Bond id is required' };

  const household = await requireHousehold();
  if (!household.ok) return household;

  const now = new Date().toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bond_holdings')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', holdingId)
    .eq('household_id', household.data)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[deleteBondHolding] delete error:', error.message);
    return { ok: false, error: 'Failed to delete bond holding. Please try again.' };
  }
  if (!data) return { ok: false, error: 'Bond not found' };

  revalidateHoldingsPages();
  return { ok: true, data: { id: holdingId } };
}
