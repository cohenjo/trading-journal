import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { normalizeComputeJob, type ComputeJob } from './compute-jobs-client';

export type { ComputeJob, ComputeJobStatus } from './compute-jobs-client';

type SupabaseLike = Pick<SupabaseClient<Database>, 'auth' | 'from' | 'channel' | 'removeChannel'>;

let testClient: SupabaseLike | null = null;

/** Override the Supabase client in unit tests. */
export function __setComputeJobsTestClient(client: SupabaseLike | null): void {
  testClient = client;
}

async function createServerSupabase(): Promise<SupabaseLike> {
  if (testClient) return testClient;
  const { createClient } = await import('@/lib/supabase/server');
  return createClient();
}

async function requireActiveHouseholdId(supabase: SupabaseLike): Promise<string> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Authentication is required to enqueue compute jobs.');
  }

  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', user.id)
    .is('left_at', null)
    .limit(1)
    .maybeSingle();

  if (error || !data?.household_id) {
    throw new Error(error?.message ?? 'No active household found for the current user.');
  }

  return String(data.household_id);
}

/** Enqueue an on-demand backend compute job for the current household. */
export async function enqueueComputeJob(jobType: string, payload: unknown): Promise<string> {
  if (!jobType.trim()) {
    throw new Error('jobType is required.');
  }

  const supabase = await createServerSupabase();
  const householdId = await requireActiveHouseholdId(supabase);

  const { data, error } = await supabase
    .from('compute_jobs')
    .insert({
      household_id: householdId,
      job_type: jobType,
      payload,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Failed to enqueue compute job.');
  }

  return String(data.id);
}

/** Fetch one compute job visible to the current household/session. */
export async function getComputeJob(jobId: string): Promise<ComputeJob | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('compute_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? normalizeComputeJob(data as Record<string, unknown>) : null;
}
