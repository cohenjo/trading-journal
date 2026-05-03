import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { listBondScanner } from './actions';

function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('listBondScanner', () => {
  it('returns empty results when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    await expect(listBondScanner()).resolves.toEqual([]);
  });

  it('reads bond_scanner_results and filters server-side', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const resultChain = chain({
      data: [
        {
          symbol: 'AAA1',
          data: {
            issuer: 'AAA Bond',
            coupon_rate: '0.04',
            maturity_date: '2037-06-30',
            yield_to_maturity: '0.051',
            rating: 'AA',
            currency: 'USD',
            price: '99.75',
          },
          refreshed_at: '2026-05-03T01:00:00Z',
        },
        {
          symbol: 'BBB1',
          data: {
            issuer: 'BBB Bond',
            coupon_rate: '0.03',
            maturity_date: '2036-06-30',
            yield_to_maturity: '0.02',
            rating: 'BBB',
            currency: 'EUR',
            price: '101',
          },
          refreshed_at: '2026-05-02T01:00:00Z',
        },
      ],
      error: null,
    });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(() => resultChain),
    });

    const rows = await listBondScanner({ currency: 'USD', min_rating: 'AA', min_yield: 0.05 });

    expect(rows).toEqual([
      {
        id: 'AAA1',
        issuer: 'AAA Bond',
        coupon_rate: 0.04,
        maturity_date: '2037-06-30',
        yield_to_maturity: 0.051,
        rating: 'AA',
        currency: 'USD',
        price: 99.75,
        refreshed_at: '2026-05-03T01:00:00Z',
      },
    ]);
    expect(resultChain.order).toHaveBeenCalledWith('refreshed_at', { ascending: false });
  });
});
