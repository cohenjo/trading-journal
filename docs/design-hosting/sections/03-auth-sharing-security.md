# 03 — Auth, Sharing & Security

**Owner:** Rabin — Security Engineer  
**Recommended path:** Supabase Auth + Google OAuth + Postgres RLS-backed household sharing  
**Data sensitivity:** High — personal financial and trading data

This section proposes replacing the current `python-jose` / `passlib` application-managed JWT flow with Supabase Auth, while preserving a separate FastAPI backend where needed. The design goal is simple Google sign-in for a small user group, strong default isolation through Postgres Row Level Security (RLS), and a household sharing model that integrates with the existing couples/shared settings concept.

> **Verify Supabase docs before implementation:** pricing/free-tier limits, MFA availability, exact cookie options supported by the installed `@supabase/ssr` version, preview URL wildcard behavior, and the current Supabase JWT issuer/JWKS endpoint format can change.

---

## 1. Auth provider comparison

Scores: 1 = weak / high effort, 5 = strong / low effort for this app.

| Provider | Free tier | Google OAuth ease | RLS integration with Postgres | MFA | Next.js 15 App Router SSR cookie/session story | Vendor lock-in | Notes | Total |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| **Supabase Auth** | 5 | 5 | 5 | 3 | 4 | 3 | Best fit because auth claims flow naturally into Supabase Postgres RLS via `auth.uid()`. Minimal UI; build app-specific screens. | **25** |
| **Auth.js / NextAuth** | 5 | 4 | 2 | 2 | 5 | 5 | Excellent Next.js fit and low lock-in, but Postgres RLS requires custom JWT/claim plumbing and more security code. | 23 |
| **Clerk** | 4 | 5 | 2 | 5 | 5 | 2 | Best hosted auth DX and MFA UX, but RLS integration is indirect and creates another trust boundary. | 23 |
| **Auth0** | 3 | 4 | 2 | 5 | 4 | 2 | Mature enterprise option; more configuration, cost, and lock-in than needed for a small sensitive app. | 20 |
| **Self-hosted Authentik / Keycloak** | 5 | 3 | 2 | 5 | 2 | 5 | Maximum control, but operational burden is not justified for a small household-sharing product unless self-hosting is a hard requirement. | 22 |

### Recommendation rationale

Use **Supabase Auth** because the decisive control is not only login; it is authorization at the data boundary. Financial data should remain protected even if a frontend route, API handler, or FastAPI endpoint forgets an authorization check. Supabase Auth + Postgres RLS lets data access policies use `auth.uid()` directly and keeps authorization close to the tables.

### Trade-offs

- Supabase couples authentication, database, and storage choices more tightly than Auth.js.
- Clerk/Auth0 offer stronger turnkey identity admin UX and richer MFA/enterprise features.
- Auth.js offers the least vendor lock-in but requires more custom security code for RLS and refresh-token handling.
- Self-hosted identity is attractive for sovereignty, but Keycloak/Authentik add patching, uptime, backups, and incident-response obligations.

---

## 2. Recommended setup: Supabase Auth + Google OAuth

### 2.1 Supabase project configuration

1. Create or select the Supabase project for the environment.
2. In **Authentication → Providers → Google**, enable Google.
3. Add the Google OAuth **Client ID** and **Client Secret** from Google Cloud.
4. In **Authentication → URL Configuration** set:
   - **Site URL**: production app URL, for example `https://trading-journal.example.com`.
   - **Additional Redirect URLs**:
     - `http://localhost:3000/auth/callback`
     - `http://127.0.0.1:3000/auth/callback` if local tooling uses it
     - `https://trading-journal.example.com/auth/callback`
     - Vercel production URL, for example `https://trading-journal.vercel.app/auth/callback`
     - Approved Vercel preview URLs when testing OAuth on previews.
5. Configure email templates for household invites if using Supabase magic links or invite links.
6. Enable MFA policy if available for the chosen plan; prefer TOTP over SMS for sensitive finance data.

