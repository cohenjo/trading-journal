import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setComputeJobsTestClient,
  enqueueComputeJob,
  getComputeJob,
  subscribeToComputeJob,
  type ComputeJob,
} from '../compute-jobs';

const getUser = vi.fn();

function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  __setComputeJobsTestClient(null);
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('compute job helpers', () => {
  it('enqueues compute jobs scoped to the active household', async () => {
    const householdChain = chain({ data: { household_id: 'hh-1' }, error: null });
    const insertChain = chain({ data: { id: 'job-1' }, error: null });
    const from = vi.fn((table: string) => {
      if (table === 'household_members') return householdChain;
      if (table === 'compute_jobs') return insertChain;
      throw new Error(`Unexpected table ${table}`);
    });
    __setComputeJobsTestClient({ auth: { getUser }, from } as never);

    await expect(enqueueComputeJob('backtest', { years: [2025] })).resolves.toBe('job-1');
    expect(insertChain.insert).toHaveBeenCalledWith({
      household_id: 'hh-1',
      job_type: 'backtest',
      payload: { years: [2025] },
    });
  });

  it('fetches and normalizes one compute job', async () => {
    const jobRow: ComputeJob = {
      id: 'job-1',
      household_id: 'hh-1',
      job_type: 'backtest',
      payload: { years: [2025] },
      status: 'done',
      result: { run_id: 'run-1' },
      error: null,
      attempts: 1,
      created_at: '2026-05-03T00:00:00Z',
      started_at: '2026-05-03T00:00:01Z',
      finished_at: '2026-05-03T00:00:02Z',
    };
    const jobChain = chain({ data: jobRow, error: null });
    __setComputeJobsTestClient({ auth: { getUser }, from: vi.fn(() => jobChain) } as never);

    await expect(getComputeJob('job-1')).resolves.toEqual(jobRow);
    expect(jobChain.eq).toHaveBeenCalledWith('id', 'job-1');
  });

  it('subscribes to realtime job changes and unsubscribes', () => {
    const callback = vi.fn();
    const removeChannel = vi.fn();
    const channel = {
      on: vi.fn((_event, _filter, handler) => {
        handler({
          new: {
            id: 'job-1',
            household_id: 'hh-1',
            job_type: 'backtest',
            payload: {},
            status: 'running',
            result: null,
            error: null,
            attempts: 0,
            created_at: '2026-05-03T00:00:00Z',
            started_at: null,
            finished_at: null,
          },
        });
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const supabase = {
      auth: { getUser },
      from: vi.fn(),
      channel: vi.fn(() => channel),
      removeChannel,
    };
    __setComputeJobsTestClient(supabase as never);

    const unsubscribe = subscribeToComputeJob('job-1', callback);
    expect(supabase.channel).toHaveBeenCalledWith('compute-job:job-1');
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'running' }));

    unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
