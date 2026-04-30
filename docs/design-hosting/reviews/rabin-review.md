# Rabin Security Review — design.md

## Verdict: APPROVED WITH CONDITIONS

## Summary
The unified design preserves the main security posture from Section 03: Supabase Auth, Google OAuth, no browser token storage, household-scoped RLS, single-use invite tokens, Supabase JWT verification for FastAPI, and service-role isolation. I do not see a fatal reconciliation break in the primary `design.md`, and the enum simplification is resolved in the safer direction (`household_role`, default `viewer`). Approval is conditional on tightening service-role wording, adding missing household lifecycle/audit controls, and making the backup/free-tier retention story explicit before implementation starts.

## Findings
### 🔴 Blocking (must fix before approval)
- None for the design direction. The hybrid architecture is acceptable if the conditions below are addressed before implementation/production hardening.

### 🟡 Important (should fix)
- **Clarify service-role vs direct Postgres credentials.** `design.md` says Vercel env vars include `SUPABASE_SERVICE_ROLE_KEY` as server-only (lines 77, 121) and Phase 4 says local Docker workers connect via direct URL with “service-role credentials” (line 330). Supabase service-role keys are API keys that bypass RLS when used through Supabase APIs; direct Postgres uses database credentials/roles and also needs least-privilege design. Revise to: browser never receives service-role; Server Actions use user-scoped SSR clients by default; GitHub Actions/local workers store privileged secrets only in protected secret stores; worker DB roles should be constrained where feasible; every privileged write path is audited. This preserves Section 03’s stricter guidance (03-auth lines 461–491, 539–545).
- **Add explicit household lifecycle controls.** `design.md` includes `left_at` and owner/member/viewer roles (lines 151–160) but does not document owner invariants, breakup/divorce offboarding, member removal semantics, or role-change race handling. Pull forward Section 03’s rules: at least one active owner, leaving/removing sets `left_at` rather than deleting, owner-only role changes/removals, and household deletion/last-owner policy (03-auth lines 233–249, 522–531). Add transactional checks or deferrable constraints/triggers so a concurrent role downgrade/removal cannot leave zero owners or authorize a stale role.
- **Invite table and replay protections are summarized but underspecified.** The primary doc says hashed single-use token, expiry, revoked check, email match, and transactional accept (lines 168–173), which is good. It should also include or reference the concrete `household_invites` table with `accepted_at`, `revoked_at`, `role_not_owner`, rate limiting, “do not reveal account existence,” and normalized `citext` email from Section 03 (03-auth lines 198–231). Add revocation UI/owner audit requirements.
- **Threat model coverage was compressed too far.** `design.md` covers RLS mistakes, OAuth preview redirects, service-role laptop leaks, and Server Actions (lines 344–350), but omits several Section 03 threats: XSS/token theft, OAuth open redirect detail, invite replay, account email-change risk, financial data leakage in logs/errors, CSRF, role escalation, and soft-deleted/ex-member access (03-auth lines 495–508). Keep the concise risk table, but add those as explicit hybrid-architecture threats because Vercel Server Actions + local workers + Supabase creates multiple trust boundaries.
- **Free-tier pausing and backup guarantees are not explicit enough.** `design.md` lists free-tier limits and asks whether 7-day backups are sufficient (lines 96, 345, 373), but does not discuss Supabase project pausing/inactivity, restore testing, encrypted dump location, or data-retention guarantees for personal financial records. Import Section 06’s backup baseline (06-data lines 444–466) and add a decision: either upgrade before relying on hosted retention, or schedule encrypted local `pg_dump` from day one and test restores.
- **Section 06 remains inconsistent with the chosen RLS helper.** `design.md` correctly calls this out (lines 359–363, 382), but the referenced Section 06 helper still lacks `left_at` and `households.deleted_at` checks and uses `household_member_role` (06-data lines 68–76, 340–370). This will confuse implementers. McManus should update Section 06 before migrations are written.
- **Service-role in GitHub Actions cron needs tighter boundaries.** `design.md` allows GitHub Actions cron for refresh jobs (lines 120, 331) and Section 05 notes Actions are observable with encrypted secrets but public hosted runners should not contain broker desktop sessions or sensitive local files (05-backend lines 177–193). Add a rule that Actions jobs may use only the minimum required Supabase secrets, never broker desktop/session material, and should prefer SQL-only/userless maintenance with audited job identities.

