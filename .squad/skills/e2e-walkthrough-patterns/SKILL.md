---
name: "e2e-walkthrough-patterns"
description: "E2E test walkthrough specifications with assertions, smoke tags, CI integration, and error filtering"
domain: "testing, quality"
confidence: "high"
source: "merged from copilot-e2e-walkthrough-assertions inbox decision"
---

## Context

E2E walkthroughs are passive data-collection by default — they walk the app UI but don't validate correctness. This leads to silent regressions: a page loads but 404s a critical API, or logs unexpected errors undetected. This skill establishes a pattern where walkthroughs make explicit assertions and integrate into PR-blocking CI.

## Patterns

### 1. Assertion Strategy

- **HTTP status validation:** Assert `status < 500` on every page load
- **API error filtering:** Assert no unexpected 4xx/5xx on `/api/*` routes
- **Console error capture:** Assert no unexpected console errors (filter known noise)
- **Smoke tag marking:** Tag walkthrough tests `@smoke` so PR-blocking CI tier picks them up

### 2. Known Noise Allowlist

- Document acceptable noise patterns with issue references
  - Example: `/metrics/page-load` 401s (#125) — auth not required, expected
  - Example: `/api/plans/simulate` 404s (#173) — deprecated endpoint
- Filter noise by path pattern and status code, with comments linking tracking issues
- **Never suppress silently** — always explain why a particular error is acceptable

### 3. Walkthrough Scope

- All public pages in the app (typically 15-30 pages)
- Covers user journey from entry point through primary features
- Includes error boundaries and loading states where applicable
- Tests both authenticated and anonymous flows if app supports both

### 4. CI Integration

- Walkthrough is part of PR-blocking tier (runs on every PR)
- Separate from long-running full test suites (can be triggered manually)
- Pass/fail status visible in PR status checks
- Failure blocks merge until regression is understood and fixed or allowlisted

### 5. Artifact Location

- `apps/frontend/e2e/walkthrough/all-pages.spec.ts` or equivalent
- Colocated with other E2E tests for easy discovery
- Shared fixtures for auth, test user creation, and common assertions

## Examples

**Assertion pattern:**
```typescript
// Assert page loads without 5xx
expect(response.status()).toBeLessThan(500);

// Assert no API errors (with known-noise filter)
const apiErrors = await page.evaluate(() => {
  return (window as any).__apiErrors || [];
});
const unexpectedErrors = apiErrors.filter(e =>
  !KNOWN_NOISE.some(pattern => pattern.test(e.path))
);
expect(unexpectedErrors.length).toBe(0);

// Assert no console errors
const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
await page.goto('/path');
expect(consoleErrors.length).toBe(0);
```

**Known noise filter:**
```typescript
const KNOWN_NOISE = [
  { path: /\/metrics\/page-load/, status: 401, issue: '#125' },
  { path: /\/api\/plans\/simulate/, status: 404, issue: '#173' }
];

// In test:
const acceptable = (error) =>
  KNOWN_NOISE.some(n => n.path.test(error.path) && n.status === error.status);
const unexpectedErrors = apiErrors.filter(e => !acceptable(e));
```

**Smoke tag usage:**
```typescript
test('@smoke: home page loads', async () => {
  await page.goto('/');
  expect(page.status()).toBeLessThan(500);
});
```

## Anti-Patterns

- ❌ Walkthrough with no assertions (silent regressions)
- ❌ Suppressing errors without documenting why (hides real bugs)
- ❌ Writing `/tmp` files (forbidden in prod environments, test cleanup fails)
- ❌ Using only offline/local mocks (misses prod-specific issues)
- ❌ Skipping smoke tag (walkthrough doesn't run in PR CI, defeating the purpose)
- ❌ Overly broad noise filters (`filter: () => true` defeats walkthrough)

## Related Skills

- **playwright-e2e-strategy** — Full E2E testing framework, test users, fixtures
- **squad-conventions** — CI integration and PR workflow conventions
