# Security Incident Report — Supabase Service-Role Key Leak

**Incident ID:** INC-2026-05-03-001
**Classification:** HIGH — Service-role key bypass of Row Level Security
**Severity:** P1
**Status:** ⏳ Rotation AWAITING Jony / Verification in progress
**Security Lead:** Rabin (Security Engineer)
**Parallel Tracks:** Hockney (rotation runbook), Kujan (`.gitignore` + pre-commit hardening)
**Report Date:** 2026-05-03

---

## 1. Executive Summary

A Supabase **service-role JWT** for project `zvbwgxdgxwgduhhzdwjj` was committed to the
repository in plaintext. The key appeared in `.squad/decisions.md` which is tracked in
`origin/main`. Because the service-role key bypasses all Row Level Security policies, any
actor with read access to the repository (or its git history) could have used it to read,
write, or delete all financial data in the Supabase project.

The leaked key has been **redacted from the current working-tree** in this PR. The key must
still be **rotated in the Supabase Dashboard** by Jony — redacting from the working tree
does not invalidate the key (it remains in git history and the key itself is still active
until rotated).

---

## 2. Timeline

| Time (UTC+3) | Event |
|---|---|
| 2026-05-01 01:52 | **LEAK INTRODUCED** — commit `5a75bd1` on local branch `squad/wave1-all-pages` hard-codes `SUPABASE_SERVICE_ROLE_KEY` in `apps/frontend/e2e/walkthrough/all-pages.spec.ts` and commits `.secrets/` credential files |
| 2026-05-01 08:58 | Commit `95d1fc6` merged to `main` — includes `.squad/decisions/inbox/` files containing the key in `export` shell snippets (propagated from session logs) |
| 2026-05-01 09:49 | Commit `7e2dbf2` on `main` — key persists in `.squad/decisions.md` |
| 2026-05-01 10:24 | Commit `51b90c0` on `main` — key persists |
| 2026-05-01 19:10 | Commit `1eabe0e` on `main` (Scribe merge) — key persists in `.squad/decisions.md` |
| 2026-05-02 12:54 | Commit `c3c38fa` on `main` — `origin/main` tip; key **still present** in `.squad/decisions.md` |
| 2026-05-03 (morning) | **DETECTED** — GitHub secret-scanning alert #1 fires |
| 2026-05-03 | **INVESTIGATION** — Rabin audit; Hockney rotation runbook; Kujan pre-commit hardening |
| 2026-05-03 | **REDACTION** — Key values replaced with `REDACTED-ROTATED-2026-05-03` in `.squad/decisions.md` (this PR) |
| 2026-05-03 | ⏳ **ROTATION** — Awaiting Jony to rotate key in Supabase Dashboard |
| TBD | **VERIFICATION** — Confirm old key returns 401, new key works |

---

## 3. Affected Secrets

### 3.1 Confirmed Leaked (on `origin/main`)

| Secret | Type | Project | File | Risk Level |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase JWT (service_role) | `zvbwgxdgxwgduhhzdwjj` | `.squad/decisions.md` | 🔴 **CRITICAL** — bypasses RLS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase JWT (anon) | `zvbwgxdgxwgduhhzdwjj` | `.squad/decisions.md` | 🟡 Low — intentionally public, RLS enforced |

### 3.2 Additional Secrets (local branch `squad/wave1-all-pages` only — NOT pushed to remote)

| Secret | Type | File | Status |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (same) | Service-role JWT | `apps/frontend/e2e/walkthrough/all-pages.spec.ts` | Local branch only; rotate regardless |
| Google OAuth client_secret (dev) | `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` | `.secrets/google-oauth-client-supabase-dev.json` | Local branch only; **rotate Google OAuth dev client** |
| Google OAuth client_secret (prod) | `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` | `.secrets/google-oauth-client-supabase-prod.json` | Local branch only; **rotate Google OAuth prod client** |
| Vercel 2FA recovery codes | One-time codes | `.secrets/vercel-recovery-codes.txt` | Local branch only; **treat as consumed** |
| E2E test user password | `TestPass123!Redfoot2026` | `.secrets/test-user-redfoot.txt` | Still tracked in HEAD; **change test user password** |

