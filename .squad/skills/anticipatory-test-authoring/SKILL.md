---
name: "anticipatory-test-authoring"
description: "Write test scenarios from bug reports before any fix exists — guides implementation and becomes the regression net"
domain: "testing, quality, process"
confidence: "high"
source: "earned — applied to /plan persistence + /cash-flow bugs 2026-05-13"
---

## Context

When two or more squad members are fixing bugs in parallel, the QA agent can write test scenarios **from the bug report alone** — before any code is changed. This approach:

1. **Guides Round 2 implementation** — implementers know exactly what observable behavior they must produce.
2. **Becomes the Round 3 regression net** — test authors in Round 3 translate scenarios into Playwright/vitest code without needing to understand the fix internals.
3. **Decouples QA from implementation** — scenarios describe _what the user observes_, not _how the code achieves it_.

Apply this pattern when: a bug report is specific enough to define observable end-states, two or more squad members are working in parallel on diagnosis + fix, and Round 3 implementation is planned.

---

## Patterns

### 1. Derive observable outcomes from the bug description

Read the bug report for two things:
- **Expected behavior** (what _should_ happen) → becomes the `Assert:` step.
- **Actual behavior** (what _is_ happening) → the scenario's precondition reproduces it.

Example from the `/plan` persistence bug:
> "I added salary incomes and expenses — and it didn't persist."

Observable outcome: _after reload, the item is gone_. Test scenario: add item → reload → assert item is present.

### 2. Organize by user flow, not by code layer

Group scenarios into flows (A, B, ...) corresponding to user-facing routes or journeys — not by component, server action, or DB table. This keeps scenarios implementation-agnostic and understandable by non-engineers.

### 3. Write one scenario per failure mode

Each scenario should catch exactly one class of bug:
- **A1** — new item not saved (create path)
- **A3** — edit not saved (update path)
- **A4** — delete not saved (delete path)
- **A5** — RLS isolation failure (auth boundary)
- **B7** — currency unit inflation (÷100 guard)

Don't merge failure modes into one scenario — they have different root causes and different fix paths.

### 4. Explicitly mark unknowns with `test.fixme`

When a scenario depends on an implementation decision that hasn't been made yet (e.g., "where is the source of truth for income streams?"), mark it `test.fixme` with a precise note explaining what needs to be decided before the test can be implemented.

```typescript
test.fixme('A6 — income streams appear on /plan', async () => {
  // FIXME: Blocked until income-stream contract is decided:
  // (a) live pull from server actions, (b) copied into plan.data.items,
  // or (c) referenced by type. See mcmanus-plan-cashflow-tests.md §A6.
});
```

### 5. Include the "working theory" causal chain

When the user reports two bugs and suspects they are related, document the causal hypothesis in the test plan. This helps implementers verify whether fixing bug #2 also fixes bug #1, or whether both need independent fixes.

Example:
> `/cash-flow` is empty because `CashFlowPage` calls `getLatestPlan()`. If the plan has no persisted items (bug #2), the simulation produces no flow, so the Sankey is empty (bug #1).

### 6. Map scenarios to existing file locations

Check for existing test files first. Extending existing files (e.g., `tests/cash-flow.spec.ts`, `e2e/flows/plan.spec.ts`) is cheaper and more maintainable than creating new ones for every scenario. New files are warranted only for new flows (e.g., `plan-persistence.spec.ts`, `plan-rls.spec.ts`).

### 7. Include data prerequisites

For each scenario, specify the exact seed data required:
- Amount and currency (prevents ILA/GBp unit ambiguity)
- Table and column (so seed helpers know where to write)
- Realistic values (similar to production data; catches scale-related bugs)

### 8. Flag currency unit risks explicitly

Financial applications carry a recurring risk: sub-unit / major-unit confusion (ILA vs ILS, pence vs GBP). When a scenario touches monetary display, add a note referencing the established unit contract (e.g., "market_value is stored in ILS per PR #410 contract — do not divide by 100 in the UI").

---

## Examples

### Scenario template

```
**A1 — [Descriptive name]**
1. [Setup — auth, seed, navigate]
2. [Action — what the user does]
3. Assert: [observable outcome — DOM, network, value]
4. [Reload or repeat action]
5. Assert: [persisted outcome — proves it wasn't just local state]
> **Implementation note:** [optional — risk, known behavior, fixme trigger]
```

### Test implementation (Round 3)

```typescript
testWithUser('A1 — Add salary income, reload, see salary @plan-persistence @regression', async ({
  testUser: { page, householdId },
}) => {
  await page.goto('/plan');
  await page.getByRole('button', { name: /add income/i }).click();
  await page.getByLabel(/name/i).fill('Salary');
  await page.getByLabel(/amount/i).fill('30000');
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText('Salary')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Salary')).toBeVisible();
});
```

---

## Anti-Patterns

- **Don't write test code in the scenario document** — scenarios describe behavior, not implementation. Round 3 translates to code; Round 2 (fix) may change selectors.
- **Don't merge too many assertions into one scenario** — one scenario = one failure mode. Compound scenarios hide which invariant is broken.
- **Don't rely on implementation details for assertions** — test what the user sees (DOM, values, URLs), not what the DB contains or which function was called.
- **Don't defer all scenarios to "after the fix"** — the whole point of anticipatory authoring is to write them before. A scenario written after the fix exists is a documentation test, not a guard.
- **Don't skip the causal chain** — if two bugs are suspected to be linked, document the theory. It guides both the fix order and the test execution order.

---

## Round 3 implementation discipline — `test.fixme` best practices

Applied in PR #444 (squad/440-441-tests). When translating scenario documents to test code in a multi-PR parallel environment:

### test.fixme vs test.skip

| | `test.fixme` | `test.skip` |
|---|---|---|
| **Shows in CI output** | Yes — listed as "fixme" | Yes — listed as "skipped" |
| **Indicates intent** | "Will be fixed" | "Not applicable" |
| **Use when** | Test is correct; upstream code not ready | Test is not relevant to this env |

**Rule:** Always use `test.fixme` (not `test.skip`) for scenarios that depend on yet-to-land PRs. This keeps the test visible and prevents accidental permanent-skip.

### Mandatory TODO comment format

Every `test.fixme` must include:
1. What needs to happen before unfixme (PR name or issue number).
2. What contract decision is required (if blocked on architecture).
3. A specific action the next agent must take.

```typescript
// TODO: Unfixme after PR-C (Fenster P1 income-stream wiring) lands.
// The income-stream → plan contract must be resolved first (Keaton Decision 1 / issue #441).
// Action: grep for 'test.fixme' in this file, remove the fixme wrapper, re-run CI.
testWithUser.fixme('A6 — ...', async ({ testUser }) => { ... });
```

### PR discipline for known-red test suites

When opening a PR where tests are intentionally red (because they test behavior that upstream PRs haven't implemented yet):
1. Open as **DRAFT** — never merge red tests as non-draft without an explicit waiver.
2. Include a scenario-to-PR mapping table in the PR body (which tests go green after which PR).
3. State the unfixme follow-up plan explicitly.
4. Add a coordination note: "Ready to mark non-draft once PR-X and PR-Y merge."

### Seed data in `test.fixme` scenarios

Write the seed code fully even inside `test.fixme` blocks — the seed strategy (which DB tables, which columns) must be documented now while the context is fresh. The test runner will skip the body, but the code serves as a specification for Round 4.
