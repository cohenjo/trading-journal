import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { getNdxChartData } from './actions';

function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
}

beforeEach(() => vi.resetAllMocks());

describe('getNdxChartData', () => {
  it('returns empty array when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn() });

    await expect(getNdxChartData('2026-05-03')).resolves.toEqual([]);
  });

  it('returns timestamped chart rows', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const ndxChain = chain({ data: [{ timestamp: '2026-05-03T14:30:00Z', open: '1', high: '2', low: '0.5', close: '1.5' }], error: null });
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser: mockGetUser }, from: vi.fn(() => ndxChain) });

    const result = await getNdxChartData('2026-05-03');
    expect(result).toEqual([{ time: 1777818600, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    expect(ndxChain.gte).toHaveBeenCalledWith('timestamp', '2026-05-03');
    expect(ndxChain.lt).toHaveBeenCalledWith('timestamp', '2026-05-04');
  });
});