> **Verify Supabase docs:** Supabase redirect wildcard behavior has changed over time and may differ between dashboard fields and provider callbacks. Do not assume `https://*.vercel.app/**` is accepted; test the exact preview URL strategy.

### 2.2 Google Cloud OAuth client

In Google Cloud Console:

1. Create an OAuth consent screen.
   - App type: External unless restricted to a Google Workspace.
   - Publish state: Testing for local/internal testing; Production before general use.
   - Scopes: start with `openid`, `email`, `profile` only.
2. Create an **OAuth 2.0 Client ID**.
   - Application type: Web application.
3. Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://trading-journal.example.com`
   - `https://trading-journal.vercel.app`
   - Specific preview origins if using OAuth in previews.
4. Authorized redirect URIs:
   - Supabase callback URL: `https://<project-ref>.supabase.co/auth/v1/callback`

Important distinction: Google usually redirects to Supabase’s callback URL first. Supabase then redirects back to the app’s `redirectTo` URL, such as `/auth/callback`. Both Google and Supabase redirect allowlists must be correct.

### 2.3 Next.js login flow

Recommended app flow:

1. User clicks **Continue with Google**.
2. Browser calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<app-origin>/auth/callback' } })`.
3. Google authenticates the user and redirects to Supabase Auth.
4. Supabase exchanges the provider code and redirects to `/auth/callback`.
5. `/auth/callback` exchanges the code for a Supabase session and sets secure cookies.
6. Middleware refreshes/validates session on future requests.
7. Server components/API routes use the Supabase server client with the user session so RLS policies scope data.

---

## 3. Cookie/session strategy with Next.js 15 App Router

### 3.1 Storage rules

- **Do not store access tokens or refresh tokens in `localStorage` or `sessionStorage`.** XSS would become account takeover.
- Use `@supabase/ssr` for App Router-compatible cookie handling.
- Target cookie posture:
  - `HttpOnly`: true where supported by the selected server-side flow.
  - `Secure`: true outside local development.
  - `SameSite`: `Lax` for OAuth compatibility; consider `Strict` only if it does not break provider callbacks.
  - `Path`: `/`.
  - Short-lived access token; refresh token rotation managed by Supabase Auth.

> **Verify Supabase docs / package behavior:** Some browser-driven Supabase flows require JavaScript-readable cookies to refresh sessions client-side. For this financial app, prefer a server-owned callback and middleware flow that keeps refresh tokens out of browser-readable storage. If the installed `@supabase/ssr` version cannot enforce `HttpOnly` without breaking OAuth refresh, document the residual XSS risk and add CSP + server-only auth endpoints before production.

### 3.2 Middleware responsibilities

Use `middleware.ts` with `@supabase/ssr` to:

- Read the incoming auth cookies.
- Refresh an expired access token when a valid refresh token exists.
- Write updated cookies to the response.
- Redirect anonymous users away from protected routes.
- Avoid putting tokens into request logs, error messages, query parameters, or analytics.

Recommended route split:

- Public: `/`, `/login`, `/auth/callback`, health checks, static assets.
- Authenticated: dashboards, trades, settings, imports, household management.
- Owner-only: invite management, household deletion, role changes.

### 3.3 CSRF posture

Cookie-based auth means browsers attach cookies automatically. Treat state-changing endpoints as CSRF-sensitive even with `SameSite=Lax`.

Controls:

- No state changes over `GET`.
- Check `Origin` / `Referer` on state-changing POST/PATCH/DELETE routes.
- Use CSRF tokens for server actions or API routes that rely only on cookies.
- Keep CORS allowlist narrow: localhost in development, production domain, approved preview domains only.
- Prefer `Authorization: Bearer <access_token>` for server-to-FastAPI calls where practical; bearer headers are not sent cross-site automatically.

### 3.4 Refresh-token rotation

Supabase Auth supports refresh-token rotation. Operational rules:

