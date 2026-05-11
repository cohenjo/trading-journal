---
name: Next.js 15 Server Actions — async-only rule
date: 2026-05-11
genesis: Commit 9a438a2 (detectPaymentFrequency extraction)
tags: [next.js, rsc, server-actions, typescript]
---

# Next.js 15 Server Actions — Async-Only Export Rule

## Rule

In Next.js 15, **every exported symbol in a `'use server'` file must be an async function.**

Synchronous utility functions—pure helpers with no I/O—**must never be exported directly from `'use server'` modules** (`actions.ts`, `api.ts`, etc.).

## Why

Next.js RSC (React Server Components) compilation enforces that Server Actions (functions that run on the backend and can be called from the client) are async. Webpack/RSC rejects synchronous exports from `'use server'` files with error:

```
Error: Server Actions must be async functions.
  export function detectPaymentFrequency(dates: string[]): PaymentFrequency
```

## Solution

Move synchronous utilities to a **plain module** under `src/lib/…` (no `'use server'` directive), then import them back into the actions file for internal use.

```typescript
// ❌ WRONG: src/app/dividends/actions.ts
'use server';

export function detectPaymentFrequency(dates: string[]): PaymentFrequency {
  // ...
}

// ✅ CORRECT: src/lib/dividends/payment-frequency.ts (no 'use server')
export function detectPaymentFrequency(dates: string[]): PaymentFrequency {
  // ...
}

// Then in actions.ts:
'use server';

import { detectPaymentFrequency } from '@/lib/dividends/payment-frequency';

// Use internally, but do not re-export
const freq = detectPaymentFrequency(dates);
```

## Evidence

- **Commit:** `9a438a2` — extracted `detectPaymentFrequency` from `apps/frontend/src/app/dividends/actions.ts` to `apps/frontend/src/lib/dividends/payment-frequency.ts`
- **Build result:** ✅ `npm run build` succeeded; no webpack/RSC errors
- **Test result:** 471/471 tests pass
- **Vercel preview:** ● Ready

## Recommendation

Apply this pattern consistently:
- Audit all `actions.ts` / `api.ts` files for synchronous exports
- Move them to `src/lib/` equivalents
- Update imports in test files to reference the new paths
