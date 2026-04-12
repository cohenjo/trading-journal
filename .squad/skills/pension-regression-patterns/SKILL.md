---
name: pension-regression-patterns
description: Regression pattern for pension dashboard work. Use when changing pension upload, dashboard aggregation, delete behavior, or chart rendering for multiple owners/products, especially when shared product names or empty projection/history anchors are involved.
---

# Pension Regression Patterns

## When to Use This Skill
- Pension uploads need stable identifiers across backend storage and frontend display.
- Multiple owners share the same pension product name.
- Delete logic must remove a pension from both current and historical views.
- Chart rendering can receive empty projections or accounts with no historical anchor.

## Recommended Workflow
1. Build or assert a stable pension identity that separates owner, product, and fund/account information.
2. Test backend payload extraction/upsert logic with at least four pensions: shared product for two owners plus one extra product per owner.
3. Verify dashboard aggregation only emits active/latest pensions and uses the stable series id in history/projection points.
4. Verify delete behavior removes the same pension identity from plan data and every relevant historical snapshot.
5. In the frontend, test the table with shared product names and confirm delete callbacks target the intended stable identity.
6. Test chart layer generation for both empty projections and projection-only starts so no undefined anchor is inserted.

## Key Files
- `apps/backend/app/api/pension.py`
- `apps/backend/tests/test_pension_api.py`
- `apps/frontend/src/components/Pension/pensionTypes.ts`
- `apps/frontend/src/components/Pension/pensionChartUtils.ts`
- `apps/frontend/src/components/Pension/PensionTable.test.tsx`
- `apps/frontend/src/components/Pension/PensionChart.test.tsx`
