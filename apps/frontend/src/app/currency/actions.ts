'use server';

import { createClient } from '@/lib/supabase/server';
import { FALLBACK_CURRENCY_RATES } from '@/lib/currency';

let serverCachedRates: Record<string, number> | null = null;
let serverCachedAtMs = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Loads currency exchange rates (against ILS) from public.exchange_rates.
 * Caches in-memory for 24 hours on the server to prevent repeated DB hits.
 */
export async function getExchangeRatesAction(): Promise<Record<string, number>> {
  const now = Date.now();
  if (serverCachedRates && (now - serverCachedAtMs < CACHE_TTL_MS)) {
    return serverCachedRates;
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('exchange_rates' as any)
      .select('currency, rate_to_ils');

    if (error || !data || data.length === 0) {
      if (error) {
        console.warn('[getExchangeRatesAction] DB error, using fallback:', error.message);
      }
      return serverCachedRates || FALLBACK_CURRENCY_RATES;
    }

    const rates: Record<string, number> = { ...FALLBACK_CURRENCY_RATES };
    for (const row of data as Array<{ currency: string; rate_to_ils: number | string }>) {
      const code = String(row.currency).trim().toUpperCase();
      const rate = Number(row.rate_to_ils);
      if (Number.isFinite(rate) && rate > 0) {
        rates[code] = rate;
      }
    }

    serverCachedRates = rates;
    serverCachedAtMs = now;
    return rates;
  } catch (err) {
    console.warn('[getExchangeRatesAction] unexpected error, using fallback:', err);
    return serverCachedRates || FALLBACK_CURRENCY_RATES;
  }
}