### 3.3 Supabase Project Refs Exposed

| Ref | Environment | In public history? |
|---|---|---|
| `zvbwgxdgxwgduhhzdwjj` | Dev/current | ✅ Yes — in multiple commits on `main` |
| `jaesiklybkbmzpgipvea` | Prod | ✅ Yes — referenced in `.secrets/README.md` and migration logs |

> ℹ️ Project refs alone are not secrets (they appear in API URLs), but the combination of
> project ref + service-role key is a full compromise vector.

---

## 4. Root Cause Analysis

1. **Immediate cause:** Session logs and `export` shell snippets from E2E debugging sessions
   were pasted into `.squad/decisions/inbox/` markdown files and committed. The Scribe
   agent merged those inbox files into `.squad/decisions.md` without sanitizing secret values.

2. **Contributing cause:** The `.secrets/` directory (containing Google OAuth JSON files,
   Vercel recovery codes, and test credentials) was committed in the `squad/wave1-all-pages`
   branch. The `.gitignore` entry `**/secrets/**` does NOT match `.secrets/` (leading dot
   prevents glob match). The directory was later un-tracked, but the data persists in history.

3. **Systemic cause:** No pre-commit secret-scanning hook was in place. GitHub push
   protection was not confirmed enabled. No policy explicitly prohibited inlining live
   credentials in documentation/log files.

---

## 5. Files and Commits Involved

### Files containing live secrets in `origin/main` history:

| File | Introduced in | Secret type |
|---|---|---|
| `.squad/decisions.md` | Scribe merge (`1eabe0e`, `51b90c0`) | Service-role key, anon key |
| `.squad/decisions/inbox/coord-auth-fixture-rebuilt.md` | `95d1fc6` | Service-role key (export snippet) |
| `.squad/decisions/inbox/tester-walkthrough-v2-blocked.md` | `95d1fc6` | Service-role key (export snippet) |

### Files containing secrets in LOCAL-ONLY branch `squad/wave1-all-pages` (NOT on remote):

| File | Secret |
|---|---|
| `apps/frontend/e2e/walkthrough/all-pages.spec.ts` | Service-role key hardcoded |
| `.secrets/google-oauth-client-supabase-dev.json` | Google OAuth client secret (dev) |
| `.secrets/google-oauth-client-supabase-prod.json` | Google OAuth client secret (prod) |
| `.secrets/vercel-recovery-codes.txt` | Vercel 2FA recovery codes |
| `.secrets/test-user-redfoot.txt` | Test user email + password |

---

## 6. Remediation Actions

### 6.1 Immediate (This PR)

- [x] **Rabin:** Redact service-role key and anon key from `.squad/decisions.md` (replaced with `REDACTED-ROTATED-2026-05-03`)
- [x] **Kujan:** Add `detect-secrets` / `gitleaks` pre-commit hook (`.pre-commit-config.yaml`)
- [x] **Hockney:** Create rotation runbook `docs/security/rotation-checklist-2026-05-03.md`
- [x] **Rabin:** Add `.secrets/` to `.gitignore` (covers leading-dot variant)
- [x] **Rabin:** `git rm --cached .secrets/test-user-redfoot.txt` (untrack still-tracked secrets file)

### 6.2 Manual — Jony (URGENT, blocks verification)

