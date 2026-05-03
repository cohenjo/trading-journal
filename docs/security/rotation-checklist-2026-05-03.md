# Supabase Key Rotation Runbook — 2026-05-03

**Incident:** GitHub secret-scanning alert #1 — service-role key (and anon key) for project
`zvbwgxdgxwgduhhzdwjj` found in git-tracked file `.squad/decisions.md`.

**Initiated by:** Jony (owner)  
**Prepared by:** Hockney (Backend Dev)  
**Parallel tracks:** Rabin (audit) · Kujan (`.gitignore` / pre-commit hardening)  
**Status:** ⏳ Awaiting manual rotation by Jony in Supabase Dashboard

---

## 1. Scope

| Project | Ref | Environment | Action required |
|---------|-----|-------------|-----------------|
| trading-journal (prod) | `zvbwgxdgxwgduhhzdwjj` | Production | **Rotate service-role key** |

> **Finding:** Only **one** Supabase project is visible to the MCP server. No separate
> dev/staging project was found. If a second project exists outside the MCP configuration,
> Jony must rotate it manually using the same steps below.

---

## 2. Leaked Credentials — Flagged for Rabin

The following **real credential values** were found in the git-tracked file
`.squad/decisions.md` (confirmed by `git ls-files` scan). Rabin to decide whether
git-history rewrite is warranted.

| Variable | File | Status |
|----------|------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | `.squad/decisions.md` | 🔴 **Must rotate immediately** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.squad/decisions.md` | 🟡 Anon key — public-by-design (see §3) |

> **All other tracked `.env.example` files** (`.env.example`, `apps/backend/.env.example`,
> `apps/frontend/.env.local.example`) contain only placeholder values — no live credentials.

---

## 3. Key Rotation Decision Guide

### Service-role key — MUST rotate

The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely. A leaked
service-role key grants full read/write access to all tables as a superuser.
**Rotate it immediately.**

### Anon key — rotate only if domain is compromised

The `NEXT_PUBLIC_SUPABASE_ANON_KEY` is intentionally public — it is embedded in the
browser bundle and restricted by RLS policies. Rotation is only necessary if:

- The Supabase project domain itself was somehow compromised, **or**
- You want to invalidate all existing anonymous sessions as a precaution.

**Recommended:** Do NOT rotate the anon key unless advised by Rabin. Rotating it will
invalidate all existing user sessions and require updating every deployment.

---

## 4. Jony's Manual Steps — Supabase Dashboard

### 4a. Rotate the service-role key

1. Open [Supabase Dashboard → Project `zvbwgxdgxwgduhhzdwjj` → Settings → API](https://supabase.com/dashboard/project/zvbwgxdgxwgduhhzdwjj/settings/api).
2. Scroll to **"Service role secret"**.
3. Click **"Generate new secret"** (or **"Rotate"** — label varies by dashboard version).
4. ⚠️ The old key is **invalidated immediately** upon generation.
5. Copy the new key (it is shown only once — store it in your password manager immediately).
6. Do **not** paste it into any file that is or could be tracked by git.

### 4b. (Conditional) Rotate the anon key

Only if Rabin recommends it:

1. Same page: **"Anon/public key"** → **"Generate new secret"** / **"Rotate"**.
2. Copy the new anon key.
3. The new value must go everywhere the old one was used (see §5 and §6).

---

## 5. Vercel Environment Variables to Update

After rotation, Jony must update Vercel before the next production deployment.

**Access:** [Vercel Dashboard → Project → Settings → Environment Variables](https://vercel.com/dashboard)
(or `vercel env add <KEY> production` if CLI is authenticated).

| Variable | Targets to update | Notes |
|----------|-------------------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview | **Always required** — server-only, never `NEXT_PUBLIC_` prefix |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview + Development | **Only if anon key was also rotated** |

> **Reminder from Vercel runbook (2026-05-01):** `SUPABASE_SERVICE_ROLE_KEY` must never
> carry the `NEXT_PUBLIC_` prefix. It is consumed exclusively by Next.js Server Actions
> and backend workers; exposing it to the browser bundle would bypass RLS.

---

## 6. Local `.env.local` Update

After rotating, Jony must update the local development file:

```
apps/frontend/.env.local
```

1. Open the file (it is **gitignored** — confirmed in both `.gitignore` and `apps/frontend/.gitignore`).
2. Replace the value of `SUPABASE_SERVICE_ROLE_KEY` with the new key.
3. If the anon key was also rotated, replace `NEXT_PUBLIC_SUPABASE_ANON_KEY` as well.
4. Restart the local dev server (`npm run dev`) to pick up the new values.

> ✅ **Gitignore verified:** Root `.gitignore` pattern `.env.*` (with `!.env.example` exclusion)
> and `apps/frontend/.gitignore` pattern `.env*` (with `!.env*.example` exclusion) both
> correctly exclude `.env.local` from tracking.

---

## 7. CI/CD — GitHub Actions Secrets

The Playwright E2E workflow (`.github/workflows/playwright-e2e.yml`) uses
`SUPABASE_SERVICE_ROLE_KEY` as a repository secret.

1. Go to: **GitHub → Repository → Settings → Secrets and variables → Actions**.
2. Update the secret `SUPABASE_SERVICE_ROLE_KEY` with the new value.
3. If anon key was rotated: also update `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 8. Post-Rotation Smoke Tests

