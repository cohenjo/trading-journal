# Pension frontend contract uses stable series ids and separate display labels

## Context
The pension dashboard needs to render multiple products for the same owner and the same product across multiple owners without chart collisions or ambiguous delete prompts.

## Decision
Treat `series_id`/`id` as the only chart and delete identity in the frontend, and treat `product_name`, `fund_name`, and `display_name` as presentation fields only. Pension table rows now show product first and provider second so duplicate product names remain understandable without leaking identity logic into UI labels.

## Consequences
- Chart helpers can sanitize malformed history/projection points without depending on human-readable labels.
- Delete confirmations always point at the correct pension product row.
- Future pension UIs should import the shared helpers from `apps/frontend/src/components/Pension/pensionTypes.ts` instead of rebuilding identity/display logic ad hoc.
