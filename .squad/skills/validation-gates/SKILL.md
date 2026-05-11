# Validation Gates — LURVG Playbook

**Established by:** Ralph (Coordinator), 2026-05-11
**Operationalized by:** Redfoot (Tester), 2026-05-11
**Rule source:** `.squad/decisions/inbox/ralph-validation-reflection-2026-05-11.md`

---

## What is LURVG?

**Live-URL Validation Gate (LURVG)** — the closure standard for any UI ticket.

> *"If you didn't load the URL the user will load, you didn't validate."*

Unit tests and build success are **necessary but not sufficient**. The validator **must** load the deployed or locally-served URL and assert user-visible behavior.

---

## Who Can Validate?

- The **implementer cannot self-validate** — Reviewer Rejection Lockout applies.
- **Redfoot (Tester)** is the first-eligible validator for UI issues.
- If Redfoot is also an implementer on a ticket, escalate to Ralph to assign a different validator.

---

## Closure Checklist

For each UI issue closed via LURVG, the closing comment MUST include:

1. ✅ **Deployment SHA verified** — confirm live/local code is at or past the fix commit
2. ✅ **Tab count / DOM assertion** — actual outerHTML snippet or screenshot showing element count
3. ✅ **`data-testid` presence** — confirm each expected testid exists in the rendered DOM
4. ✅ **Form save** (for forms only) — assert success banner, no error banner
5. ✅ **Empty-state CTA** (if applicable) — confirm graceful empty state renders
6. ✅ **Signed by validator** — `Validated by {name} ({role}) per LURVG rule. Commit {sha}.`

---

## Validation Paths (in order of preference)

### Path 1 — Live Vercel URL with SSO bypass

```bash
cd /project/root
vercel env pull .env.vercel-prod --environment=production --yes
grep -i "BYPASS\|VERCEL_AUTOMATION" .env.vercel-prod
```

If `VERCEL_AUTOMATION_BYPASS_SECRET` found:
- Append `?x-vercel-protection-bypass=<value>&x-vercel-set-bypass-cookie=true` to URLs in Playwright `baseURL`.
- Or set as cookie: `x-vercel-protection-bypass`.

**Note:** `vercel env pull` returns **empty strings** for sensitive vars (Vercel encrypts them). The bypass secret may not appear. If not found, proceed to Path 2.

---

### Path 2 — Local Production Build (recommended fallback)

```bash
# 1. Confirm build exists or build:
ls apps/frontend/.next/ || (cd apps/frontend && npm run build)

# 2. Start local server (binds :3000):
cd apps/frontend && npm run start
# Verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ → 307 (auth redirect = alive)

# 3. Run LURVG spec:
SUPABASE_E2E_ALLOW_PROD=true \
  npx playwright test e2e/lurvg-{ticket}.spec.ts \
  --project=chromium --reporter=list
```

**Auth setup for Playwright (this project):**
- `SUPABASE_SERVICE_ROLE_KEY` lives in `apps/frontend/.env.local` — already available to the playwright config
- Use `e2e/fixtures/auth-cookie.ts` fixture — creates ephemeral test user, injects `sb-{ref}-auth-token` cookie
- The `assertNotProd` guard in `e2e/fixtures/admin.ts` blocks on the production Supabase URL — **always set `SUPABASE_E2E_ALLOW_PROD=true`**
- Do NOT rely on `account-tabs.spec.ts` or other specs without auth — they silently fail on protected routes. Create a **separate LURVG spec** (`e2e/lurvg-{sha}.spec.ts`) that wraps assertions with the auth fixture

**LURVG spec template:**
```typescript
import { test as authTest, expect } from './fixtures/auth-cookie';
import path from 'path';
import fs from 'fs';

const EVIDENCE_DIR = path.join(__dirname, 'lurvg-evidence');
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

authTest('page renders expected elements', async ({ authenticatedUser }) => {
  const { page } = authenticatedUser;
  await page.goto('/target-path');
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('my-testid')).toBeVisible();

  // Capture DOM evidence
  const html = await page.locator('[data-testid="my-testid"]')
    .evaluate(el => el.parentElement?.outerHTML ?? el.outerHTML);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dom-evidence.txt'), html);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot.png'), fullPage: true });
});
```

---

### Path 3 — Curl + DOM inspect (last resort)

If Playwright auth consistently fails:
```bash
# Requires authenticated session cookies (ask Jony to share browser cookies)
curl --cookie "sb-{ref}-auth-token=base64-..." \
  https://trading-journal-cohenjos-projects.vercel.app/trading/accounts \
  | grep 'data-testid="tab-ibkr"'
```

Lower fidelity — use only when Paths 1 and 2 are blocked.

---

## Evidence Storage

- Screenshots and DOM dumps: `apps/frontend/e2e/lurvg-evidence/`
- Drop-box note: `.squad/decisions/inbox/redfoot-lurvg-{sha}.md`
- Append learnings to: `.squad/agents/redfoot/history.md` → `## Learnings` section

---

## GitHub Operations

```bash
# ALWAYS switch to cohenjo before writes:
gh auth switch -u cohenjo

# Post evidence comment:
gh issue comment <N> --body-file comment-N.md

# Close with reason:
gh issue close <N> --reason completed

# Close order for Sprint B pattern: #361 → #360 → #362 → #354 → #355
```

---

## Known Gotchas

| Gotcha | Mitigation |
|--------|-----------|
| `vercel env pull` returns empty strings for sensitive vars | Use `apps/frontend/.env.local` directly |
| `assertNotProd` blocks on prod Supabase URL | Set `SUPABASE_E2E_ALLOW_PROD=true` |
| `deleteE2eUser` fails with "Database error deleting user" | Non-critical — tests still pass; ignore |
| Spec without auth fixture silently fails on protected routes | Always wrap with `auth-cookie` in LURVG spec |
| EMU GitHub account (`jocohe_microsoft`) returns 403 on writes | Always `gh auth switch -u cohenjo` first |

---

## Reference

- LURVG rule: `.squad/decisions/inbox/ralph-validation-reflection-2026-05-11.md`
- First application: `.squad/decisions/inbox/redfoot-lurvg-cf2fd19.md` (Sprint B, commit cf2fd19)
- Auth fixture: `apps/frontend/e2e/fixtures/auth-cookie.ts`
