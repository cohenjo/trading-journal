# Decision: Lightweight i18n for After I Leave page

**Author:** Fenster (Frontend Dev)
**Date:** 2026-07-22
**Status:** Implemented

## Context

The "After I Leave" family financial guide page needed Hebrew translation with full RTL support. This is a single, content-heavy informational page (~600 lines) — not a multi-page SPA requiring global i18n.

## Decision

Used a **single typed translations file** (`components/AfterILeave/translations.ts`) instead of a framework like `next-intl` or `react-i18next`.

### Why not a framework?

- Only one page needs translation (no global routing, no locale detection needed)
- The page has ~200 translatable strings, all self-contained
- A typed `Record<Lang, T>` object gives full TypeScript safety with zero runtime cost
- Adding a framework would increase bundle size and introduce new dependencies for minimal gain
- PDF generation captures DOM as-is, so language at download time = PDF language — no special handling

### Pattern

- `Lang = 'en' | 'he'` type exported from translations file
- Page component uses `useState<Lang>('en')` with toggle button
- Content container gets `dir={lang === 'he' ? 'rtl' : 'ltr'}`
- CSS logical properties (`text-start`/`text-end`, `ms-2`/`me-2`) instead of physical (`text-left`/`text-right`, `ml-2`/`mr-2`)
- Monetary values and phone numbers forced to `dir="ltr"` in RTL mode

## Impact

- If more pages need translation in the future, consider migrating to `next-intl`
- The translations file pattern is easily extractable into a framework later
- Other pages should follow this same pattern if they only need bilingual support
