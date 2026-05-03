# Decision: E2E CI — Playwright webServer + Build Step

**Date:** 2026-05-03
**Author:** Kujan (DevOps/Platform)
**Status:** Implemented — PR open

## Context

PRs #163 and #164 were failing the "E2E — Smoke + Auth (PR)" CI job with
`ERR_CONNECTION_REFUSED at http://localhost:3000`. Root cause: the
`E2E_BASE_URL` repo secret was not set, causing `BASE_URL` to be empty, and
Playwright's `baseURL` fell back to `http://localhost:3000`. The `webServer`
block in `playwright.config.ts` was commented out, so nothing was listening on
that port.

## Decision

1. **`apps/frontend/playwright.config.ts`** — Replace the commented-out
   `webServer` stub with a conditional block:
   - When `BASE_URL` is set (Vercel preview / staging URL) → `webServer` is
     `undefined`; Playwright hits the deployed app directly.
   - When `BASE_URL` is absent → `webServer` starts `npm run start` on
     port 3000, `timeout: 120_000`, `reuseExistingServer: !CI`.

2. **`.github/workflows/playwright-e2e.yml`** — Add a `Build Next.js` step
   (runs `npm run build` with the public Supabase env vars) immediately after
   `Install Playwright browsers` in all three jobs (`e2e-smoke`, `e2e-full`,
   `e2e-dispatch`). `next start` requires a `.next` build artefact; this step
   ensures it exists whether or not `BASE_URL` is configured.

## Consequences

- PRs without `E2E_BASE_URL` configured now self-host the app locally — no
  external dependency needed for smoke/auth tests.
- When `E2E_BASE_URL` is set to a Vercel preview URL, the build step is still
  executed (adds ~30–60 s) but the webServer is skipped; this is acceptable
  for now.
- Public env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
  must be present as secrets `E2E_SUPABASE_URL` / `E2E_SUPABASE_ANON_KEY` for
  Next.js to build and boot correctly. These are **non-secret** values but must
  be stored in repo secrets to be injected into CI.

## Follow-up

- Set `E2E_BASE_URL` to a stable staging URL when a permanent preview/staging
  deployment is established; this removes the local-build overhead from PRs.
- Re-push or re-run PRs #163 and #164 to pick up the fix from this branch.