- Treat refresh-token reuse signals as suspicious and force re-authentication.
- Revoke sessions on password/email/provider changes where possible.
- Provide a “sign out all devices” action.
- Log auth security events without logging token values.

---

## 4. Sharing / couples / households model

The app already has a couples/shared concept in settings. Implement that concept as first-class authorization data, not frontend-only preferences.

### 4.1 Core tables

```sql
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create type public.household_role as enum ('owner', 'member', 'viewer');

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
```

### 4.2 Table ownership rule

Use the table’s data-sharing semantics to choose the authorization column.

| Data category | Recommended column | Reason |
|---|---|---|
| Trades, positions, portfolios, broker imports after validation, realized/unrealized P&L, financial plans, retirement goals, dashboards intended for both spouses | `household_id` | Shared financial truth should be visible to active household members according to role. |
| Raw import upload metadata | `household_id`, plus `uploaded_by` | Household can see imported results; uploader is retained for audit and deletion attribution. |
| User profile, notification preferences, theme, MFA status, linked OAuth identities | `owner_user_id` / `auth.users.id` | Personal account settings should not be shared. |
| Secrets, broker credentials, API keys | Prefer not stored; if unavoidable, `owner_user_id` with encrypted secret reference | Never expose spouse access to credentials unless explicitly designed and audited. |
| Existing couples/shared settings | `household_id` plus per-user preference rows as needed | Convert “shared mode” into an actual household membership and default household selection. |

Rule of thumb: if the record describes money, holdings, trades, or planning assumptions that both spouses should discuss, it belongs to a household. If it describes login identity, UI preferences, or credentials, it belongs to a user.

### 4.3 Invite flow

1. Owner opens **Settings → Household sharing**.
2. Owner enters spouse email and chooses role: `member` or `viewer`.
3. App creates an invite record:

```sql
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email citext not null,
  role public.household_role not null default 'viewer',
  token_hash text not null,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint household_invites_role_not_owner check (role in ('member', 'viewer'))
);
```

4. App sends an email link using either:
   - **Supabase invite / magic link** if it can carry and safely validate household context, or
   - a custom signed, single-use token whose **hash** is stored in `household_invites`.
5. Spouse clicks link and signs in with Google or magic link.
6. Accept endpoint verifies:
   - token hash matches,
   - invite is not expired/revoked/accepted,
   - authenticated user email matches invite email after normalization,
   - household is not deleted,
   - accepting user is not already an active member.
7. Insert `household_members(household_id, user_id, role)` and mark `accepted_at` in one transaction.

Security requirements:

- Invite tokens must be random, high entropy, single-use, and short lived (for example 7 days).
- Store only token hashes, never raw invite tokens.
- Rate-limit invite creation and acceptance attempts.
- Do not reveal whether an email already has an account.

### 4.4 Roles and permission matrix

| Action | owner | member | viewer |
|---|---:|---:|---:|
| View shared trades/positions/plans | ✅ | ✅ | ✅ |
| Create/edit trades and financial plan data | ✅ | ✅ | ❌ |
| Import broker/trade data into household | ✅ | ✅ | ❌ |
| Soft-delete trades | ✅ | ✅ | ❌ |
| Restore soft-deleted records | ✅ | ❌ by default | ❌ |
| Invite spouse/member | ✅ | ❌ | ❌ |
| Change roles | ✅ | ❌ | ❌ |
| Remove member | ✅ | ❌ | ❌ |
| Leave household | ✅ if another owner remains | ✅ | ✅ |
| Delete household | ✅ only if sole/last owner policy allows | ❌ | ❌ |
| Manage credentials/secrets | Account owner only | Account owner only | Account owner only |

For a small couples app, enforce at least one active `owner` per household. A user leaving a household sets `left_at`; do not physically delete the membership row because it is useful for audit and historical attribution.

---

## 5. Postgres RLS policies for `trades`

Assume a shared trades table:

