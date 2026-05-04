import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enqueueComputeJob: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/compute-jobs', () => ({ enqueueComputeJob: mocks.enqueueComputeJob }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import { enqueueBacktest, getBacktestRun, listBacktestRuns } from './actions';

const { enqueueComputeJob, getUser } = mocks;
const currentYear = new Date().getUTCFullYear();
const config = { year: currentYear, initial_capital: '100000', step_days: 1, underlying: 'NDX', leap_underlying: 'NDX', strategy: 'IRON_CONDOR' };
function authOk() { getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }); }
function chain(result: unknown) { return { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(result), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue(result) }; }
beforeEach(() => { vi.resetAllMocks(); authOk(); });

describe('backtest actions', () => {
  it('enqueues a backtest compute job with normalized config', async () => { enqueueComputeJob.mockResolvedValue('job-1'); await expect(enqueueBacktest({ ...config, underlying: 'ndx', leap_underlying: 'qqq', strategy: 'iron_condor', step_days: 7 })).resolves.toBe('job-1'); expect(enqueueComputeJob).toHaveBeenCalledWith('backtest', { config: { ...config, step_days: 7, underlying: 'NDX', leap_underlying: 'QQQ', strategy: 'IRON_CONDOR' } }); });
  it('lists backtest runs through Supabase RLS', async () => { const rows = [{ id: 'run-1', household_id: 'hh-1', compute_job_id: 'job-1', config, result: { final_equity: '101000' }, started_at: '2026-05-03T00:00:00Z', finished_at: '2026-05-03T00:00:01Z', created_at: '2026-05-03T00:00:00Z' }]; const runsChain = chain({ data: rows, error: null }); (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser }, from: vi.fn(() => runsChain) }); await expect(listBacktestRuns()).resolves.toEqual(rows); expect(runsChain.order).toHaveBeenCalledWith('created_at', { ascending: false }); expect(runsChain.limit).toHaveBeenCalledWith(20); });
  it('fetches one backtest run by id', async () => { const row = { id: 'run-1', household_id: 'hh-1', compute_job_id: null, config, result: { final_equity: '101000' }, started_at: null, finished_at: null, created_at: '2026-05-03T00:00:00Z' }; const runsChain = chain({ data: row, error: null }); (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser }, from: vi.fn(() => runsChain) }); await expect(getBacktestRun('run-1')).resolves.toEqual(row); expect(runsChain.eq).toHaveBeenCalledWith('id', 'run-1'); });
  it('returns empty list when unauthenticated', async () => { getUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') }); (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({ auth: { getUser }, from: vi.fn() }); await expect(listBacktestRuns()).resolves.toEqual([]); });
});
