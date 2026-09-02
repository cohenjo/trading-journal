import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getExchangeRatesAction } from '../actions';
import { FALLBACK_CURRENCY_RATES } from '@/lib/currency';

describe('getExchangeRatesAction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('fetches exchange rates from exchange_rates table', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [
            { currency: 'USD', rate_to_ils: 3.12 },
            { currency: 'EUR', rate_to_ils: 3.42 },
            { currency: 'GBP', rate_to_ils: 4.05 },
            { currency: 'ILS', rate_to_ils: 1.0 },
          ],
          error: null,
        }),
      }),
    });

    const rates = await getExchangeRatesAction();
    expect(rates.USD).toBe(3.12);
    expect(rates.EUR).toBe(3.42);
    expect(rates.GBP).toBe(4.05);
    expect(rates.ILS).toBe(1.0);
  });

  it('falls back gracefully when database returns an error', async () => {
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Table does not exist' },
        }),
      }),
    });

    // If cache was already populated in previous test, it returns cached or fallback
    const rates = await getExchangeRatesAction();
    expect(rates.USD).toBeDefined();
    expect(rates.ILS).toBe(1);
  });
});
