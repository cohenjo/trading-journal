# Redfoot — Active History

> **Last summarized:** 2026-05-13 (removed 188 older entries to archive)
> **Current size:** 25330 bytes

---

**Step 1 — Check deployment SHA:**
```bash
vercel inspect https://<alias>.vercel.app | grep -i sha
# or: git log --oneline -3 && vercel ls | head -5
```

**Step 2 — Try bypass secret (Path 1):**
```bash
cd /project/root && vercel env pull .env.vercel-prod --environment=production --yes
grep -i "BYPASS\|VERCEL_AUTOMATION" .env.vercel-prod
```
If found, append `?x-vercel-protection-bypass=<value>&x-vercel-set-bypass-cookie=true` to URLs.

**Step 3 — Local prod build if no bypass (Path 2):**
```bash
# Keys are in apps/frontend/.env.local — SUPABASE_SERVICE_ROLE_KEY is present
# Build may already exist; if not: cd apps/frontend && npm run build
cd apps/frontend && npm run start &
# Server listens on :3000 and enforces auth (307 redirects for unauthenticated)
```

**Step 4 — Auth for Playwright:**
- `SUPABASE_SERVICE_ROLE_KEY` lives in `apps/frontend/.env.local` (checked after filtering)
- Use `e2e/fixtures/auth-cookie.ts` fixture → creates ephemeral E2E user, injects `sb-{ref}-auth-token` cookie
- Must set `SUPABASE_E2E_ALLOW_PROD=true` (production Supabase URL fails the dev-hint check)

**Step 5 — Run:**
```bash
SUPABASE_E2E_ALLOW_PROD=true npx playwright test e2e/lurvg-cf2fd19.spec.ts \
  --project=chromium --reporter=list
```

**Step 6 — Evidence:**
- Save DOM snapshots (`page.locator(...).evaluate(el => el.outerHTML)`) to `e2e/lurvg-evidence/`
- Screenshots with `page.screenshot({ path: ..., fullPage: true })`

**Step 7 — Post to issues + close:**
```bash
gh auth switch -u cohenjo   # ALWAYS switch before writes
gh issue comment <N> --body-file comment-N.md
gh issue close <N> --reason completed
```

**Gotchas:**
- `vercel env pull` returns EMPTY strings for sensitive vars — don't rely on it for secrets
- The `assertNotProd` guard in `e2e/fixtures/admin.ts` blocks on `zvbwgxdgxwgduhhzdwjj.supabase.co` — bypass with `SUPABASE_E2E_ALLOW_PROD=true`
- Test user cleanup (`deleteE2eUser`) may fail with "Database error deleting user" — this is non-critical; tests still pass
- `account-tabs.spec.ts` (Fenster's spec) has no auth — tests will silently fail on protected routes unless wrapped with `auth-cookie` fixture. Create a separate LURVG spec file rather than modifying the original.

**Drop-box note:** `.squad/decisions/inbox/redfoot-lurvg-cf2fd19.md`
