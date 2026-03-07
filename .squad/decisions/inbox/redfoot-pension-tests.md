# Redfoot Decision: Pension regression identifiers

## Context
The pension dashboard needs to distinguish multiple pension products across Jony and Rita, including shared product names and delete operations that affect both chart history and the current table.

## Decision
Treat the pension identity as the stable contract across backend storage, dashboard series ids, and delete operations, and regression-test that identity through the dashboard payload and frontend table/chart layers.
Deletes should clear the matching pension identity from all finance snapshots and the plan so removed rows do not reappear in history-driven views.

## Impact
- Multi-owner/shared-product uploads stay distinct.
- Delete behavior is validated against both the latest table and historical chart data.
- Frontend chart tests can focus on layer-building edge cases without depending on PDF parsing.