- [ ] **Rotate Supabase service-role key** for project `zvbwgxdgxwgduhhzdwjj`:
  - Supabase Dashboard → Project `zvbwgxdgxwgduhhzdwjj` → Settings → API → Reset service_role key
  - Update `apps/frontend/.env.local` with new key
  - Update Vercel environment variable `SUPABASE_SERVICE_ROLE_KEY`
  - Update GitHub Actions secret `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **Rotate Google OAuth client secret (dev)** — Google Cloud Console → Credentials → `64115705388-dhc38891gfpk28s54r6qb6gt81fpoi8h` → Regenerate secret
- [ ] **Rotate Google OAuth client secret (prod)** — Google Cloud Console → Credentials → `64115705388-efhqqjbd9ub7p3j28jsi2c3bkootjlng` → Regenerate secret
- [ ] **Change E2E test user password** — Supabase Dashboard → Auth → Users → `redfoot-test@example.com` → Reset password
- [ ] **Treat Vercel recovery codes as consumed** — generate new codes in Vercel settings
- [ ] **Optionally rotate anon key** if you want to invalidate all existing sessions (not required by default)

### 6.3 Post-Rotation Verification

- [ ] Run smoke test with old service-role key → expect **401 Unauthorized**
- [ ] Run smoke test with new service-role key → expect **200 OK**
- [ ] Confirm GitHub secret-scanning alert #1 is closed/resolved
- [ ] Confirm no new alerts in `gh api repos/cohenjo/trading-journal/secret-scanning/alerts`

### 6.4 Systemic — Prevent Recurrence

- [ ] **Enable GitHub push protection** (see §7)
- [ ] **Install pre-commit hooks** on all developer machines: `pip install pre-commit && pre-commit install`
- [ ] **Squad agent guideline:** Never inline live credential values in session logs or inbox files. Use `<REDACTED>` or env-var placeholders in all documentation.
- [ ] **Rabin policy decision:** Filed at `.squad/decisions/inbox/rabin-secret-handling-policy.md`

---

## 7. Git History — Rewrite Decision

### Recommendation: **NO history rewrite at this time**

**Rationale:**
- The service-role key has been (or will be) rotated. A rotated key is cryptographically
  invalidated — any actor who copied it from git history before rotation cannot use it.
- Git history rewrite (BFG / `git filter-repo`) requires force-pushing to `main`, which
  invalidates all existing branch SHA pointers, breaks pending PRs, and carries operational
  risk for a personal/small-team project.
- The leaked key is a JWT (not a database password, not an SSH key). It cannot be reused
  once regenerated in Supabase.

**Condition for reconsideration:**
- If analysis reveals the key was used maliciously between leak date (2026-05-01) and
  rotation date (observe Supabase audit logs for any unexpected service_role activity).
- If a long-lived secret that cannot be easily rotated (e.g., database master password,
  private TLS certificate) is found in history.

**Evidence to review post-rotation:**
- Supabase Dashboard → Project → Logs → API logs — filter by service_role JWT, look for
  unexpected IP addresses or unusual table access between 2026-05-01 and rotation date.
- If no anomalies: confirm history rewrite is not required.

---

## 8. GitHub Push Protection Status

See task §5. Checked via `gh api repos/cohenjo/trading-journal --jq '.security_and_analysis'`.
Status captured in sign-off issue. If not enabled, Jony must enable via:
- GitHub → repo Settings → Code Security → Secret scanning → Push protection → Enable

---

## 9. Verification Checklist (Post-Rotation Sign-off)

```bash
# 1. Confirm old key is dead (use the REDACTED value from decisions.md to test)
curl -H "Authorization: Bearer <OLD_KEY>" \
     "https://zvbwgxdgxwgduhhzdwjj.supabase.co/rest/v1/households?select=id&limit=1" \
     -w "\nHTTP %{http_code}\n"
# Expected: HTTP 401

# 2. Confirm new key works
curl -H "Authorization: Bearer <NEW_SERVICE_ROLE_KEY>" \
     -H "apikey: <NEW_SERVICE_ROLE_KEY>" \
     "https://zvbwgxdgxwgduhhzdwjj.supabase.co/rest/v1/households?select=id&limit=1" \
     -w "\nHTTP %{http_code}\n"
# Expected: HTTP 200

# 3. Confirm no new secret scanning alerts
gh api repos/cohenjo/trading-journal/secret-scanning/alerts
# Expected: empty array [] or only resolved alerts
```

---

## 10. Lessons Learned

1. **Never paste live credentials into markdown documentation or session logs** — use
   `<REDACTED>` or `$VAR_NAME` placeholders even in private squad files.
2. **`.gitignore` glob patterns must account for leading-dot directories** — `**/secrets/**`
   does not match `.secrets/`. Always test with `git check-ignore -v`.
3. **Pre-commit secret scanning must be mandatory** — gitleaks/detect-secrets should
   block commits before they reach the repository.
4. **GitHub push protection is the last line of defense** — must be enabled on all repos
   containing infrastructure credentials.
5. **Squad session logs that reference env vars should use placeholders** — automated
   Scribe merges carry whatever text is in inbox files, including secrets.
