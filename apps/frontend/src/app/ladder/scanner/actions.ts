'use server';

import { createClient } from '@/lib/supabase/server';

export interface BondScannerFilters {
  min_maturity?: string;
  max_maturity?: string;
  min_yield?: number;
  min_rating?: string;
  currency?: string;
}

export interface BondScannerResult {
  id: string;
  issuer: string;
  coupon_rate: number;
  maturity_date: string;
  yield_to_maturity: number;
  rating: string;
  currency: string;
  price: number;
  refreshed_at: string;
}

const RATING_ORDER = [
  'AAA',
  'AA',
  'A',
  'BBB',
  'BB',
  'B',
  'CCC',
  'CC',
  'C',
  'D',
] as const;

function isIsoDate(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

function ratingAtLeast(candidateRating: string, threshold: string): boolean {
  const candidateIndex = RATING_ORDER.indexOf(
    candidateRating as (typeof RATING_ORDER)[number],
  );
  const thresholdIndex = RATING_ORDER.indexOf(
    threshold as (typeof RATING_ORDER)[number],
  );
  return candidateIndex >= 0 && thresholdIndex >= 0 && candidateIndex <= thresholdIndex;
}

function normalizeRow(row: Record<string, unknown>): BondScannerResult | null {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const id = String(row.symbol ?? data.id ?? '');
  const maturityDate = String(data.maturity_date ?? '');
  if (!id || !isIsoDate(maturityDate)) return null;

  return {
    id,
    issuer: String(data.issuer ?? id),
    coupon_rate: Number(data.coupon_rate ?? 0),
    maturity_date: maturityDate,
    yield_to_maturity: Number(data.yield_to_maturity ?? 0),
    rating: String(data.rating ?? 'NR'),
    currency: String(data.currency ?? 'USD'),
    price: Number(data.price ?? 0),
    refreshed_at: String(row.refreshed_at ?? ''),
  };
}

function matchesFilters(result: BondScannerResult, filters: BondScannerFilters): boolean {
  if (isIsoDate(filters.min_maturity) && result.maturity_date < filters.min_maturity) {
    return false;
  }
  if (isIsoDate(filters.max_maturity) && result.maturity_date > filters.max_maturity) {
    return false;
  }
  if (
    typeof filters.min_yield === 'number' &&
    Number.isFinite(filters.min_yield) &&
    result.yield_to_maturity < filters.min_yield
  ) {
    return false;
  }
  if (filters.currency && result.currency !== filters.currency) return false;
  if (filters.min_rating && !ratingAtLeast(result.rating, filters.min_rating)) return false;
  return true;
}

/** Reads cached bond scanner rows from Supabase and applies UI filters server-side. */
export async function listBondScanner(
  filters: BondScannerFilters = {},
): Promise<BondScannerResult[]> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return [];

  const { data, error } = await supabase
    .from('bond_scanner_results')
    .select('symbol, data, refreshed_at')
    .order('refreshed_at', { ascending: false });

  if (error) {
    console.error('[listBondScanner] query error:', error.message);
    return [];
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map(normalizeRow)
    .filter((row): row is BondScannerResult => row !== null)
    .filter((row) => matchesFilters(row, filters));
}