### 🟢 Nits (optional polish)
- `design.md` line 96 states “daily backups (7-day retention)” as if universally true on free tier; soften to “plan-dependent backups; verify current Supabase plan behavior.”
- `design.md` line 75 correctly says no public ISR for household data; add “set `dynamic = 'force-dynamic'`/no caching for auth-scoped routes” if implementation guidance is desired.
- `design.md` line 90 says FastAPI verifies Supabase JWTs via JWKS; add the issuer/audience checks from Section 03 (03-auth lines 447–459) in the migration checklist.
- The primary doc should reference audit logging for invites, role changes, imports, deletes, and service-role actions in one place rather than scattering it across risks and phases.

## Spot-check: SQL/RLS examples
The `design.md` RLS direction is sound, and the reconciliation did **not** break the helper by renaming the enum; `household_role` is the right canonical enum (lines 151–156, 359). However, the snippet at lines 179–189 is too partial to be implementation-ready: it references helper functions not shown, does not show grants/revokes, and omits update/delete/owner/deleted-row behavior. Section 06’s current helper is unsafe for the unified model because it ignores `left_at` and deleted households.

Use this corrected core helper/policy shape as the canonical migration starting point:

```sql
create type public.household_role as enum ('owner', 'member', 'viewer');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.household_role not null default 'viewer',
  invited_by uuid references auth.users(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (household_id, user_id)
);

create index household_members_user_active_idx
  on public.household_members (user_id, household_id)
  where left_at is null;

create or replace function public.household_role_for(hid uuid)
returns public.household_role
language sql
stable
security definer
set search_path = public
as $$
  select hm.role
  from public.household_members hm
  join public.households h on h.id = hm.household_id
  where hm.household_id = hid
    and hm.user_id = auth.uid()
    and hm.left_at is null
    and h.deleted_at is null
  limit 1;
$$;

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.household_role_for(hid) is not null;
$$;

create or replace function public.can_write_household(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.household_role_for(hid) in ('owner', 'member');
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.household_role_for(hid) = 'owner';
$$;

revoke all on function public.household_role_for(uuid) from public;
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.can_write_household(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.household_role_for(uuid) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.can_write_household(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

alter table public.trades enable row level security;
alter table public.trades force row level security;

create policy trades_select_active_household_members
on public.trades
for select
to authenticated
using (deleted_at is null and public.is_household_member(household_id));

create policy trades_insert_writers
on public.trades
for insert
to authenticated
with check (
  public.can_write_household(household_id)
  and created_by = auth.uid()
  and deleted_at is null
);

create policy trades_update_writers
on public.trades
for update
to authenticated
using (deleted_at is null and public.can_write_household(household_id))
with check (public.can_write_household(household_id));

create policy trades_select_deleted_for_owners
on public.trades
for select
to authenticated
using (deleted_at is not null and public.is_household_owner(household_id));
```

Also add triggers/column grants to prevent `household_id`, `created_by`, and audit fields from being client-mutated after insert, and add separate audited owner-only policies/endpoints for member removal, role changes, restore, and hard delete.

## Recommendation to Lead
Keaton can keep the hybrid recommendation, but should revise `design.md` before marking it implementation-ready. Owners: **Rabin** to expand the threat model, invite lifecycle, audit, and RLS canonical snippet; **Hockney/Kujan** to clarify service-role vs direct DB credentials across Vercel, GitHub Actions, and local Docker; **McManus** to update Section 06 to match `household_role`, `left_at`, deleted-household checks, and backup/restore guidance; **Kujan** to document current Supabase free-tier pausing/backup behavior and the encrypted offsite dump process.
