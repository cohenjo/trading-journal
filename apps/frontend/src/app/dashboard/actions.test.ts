import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import {
  computeFreshnessStatus,
  secondsSince,
  getDashboardSnapshot,
  triggerHouseholdRefresh,
  STALE_THRESHOLD_MS,
  REFRESH_RATE_LIMIT_SECONDS,
  type HouseholdRefreshState,
} from './actions';

// ─── Unit tests for pure helpers ──────────────────────────────────────────────

describe('computeFreshnessStatus', () => {
  it('returns refreshing when hasActiveJob is true regardless of state', () => {
    expect(computeFreshnessStatus(null, true)).toBe('refreshing');
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: new Date(Date.now() - 1000).toISOString(),
      lastFailedAt: null,
      lastError: null,
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, true)).toBe('refreshing');
  });

  it('returns stale when refreshState is null and no active job', () => {
    expect(computeFreshnessStatus(null, false)).toBe('stale');
  });

  it('returns failed when only lastFailedAt is set', () => {
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: null,
      lastFailedAt: new Date(Date.now() - 5000).toISOString(),
      lastError: 'division by zero',
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, false)).toBe('failed');
  });

  it('returns fresh when lastSucceededAt is within STALE_THRESHOLD_MS', () => {
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
      lastFailedAt: null,
      lastError: null,
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, false)).toBe('fresh');
  });

  it('returns stale when lastSucceededAt is older than STALE_THRESHOLD_MS', () => {
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString(),
      lastFailedAt: null,
      lastError: null,
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, false)).toBe('stale');
  });

  it('returns failed when lastFailedAt is newer than lastSucceededAt', () => {
    const succeeded = new Date(Date.now() - 3600_000).toISOString(); // 1 h ago
    const failed = new Date(Date.now() - 600_000).toISOString();    // 10 min ago
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: succeeded,
      lastFailedAt: failed,
      lastError: 'compute error',
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, false)).toBe('failed');
  });

  it('returns fresh when lastSucceededAt is newer than lastFailedAt', () => {
    const failed = new Date(Date.now() - 3600_000).toISOString();
    const succeeded = new Date(Date.now() - 60_000).toISOString();
    const state: HouseholdRefreshState = {
      jobType: 'pnl_daily',
      lastSucceededAt: succeeded,
      lastFailedAt: failed,
      lastError: null,
      lastRunId: null,
    };
    expect(computeFreshnessStatus(state, false)).toBe('fresh');
  });
});

describe('secondsSince', () => {
  it('returns null for null input', () => {
    expect(secondsSince(null)).toBeNull();
  });

  it('returns positive integer for a past ISO timestamp', () => {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    const result = secondsSince(fiveSecondsAgo);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(4);
    expect(result!).toBeLessThanOrEqual(6);
  });

  it('returns 0 for a future timestamp (clamped)', () => {
    const future = new Date(Date.now() + 10_000).toISOString();
    expect(secondsSince(future)).toBe(0);
  });
});

// ─── Server Action tests ──────────────────────────────────────────────────────

const mockGetUser = vi.fn();

function buildChain(result: unknown) {
  const b = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (cb: (v: unknown) => unknown) => Promise.resolve(result).then(cb),
  };
  return b;
}

function authOk(householdId = 'hh-1') {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  return householdId;
}

function authFail() {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') });
}

beforeEach(() => vi.resetAllMocks());

describe('getDashboardSnapshot — unauthenticated', () => {
  it('returns isFirstRun=true snapshot when user is not authenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await getDashboardSnapshot();

    expect(result.isFirstRun).toBe(true);
    expect(result.dailyPerformance).toEqual([]);
    expect(result.dashboardSummary).toBeNull();
    expect(result.refreshState).toBeNull();
  });
});

describe('getDashboardSnapshot — empty cooked tables', () => {
  it('returns isFirstRun=true when no cooked rows exist', async () => {
    authOk();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({ data: null, error: null });
        if (table === 'daily_performance')
          return { ...buildChain({ data: [], error: null }), maybeSingle: vi.fn() };
        if (table === 'dashboard_summary')
          return buildChain({ data: null, error: null });
        if (table === 'compute_jobs')
          return { ...buildChain({ data: [], error: null }), maybeSingle: vi.fn() };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDashboardSnapshot();
    expect(result.isFirstRun).toBe(true);
    expect(result.freshnessStatus).toBe('stale');
  });
});