```sql
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(20, 8) not null,
  price numeric(20, 8) not null,
  executed_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trades enable row level security;
alter table public.trades force row level security;

create index trades_household_active_idx
  on public.trades (household_id, executed_at desc)
  where deleted_at is null;
```

Helper functions:

```sql
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    join public.households h on h.id = hm.household_id
    where hm.household_id = hid
      and hm.user_id = auth.uid()
      and hm.left_at is null
      and h.deleted_at is null
  );
$$;

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

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.household_role_for(uuid) from public;
revoke all on function public.can_write_household(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.household_role_for(uuid) to authenticated;
grant execute on function public.can_write_household(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
```

Policies:

```sql
-- 1. Active household members can read non-deleted trades.
create policy trades_select_active_household_members
on public.trades
for select
to authenticated
using (
  deleted_at is null
  and public.is_household_member(household_id)
);

-- 2. Owners and members can insert trades only into households they can write to.
create policy trades_insert_writers
on public.trades
for insert
to authenticated
with check (
  public.can_write_household(household_id)
  and created_by = auth.uid()
  and deleted_at is null
);

-- 3. Owners and members can update active trades in writable households.
-- Use column-level grants or a trigger to prevent changing household_id after insert.
create policy trades_update_writers
on public.trades
for update
to authenticated
using (
  deleted_at is null
  and public.can_write_household(household_id)
)
with check (
  public.can_write_household(household_id)
);

-- 4. Owners can view soft-deleted trades for restore/audit screens.
create policy trades_select_deleted_for_owners
on public.trades
for select
to authenticated
using (
  deleted_at is not null
  and public.is_household_owner(household_id)
);

-- 5. Hard delete is owner-only, but the app should prefer soft delete.
create policy trades_delete_owners_only
on public.trades
for delete
to authenticated
using (
  public.is_household_owner(household_id)
);
```

Recommended hardening around these policies:

```sql
-- Prevent accidental cross-household record movement.
create or replace function public.prevent_trade_household_change()
returns trigger
language plpgsql
as $$
begin
  if new.household_id <> old.household_id then
    raise exception 'household_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger prevent_trade_household_change
before update on public.trades
for each row
execute function public.prevent_trade_household_change();
```

Soft-delete and leave-household edge cases:

- A user who leaves a household gets `household_members.left_at = now()` and immediately loses RLS access because helper functions require `left_at is null`.
- Historical `created_by`, `updated_by`, and `deleted_by` references remain for audit; do not cascade-delete user-authored trades.
- Normal member reads exclude `deleted_at is not null`. Owners can view deleted rows for audit/restore.
- Hard deletes should be rare, owner-only, and preferably limited to retention/GDPR workflows with audit logs.

---

## 6. Backend FastAPI auth integration

If FastAPI remains as a separate service, it should stop minting primary application JWTs and instead verify Supabase JWTs.

### 6.1 JWT verification

FastAPI should:

1. Read `Authorization: Bearer <access_token>` from incoming requests.
2. Fetch and cache Supabase JWKS from:
   - `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
3. Validate:
   - signature using `kid` and allowed algorithms,
   - `iss` equals `https://<project-ref>.supabase.co/auth/v1`,
   - `aud` equals the configured audience, commonly `authenticated`,
   - `exp`, `nbf`, and `iat`,
   - `sub` is a valid UUID user id.
4. Extract `user_id = sub`, email, app metadata, and auth assurance level if used for MFA decisions.
5. Replace the existing `python-jose` secret-key flow with Supabase JWKS validation. Keep `python-jose` only if it supports the selected algorithm cleanly; otherwise use a maintained JOSE/JWT library with JWKS support.

> **Verify Supabase docs:** confirm the issuer, audience, JWKS cache headers, and signing algorithm for the project before writing validators.

### 6.2 FastAPI-to-database access pattern

There are two patterns:

