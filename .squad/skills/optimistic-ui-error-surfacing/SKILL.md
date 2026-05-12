# Skill: Optimistic UI Error Surfacing

**Author:** Fenster (Frontend Dev)
**Created:** 2026-05-13
**Related PR:** #443

---

## Problem

Optimistic UI patterns update local state immediately before a server call completes, giving users instant feedback. But when the server action returns `{ ok: false }`, the standard pattern silently leaves the stale optimistic state in place. Users see phantom "saved" data that disappears on next page load, with no indication anything went wrong.

This is especially dangerous for financial data where silent failures masquerade as successful saves.

---

## Pattern

Always capture `previousState` before the optimistic write, then rollback + toast on failure:

```ts
const handleUpdate = async (newData: T) => {
  if (!entity) return;

  // 1. Capture snapshot before optimistic write
  const previousEntity = entity;

  // 2. Apply optimistic update immediately
  setEntity({ ...entity, data: newData });

  // 3. Call server action
  const result = await serverAction(entity.id, { data: newData });

  if (result.ok) {
    // Confirm with server-returned value (may differ from optimistic)
    setEntity(result.entity);
  } else {
    // 4. Rollback + surface error
    setEntity(previousEntity);
    const message = result.error ?? 'Save failed. Please try again.';
    console.error('[context] action failed:', message);
    toast.error('Not saved', { description: message });
  }
};
```

---

## Toast Setup (sonner)

This project uses **sonner** for toasts. Ensure `<Toaster>` is mounted in the root layout:

```tsx
// apps/frontend/src/app/layout.tsx
import { Toaster } from 'sonner';

// Inside <body>:
<Toaster theme="dark" position="bottom-right" richColors />
```

Usage in any client component:

```ts
import { toast } from 'sonner';

toast.error('Plan not saved', { description: result.error });
toast.success('Plan saved');
```

---

## Checklist

- [ ] Capture `previousState` before the optimistic `setState` call
- [ ] On `result.ok === false`: call `setState(previousState)` to rollback
- [ ] Call `console.error('[scope] action:', message)` for devtools visibility
- [ ] Show `toast.error(title, { description: message })` for user visibility
- [ ] Use `result.error` as the description when the server action provides it

---

## Applied In

- `apps/frontend/src/app/plan/page.tsx` — `handleUpdatePlanData` (PR #443)
