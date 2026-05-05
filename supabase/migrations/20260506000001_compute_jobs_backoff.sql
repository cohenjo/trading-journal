-- Migration: TJ-027 compute job resilience (#80)
-- Adds exponential-backoff retry support to the compute_jobs queue:
--   * next_retry_at column: lets the worker delay re-claim after a transient failure
--   * Raises the attempts CHECK constraint from 3 to 5 (matches MAX_ATTEMPTS in job_queue.py)
--   * Partial index for efficient pending-job polling with next_retry_at filter

-- Add backoff column (nullable; NULL means "retry immediately / not yet failed")
alter table public.compute_jobs
  add column if not exists next_retry_at timestamptz;

-- Drop old attempts constraint and replace with updated cap
alter table public.compute_jobs
  drop constraint if exists compute_jobs_attempts_check;

alter table public.compute_jobs
  add constraint compute_jobs_attempts_check check (attempts <= 5);

-- Partial index: speeds up the worker's claim query
--   WHERE status = 'pending' AND attempts < 5 AND (next_retry_at IS NULL OR next_retry_at <= now())
create index if not exists idx_compute_jobs_pending_retry
  on public.compute_jobs (created_at)
  where status = 'pending' and next_retry_at is not null;

comment on column public.compute_jobs.next_retry_at is
  'Earliest time this job may be re-claimed after a transient failure. '
  'NULL means the job is immediately eligible for re-claim.';