describe('getDashboardSnapshot — populated cooked tables', () => {
  it('returns fresh status and daily performance rows', async () => {
    authOk();
    const freshTimestamp = new Date(Date.now() - 60_000).toISOString();

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({
            data: {
              job_type: 'pnl_daily',
              last_succeeded_at: freshTimestamp,
              last_failed_at: null,
              last_error: null,
              last_run_id: null,
            },
            error: null,
          });
        if (table === 'daily_performance') {
          return {
            ...buildChain({
              data: [
                {
                  date: '2026-05-01',
                  currency: 'USD',
                  performance_payload: { total_pnl: '1234.56', winning_trades: 5, losing_trades: 2, win_rate: 0.71 },
                  _computed_at: freshTimestamp,
                },
              ],
              error: null,
            }),
            maybeSingle: vi.fn(),
          };
        }
        if (table === 'dashboard_summary')
          return buildChain({ data: null, error: null });
        if (table === 'compute_jobs')
          return { ...buildChain({ data: [], error: null }), maybeSingle: vi.fn() };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDashboardSnapshot();
    expect(result.isFirstRun).toBe(false);
    expect(result.freshnessStatus).toBe('fresh');
    expect(result.dailyPerformance).toHaveLength(1);
    expect(result.dailyPerformance[0].totalPnl).toBe('1234.56');
  });
});

describe('getDashboardSnapshot — missing refresh_state row', () => {
  it('handles null refresh_state gracefully and returns stale', async () => {
    authOk();
    const perfRow = {
      date: '2026-05-01',
      currency: 'USD',
      performance_payload: { total_pnl: '100.00' },
      _computed_at: new Date().toISOString(),
    };

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({ data: null, error: null });
        if (table === 'daily_performance')
          return { ...buildChain({ data: [perfRow], error: null }), maybeSingle: vi.fn() };
        if (table === 'dashboard_summary')
          return buildChain({ data: null, error: null });
        if (table === 'compute_jobs')
          return { ...buildChain({ data: [], error: null }), maybeSingle: vi.fn() };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await getDashboardSnapshot();
    expect(result.refreshState).toBeNull();
    expect(result.freshnessStatus).toBe('stale');
    expect(result.isFirstRun).toBe(false);
  });
});

describe('triggerHouseholdRefresh', () => {
  it('returns error when unauthenticated', async () => {
    authFail();
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn(),
    });

    const result = await triggerHouseholdRefresh();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Authentication/i);
  });

  it('rejects if last_succeeded_at is within rate-limit window', async () => {
    authOk();
    const recentTimestamp = new Date(
      Date.now() - (REFRESH_RATE_LIMIT_SECONDS - 5) * 1000,
    ).toISOString();

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({ data: { last_succeeded_at: recentTimestamp }, error: null });
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await triggerHouseholdRefresh();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/wait/i);
  });

  it('rejects if an active job is already running', async () => {
    authOk();
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({ data: { last_succeeded_at: oldTimestamp }, error: null });
        if (table === 'compute_jobs')
          return { ...buildChain({ data: [{ id: 'job-1' }], error: null }), maybeSingle: vi.fn() };
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await triggerHouseholdRefresh();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/progress/i);
  });

  it('enqueues a job and returns ok when conditions are met', async () => {
    authOk();
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();

    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'household_members')
          return buildChain({ data: { household_id: 'hh-1' }, error: null });
        if (table === 'household_refresh_state')
          return buildChain({ data: { last_succeeded_at: oldTimestamp }, error: null });
        if (table === 'compute_jobs') {
          const chain = buildChain({ data: [], error: null });
          chain.single = vi.fn().mockResolvedValue({ data: { id: 'new-job-42' }, error: null });
          return chain;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const result = await triggerHouseholdRefresh();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.jobId).toBe('new-job-42');
  });
});
