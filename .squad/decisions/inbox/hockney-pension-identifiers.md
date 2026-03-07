# Stable pension identifiers across snapshot/plan/dashboard flows

## Context
The pension flow stores account data inside JSON snapshots and plan documents rather than normalized pension tables. Random ids and owner-only matching caused Jony/Rita multi-product uploads to overwrite each other, left deleted products in the dashboard, and made frontend series keys unstable.

## Decision
Use a stable pension identity with the shape `pension::{owner}::{product}::{account-or-fund}`. Persist that identity as the item `id` and inside `details.pension_identity`, and use it everywhere pension records are matched or emitted.

## Consequences
- Uploads update the correct pension product even when one owner has multiple products.
- Dashboard series ids stay stable and only include pensions present in the latest snapshot.
- Deletes operate by business identity instead of owner/name heuristics.
