import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getDayDetails } from './actions';

function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('getDayDetails', () => {
  it('returns null for invalid dates', async () => {
    await expect(getDayDetails('not-a-date')).resolves.toBeNull();
  });

  it('returns day details from Supabase tables', async () => {
    const results: Record<string, unknown> = {
      household_members: chain({ data: { household_id: 'hh-1' }, error: null }),
      dailysummary: chain({ data: { date: '2026-05-03', total_pnl: '10', winning_trades: 1, losing_trades: 0, win_rate: '1', avg_win: '10', avg_loss: '0' }, error: null }),
      note: chain({ data: { content: 'Good day' }, error: null }),
      matchedtrade: chain({ data: [{ id: 1, symbol: 'NDX', open_date: '2026-05-03T14:00:00Z', close_date: '2026-05-03T14:05:00Z', open_price: '1', close_price: '2', pnl: '100' }], error: null }),
      dailybar: chain({ data: { symbol: 'NDX', date: '2026-05-03', open: '1', high: '2', low: '0.5', close: '1.5', volume: 100 }, error: null }),
    };
    const from = vi.fn((table: string) => results[table]);
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from });

    const result = await getDayDetails('2026-05-03');

    expect(result?.summary?.total_pnl).toBe(10);
    expect(result?.note?.content).toBe('Good day');
    expect(result?.matched_trades[0].pnl).toBe(100);
    expect(result?.market_data?.close).toBe(1.5);
  });
});
