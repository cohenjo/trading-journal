import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getTickerAnalysis, listGrowthStories } from './actions';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getTickerAnalysis', () => {
  it('returns the freshest household-scoped row before global rows', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            ticker: 'MSFT',
            household_id: null,
            data: { sections: { fundamentals: { ticker: 'MSFT', market_cap: 1 } } },
            refreshed_at: '2026-01-01T00:00:00.000Z',
          },
          {
            ticker: 'MSFT',
            household_id: 'household-1',
            data: { sections: { fundamentals: { ticker: 'MSFT', market_cap: 2 } } },
            refreshed_at: new Date().toISOString(),
          },
        ],
        error: null,
      }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn((table: string) => {
        expect(table).toBe('analysis_tickers');
        return query;
      }),
    });

    const result = await getTickerAnalysis('msft');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.household_id).toBe('household-1');
      expect(result.data?.data.sections?.fundamentals).toMatchObject({ market_cap: 2 });
    }
    expect(query.eq).toHaveBeenCalledWith('ticker', 'MSFT');
  });

  it('rejects invalid ticker symbols before querying', async () => {
    const result = await getTickerAnalysis('../bad');

    expect(result).toEqual({ ok: false, error: 'Invalid ticker symbol' });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('listGrowthStories', () => {
  it('reads growth stories from Supabase with an optional ticker filter', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'story-1',
            ticker: 'NVDA',
            household_id: null,
            story: { ticker: 'NVDA', value_driver: 'AI demand' },
            refreshed_at: new Date().toISOString(),
          },
        ],
        error: null,
      }),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn((table: string) => {
        expect(table).toBe('analysis_growth_stories');
        return query;
      }),
    });

    const result = await listGrowthStories({ ticker: 'nvda', limit: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].story).toMatchObject({ value_driver: 'AI demand' });
    expect(query.eq).toHaveBeenCalledWith('ticker', 'NVDA');
    expect(query.limit).toHaveBeenCalledWith(1);
  });
});
