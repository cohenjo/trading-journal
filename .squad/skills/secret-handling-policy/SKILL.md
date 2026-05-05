---
name: "secret-handling-policy"
description: "Defense-in-depth secret management: storage, documentation, pre-commit scanning, push protection, and rotation response"
domain: "security, devops"
confidence: "high"
source: "merged from rabin-secret-handling-policy inbox decision"
tools:
  - name: "gitleaks"
    description: "Secret scanning pre-commit hook"
    when: "Pre-commit verification before push"
---

## Context

Secrets (API keys, JWT tokens, credentials, recovery codes) are high-value targets. A single leaked service-role key in Supabase bypasses all RLS policies. This skill codifies a defense-in-depth strategy that prevents leaks through multiple layers and establishes rapid rotation procedures.

## Patterns

### 1. Secret Storage (Gitignore + .env.local)

- **All secrets in `.env.local` only** — stored locally, never committed
- `.env.local` is gitignored and listed in `.gitignore`
- `.env.example` documents variable names with **empty or fake placeholder values** only
  - Example: `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here`
- `.secrets/` directory is gitignored for local-disk paste workflows only

### 2. Documentation Hygiene

- Session logs, inbox files, decision documents **must never contain live credential values**
- Use environment variable references like `$SUPABASE_SERVICE_ROLE_KEY` or `<REDACTED>` in markdown/logs
- Scribe agent scans inbox for JWT prefixes (`eyJ`) or known secret patterns before merging

### 3. Pre-commit Protection

- All developer machines run `pip install pre-commit && pre-commit install` after clone
- `.pre-commit-config.yaml` (committed to repo) includes `gitleaks` secret scanning
- CI must run pre-commit checks on all PRs

### 4. GitHub Push Protection

- GitHub push protection (`secret_scanning_push_protection`) enabled on the repository
- If alert fires: stop, rotate immediately, resolve as "revoked" in GitHub

### 5. Service-Role Key Policy

- Service-role keys bypass Row Level Security — highest-value credential
- **Server-side only** (FastAPI, GitHub Actions, Vercel env vars) — never `NEXT_PUBLIC_`
- **Rotate immediately on any confirmed or suspected leak**
- After rotation: update Vercel, GitHub Actions, and local `.env.local` files

### 6. Anon Key Policy

- Anon keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) are intentionally public in browser bundle
- Restricted by RLS policies, not by secrecy
- Rotate only if Supabase project domain compromised or force re-authentication desired
- Do NOT rotate anon keys for a service-role leak unless security team advises

### 7. Rotation Response Checklist

When a high-value secret leaks:

1. Rotate in upstream service immediately (Supabase Dashboard, Google Cloud, etc.)
2. Update all deployment targets (Vercel, GitHub Actions, CI secrets)
3. Redact the value from tracked files in a hotfix PR
4. File incident report in `docs/security/incident-YYYY-MM-DD-<slug>.md`
5. Post-rotation: verify old key returns 401, new key works
6. Confirm GitHub secret-scanning alert is resolved

### 8. History Rewrite Policy

- **Do not rewrite git history** for rotated JWT credentials unless:
  - Credential cannot be rotated (e.g., static password in migration SQL), OR
  - Forensic evidence shows unauthorized use
- For most leaks: rotate → redact → document. Redaction PR is sufficient.
- If history rewrite needed: use `git-filter-repo` (not BFG) and coordinate team re-clone

## Examples

**Correct .env.local pattern:**
```
SUPABASE_SERVICE_ROLE_KEY=<actual-rotated-key>
SUPABASE_JWT_SECRET=<actual-local-hs256-secret>
```

**Correct .env.example pattern:**
```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SUPABASE_JWT_SECRET=your-jwt-secret-here
```

**Correct documentation reference:**
```markdown
Set `$SUPABASE_SERVICE_ROLE_KEY` in `.env.local` before deploying.
The service-role key is required for backend admin operations.
```

**Incident response workflow:**
1. Detect leak via CI alert
2. Run `supabase projects api-keys update --service-role --new-key`
3. Update Vercel: `vercel env pull` + edit `SUPABASE_SERVICE_ROLE_KEY` + `vercel env push`
4. Update GitHub Actions secrets
5. Create hotfix PR with redacted decision entry
6. Document in `docs/security/incident-2026-05-03.md`

## Anti-Patterns

- ❌ Storing secrets in `.env` (gets committed)
- ❌ Storing secrets in Session logs or decision documents (gets merged to shared files)
- ❌ Using `NEXT_PUBLIC_` prefix for service-role keys (leaked to browser bundle)
- ❌ Rewriting history for every rotated credential (creates rebase burden)
- ❌ Skipping pre-commit setup (manual scanning is unreliable)
- ❌ Rotating anon keys when service-role leaks (unnecessary and breaks user sessions)