Run these **after** Jony has completed the rotation and updated all deployments.

### 8a. Verify old key is revoked

```bash
OLD_KEY="<the rotated key — do NOT paste here>"
PROJECT="zvbwgxdgxwgduhhzdwjj"

curl -s -o /dev/null -w "%{http_code}" \
  "https://${PROJECT}.supabase.co/rest/v1/" \
  -H "apikey: ${OLD_KEY}" \
  -H "Authorization: Bearer ${OLD_KEY}"
# Expected: 401
```

### 8b. Verify new key works

```bash
NEW_KEY="<new key from password manager>"

curl -s -o /dev/null -w "%{http_code}" \
  "https://${PROJECT}.supabase.co/rest/v1/" \
  -H "apikey: ${NEW_KEY}" \
  -H "Authorization: Bearer ${NEW_KEY}"
# Expected: 200
```

### 8c. Application-level smoke test

1. Open the deployed app (production Vercel URL).
2. Log in as a test user.
3. Navigate to `/current-finances`.
4. Add a test fund entry.
5. Confirm the entry is saved and visible.

**Current smoke test status:** `NOT_RUN` — awaiting Jony's rotation.

---

## 9. Cleanup Checklist (Rabin / Kujan tracks)

- [ ] **Rabin:** Determine if `.squad/decisions.md` git-history rewrite is needed.
  If so, use `git filter-repo` or BFG — coordinate with team before force-push.
- [ ] **Rabin:** Confirm GitHub secret-scanning alert #1 is resolved / closed after rotation.
- [ ] **Kujan:** Verify `.gitignore` + pre-commit hook changes prevent future leaks.
- [ ] **Hockney (done):** Confirmed all `.env.example` files contain only placeholder values.
- [ ] **Jony:** Rotate service-role key in Supabase Dashboard (§4a).
- [ ] **Jony:** Update Vercel env vars (§5).
- [ ] **Jony:** Update `apps/frontend/.env.local` (§6).
- [ ] **Jony:** Update GitHub Actions secret (§7).
- [ ] **Jony:** Run smoke tests (§8).

---

## 10. Reference

- Supabase project: <https://supabase.com/dashboard/project/zvbwgxdgxwgduhhzdwjj>
- Supabase project URL: `https://zvbwgxdgxwgduhhzdwjj.supabase.co`
- Existing env-var documentation: `docs/design-hosting/operations/secrets-and-env-vars.md`
- Vercel runbook: `docs/design-hosting/runbooks/vercel-04-project-link-and-env.md`