| Pattern | RLS behavior | Risk | Recommendation |
|---|---|---|---|
| Supabase anon key + per-request user JWT, via Supabase client/PostgREST | RLS enforced using `auth.uid()` | Safer; fewer app-layer authorization mistakes | **Default for user-scoped reads/writes** |
| Service-role key or privileged direct DB connection | Bypasses RLS | A single bug or secret leak can expose all financial data | Use only for narrow admin/background jobs with extra controls |

Safer default:

- Next.js obtains/refreshes the Supabase session.
- Next.js or the browser calls FastAPI with the user access token.
- FastAPI verifies the token.
- For user-scoped database operations, FastAPI uses Supabase/PostgREST with the anon key and forwards the user JWT so RLS applies.

Use service-role only when:

- Running migrations or scheduled maintenance.
- Performing server-only aggregate jobs that cannot be expressed through user RLS.
- Handling support/admin workflows with explicit audit logging and least-privilege code paths.

Controls for service-role use:

- Store `SUPABASE_SERVICE_ROLE_KEY` only in backend secret storage, never frontend env.
- Do not log it or expose it in crash reports.
- Separate service-role clients from user-scoped clients in code.
- Add tests that fail if service-role client is imported into request handlers that serve user data.
- Add audit logs for every service-role action.

If FastAPI connects directly to Postgres using SQLAlchemy, do **not** assume Supabase `auth.uid()` RLS automatically works. Direct database connections need explicit claim/session plumbing or app-layer authorization. For this app, prefer the anon-key + per-request JWT Supabase client for sensitive user data unless there is a measured performance reason to do otherwise.

---

## 7. STRIDE-lite threat model

| Risk | STRIDE category | Scenario | Mitigations |
|---|---|---|---|
| Token theft | Information disclosure / elevation of privilege | XSS steals refresh token or access token and attacker reads financial data. | No tokens in localStorage; prefer HttpOnly secure cookies; strict CSP; dependency scanning; short access-token TTL; refresh-token rotation; sign out all devices. |
| RLS bypass via service-role key leak | Elevation of privilege / information disclosure | Service-role key is accidentally exposed in frontend bundle, logs, CI, or a developer machine. | Never prefix service-role env with `NEXT_PUBLIC_`; backend-only secret storage; secret scanning; rotate on exposure; use anon + per-request JWT by default; audit service-role calls. |
| OAuth open redirect | Spoofing / tampering | Attacker manipulates `redirectTo` to steal codes/tokens or send users to a phishing domain. | Strict redirect allowlist; validate return URLs server-side; do not trust arbitrary `next` params; exact Google/Supabase redirect URIs; test preview URL handling. |
| Invite-link replay | Spoofing / elevation of privilege | A forwarded or leaked spouse invite is reused to join a household. | High-entropy single-use tokens; store token hashes; expiry; bind invite to normalized email; mark accepted in transaction; rate-limit accepts; revoke action. |
| Account takeover via email change | Elevation of privilege | User changes email to match a pending invite or loses control of email provider. | Require verified email; re-check invite email at accept; notify existing household owners on member email changes; require MFA for owners; revoke sessions after high-risk account changes. |
| Financial data leakage in logs/errors | Information disclosure | Trades, account identifiers, P&L, tokens, or invite links appear in logs or error trackers. | Structured log redaction; never log request bodies for financial endpoints; generic error messages; scrub query strings; avoid sending tokens in URLs except short-lived invite tokens. |
| CSRF on cookie-auth endpoints | Tampering | Malicious site causes a browser to submit a trade or invite request. | SameSite cookies; Origin checks; CSRF tokens for server actions; no GET mutations; narrow CORS; bearer-token auth for FastAPI where possible. |
| Household role escalation | Elevation of privilege | Viewer modifies requests to become member/owner or write trades. | RLS role helpers; owner-only role-change endpoints; database constraints preventing owner invite by token; audit role changes; tests for viewer write denial. |
| Soft-deleted data exposure | Information disclosure | Viewer/member queries deleted trades or ex-member keeps access. | RLS excludes deleted rows for non-owners; `left_at is null` required by helper functions; owner-only deleted-row policy; audit restore/delete actions. |

