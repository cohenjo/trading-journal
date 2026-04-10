### 2026-07-18: After I Leave page — design patterns
**By:** Fenster
**Category:** Frontend, UX

**What:** Built the "After I Leave" family financial guide page with PDF download capability.

**Design Decisions:**
1. **PDF light theme via CSS class toggle** — Instead of maintaining two separate component trees, the page adds a `pdf-light-mode` class to the content wrapper during PDF generation. An inline `<style>` block maps dark theme classes to light equivalents. This avoids Tailwind config changes and keeps the approach self-contained.
2. **html2pdf.js for PDF generation** — Chosen for its simplicity (wraps html2canvas + jsPDF). Type declarations added at `src/types/html2pdf.d.ts` since the package lacks TypeScript types.
3. **Demo insurance data pattern** — Insurance entries are hardcoded with `[DEMO]` markers since no insurance API exists yet. The `SummaryTable` component merges these with real finance data from `/api/finances/latest`.
4. **Navigation placement** — Added under a new "Family" section with divider, below Settings. Styled slightly muted (`text-slate-400` vs `text-slate-300`) to distinguish from core trading features.

**Impact:** Additive — no existing code modified except MainLayout nav links.
