import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type ComputeJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ComputeJob {
  id: string;
  household_id: string;
  job_type: string;
  payload: unknown;
  status: ComputeJobStatus;
  result: unknown | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

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

function createBrowserSupabase(): SupabaseLike {
  if (testClient) return testClient;
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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

function normalizeComputeJob(row: Record<string, unknown>): ComputeJob {
  return {
    id: String(row.id),
    household_id: String(row.household_id),
    job_type: String(row.job_type),
    payload: row.payload,
    status: row.status as ComputeJobStatus,
    result: row.result ?? null,
    error: row.error == null ? null : String(row.error),
    attempts: Number(row.attempts ?? 0),
    created_at: String(row.created_at),
    started_at: row.started_at == null ? null : String(row.started_at),
    finished_at: row.finished_at == null ? null : String(row.finished_at),
  };
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

/** Subscribe to status changes for one compute job. Returns an unsubscribe callback. */
export function subscribeToComputeJob(
  jobId: string,
  onUpdate: (job: ComputeJob) => void,
): () => void {
  const supabase = createBrowserSupabase();
  const channel: RealtimeChannel = supabase
    .channel(`compute-job:${jobId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'compute_jobs',
        filter: `id=eq.${jobId}`,
      },
      (event: { new: Record<string, unknown> }) => {
        if (event.new) onUpdate(normalizeComputeJob(event.new));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