---

## 8. Compliance and PII controls

This is not a bank or broker, but the app processes sensitive household financial data and personal identifiers. Treat it as high-risk personal data.

### 8.1 Data minimization and retention

- Collect minimum profile data: Supabase user id, email, display name/avatar if useful.
- Do not store Google OAuth access tokens unless the app needs Google APIs; if stored, encrypt and scope narrowly.
- Retain invite records only as long as needed for audit/security, for example 90 days after expiry/acceptance unless legal needs differ.
- Define retention for raw imports separately from normalized trades; raw files often contain more PII and should have shorter retention.

### 8.2 Deletion / GDPR-style right to erase

Support:

- Export user data and household data owned by the user.
- Delete or anonymize personal profile data on account deletion.
- Handle shared household data carefully:
  - If one spouse deletes their account, keep shared trades if another active owner/member remains, but remove/anonymize the deleted user’s personal identifiers where feasible.
  - If the last owner deletes the household, soft-delete then purge according to retention policy.
- Record deletion requests and completion timestamps in an audit table without retaining unnecessary PII.

### 8.3 Backups and encryption

- Supabase provides encryption at rest and TLS in transit by default; verify plan-specific backup retention and restore capabilities.
- Ensure backups follow the same deletion/retention posture, recognizing that hard deletion from backups may complete on backup expiry rather than immediately.
- Do not place production database dumps in local developer machines unless encrypted and time-bound.

### 8.4 Secrets in CI and hosting

- Store Supabase URL and anon key as environment variables; anon key can be public but should still be managed.
- Store Google OAuth secret and Supabase service-role key only in protected backend/hosting secrets.
- Do not expose service-role key to Vercel client bundles; never use `NEXT_PUBLIC_` for secrets.
- Enable GitHub secret scanning and rotate any secret that appears in git history, logs, or issue/PR comments.
- Use separate Supabase projects/keys for local, preview, and production.

---

## 9. Migration from current `python-jose` auth

### Phase 0 — Preparation

- Inventory current users, password hashes, JWT settings, protected endpoints, tests, and frontend auth calls.
- Add Supabase Auth project and Google OAuth in development.
- Create `profiles`, `households`, `household_members`, and invite tables.
- Add RLS policies in development and verify denial-by-default.

### Phase 1 — Dual-run

- Keep existing login operational for existing local users.
- Add Supabase login as the preferred path.
- On first Supabase login, link/migrate the old user record to `auth.users.id`.
- Create a default household for each migrated user.
- Convert existing couples/shared settings into household membership/settings.
- Add telemetry for auth path usage without logging tokens or sensitive financial data.

### Phase 2 — Cutover

- Make Supabase Auth the only login for production.
- Update Next.js middleware and protected routes to rely on Supabase sessions.
- Update FastAPI dependencies to verify Supabase JWTs from JWKS.
- Move user-scoped data access to RLS-respecting Supabase client/PostgREST or implement explicit app-layer checks if direct DB remains.
- Run security tests: anonymous denied, viewer write denied, ex-member denied, owner invite succeeds, invite replay denied.

### Phase 3 — Deprecate legacy auth

- Disable legacy password login.
- Remove old JWT secret env vars after all services no longer use them.
- Remove password hashing code and passlib dependency if no longer needed.
- Rotate secrets that existed during dual-run.
- Archive migration mapping with minimum necessary retention.
- Update runbooks and incident response docs.

### Phase 4 — Production hardening

- Require MFA for household owners if feasible.
- Add audit logs for household membership, invites, role changes, imports, and deletes.
- Add automated tests for each RLS policy.
- Add secret scanning and CI checks that prevent service-role usage in frontend code.
- Perform a pre-production security review focused on OAuth redirect handling, cookie flags, RLS, and logging redaction.
