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

type SupabaseRealtimeLike = Pick<SupabaseClient<Database>, 'channel' | 'removeChannel'>;

function createBrowserSupabase(): SupabaseRealtimeLike {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
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

/** Subscribe to status changes for one compute job from a Client Component. */
export function subscribeToComputeJob(
  jobId: string,
  onUpdate: (job: ComputeJob) => void,
): () => void {
  const supabase = createBrowserSupabase();
  const channel: RealtimeChannel = supabase
    .channel(`compute-job:${jobId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'compute_jobs', filter: `id=eq.${jobId}` },
      (event: { new: Record<string, unknown> }) => {
        if (event.new) onUpdate(normalizeComputeJob(event.new));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
