# Decision: Secret Handling Policy

**Filed by:** Rabin (Security Engineer)
**Date:** 2026-05-03
**Trigger:** INC-2026-05-03-001 — Supabase service-role key leaked in `.squad/decisions.md`
**Status:** Adopted — effective immediately

---

## Policy: Secrets and Credential Handling

### 1. Secret Storage

- **All secrets** (API keys, JWT tokens, OAuth credentials, database passwords, recovery codes)
  **must be stored in `.env.local` only** (at the `apps/frontend/` or repo root).
- `.env.local` is gitignored and must **never** be committed.
- `.env.example` documents variable names with **empty or obviously-fake placeholder values only**.
  Example: `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here`.
- The `.secrets/` directory is gitignored and is for local-disk paste workflows only.
  **Never commit anything under `.secrets/`.**

### 2. Documentation and Session Logs

- Session logs, inbox files, and decision documents **must never contain live credential values**.
- Use `$SUPABASE_SERVICE_ROLE_KEY` (env-var reference) or `<REDACTED>` in any markdown/log.
- The Scribe agent must scan inbox files for `eyJ` (JWT prefix) or known secret patterns before
  merging and raise a warning if found.

### 3. Pre-commit Protection

- All developer machines must run `pip install pre-commit && pre-commit install` after clone.
- The `.pre-commit-config.yaml` (committed to repo) includes `gitleaks` secret scanning.
- CI must run pre-commit checks on all PRs.

### 4. GitHub Push Protection

- GitHub push protection (`secret_scanning_push_protection`) must be **enabled** on the repo.
- If any push protection alert fires: stop, rotate the leaked credential immediately, then resolve
  the alert as "revoked" in GitHub.

### 5. Service-role Key Policy

- **Service-role keys must be rotated immediately upon any confirmed or suspected leak.**
- Service-role keys bypass Row Level Security entirely and are the highest-value credential
  in the Supabase stack.
- Service-role keys must only be used server-side (FastAPI backend, GitHub Actions, Vercel
  environment variables). Never prefix with `NEXT_PUBLIC_`.
- After rotation: update Vercel env vars, GitHub Actions secrets, and local `.env.local` files.

### 6. Anon Key Policy

- Anon keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) are intentionally public and embedded in the
  browser bundle. They are restricted by RLS policies.
- Rotate anon keys only if the Supabase project domain itself was compromised, or if you want
  to force all existing anonymous sessions to re-authenticate.
- Do NOT rotate anon keys for a service-role key leak unless Rabin advises otherwise.

### 7. Rotation Response Checklist

When a service-role key or equivalent high-value secret is leaked:
1. Rotate in the upstream service immediately (Supabase Dashboard, Google Cloud, etc.)
2. Update all deployment targets (Vercel, GitHub Actions, CI secrets)
3. Redact the value from any tracked files in a hotfix PR
4. File incident report in `docs/security/incident-YYYY-MM-DD-<slug>.md`
5. Post-rotation: verify old key returns 401, new key works
6. Confirm GitHub secret-scanning alert is resolved

### 8. History Rewrite Policy

- **Do not rewrite git history** for a rotated JWT credential (service-role, anon, or personal
  access token) unless:
  - The credential cannot be rotated (e.g., a static master password embedded in migration SQL), OR
  - Forensic evidence shows the leaked credential was actively used by an unauthorized party.
- For all other cases: rotate → redact → document. The redaction PR is sufficient.
- If history rewrite is needed, use `git-filter-repo` (not BFG) and coordinate with the full
  team to re-clone or rebase all outstanding branches.

---

## Rationale

This policy codifies lessons from INC-2026-05-03-001 where a service-role key was inadvertently
committed via session logs. The core principle is defense-in-depth: gitignore + pre-commit
scanning + push protection + documentation hygiene, each layer catching what the previous missed.
