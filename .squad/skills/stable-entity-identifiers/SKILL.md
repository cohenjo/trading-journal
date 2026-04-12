---
name: stable-entity-identifiers
description: Use when the same logical account or asset must stay aligned across snapshot documents, plan documents, dashboard series ids, and delete flows. Covers stable ids derived from business identity, latest-active dashboard filtering, and delete-by-identity for JSON-backed financial records.
---

# Stable Entity Identifiers

## When to Use This Skill
- A JSON-backed asset appears in more than one document shape, such as snapshots plus plans.
- The frontend chart/table needs a series id that survives uploads, edits, and deletes.
- Owner-only or display-name matching is causing overwrites, duplicate rows, or broken deletes.

## Workflow
1. Identify the business fields that make the entity unique, such as owner, product type, and account/fund number.
2. Build one deterministic id from those fields and persist it in every JSON shape that stores the entity.
3. Emit the same id in dashboard payloads as the chart/table series key, and keep separate display fields for product/provider labels.
4. Build "current" dashboards from the latest snapshot first, then backfill history only for those active ids.
5. In chart helpers, sanitize malformed or empty history/projection points before connecting series so an empty history layer never prepends `undefined`.
6. Delete by the stable id, not by owner/name heuristics.

## Guardrails
- Keep the stable id independent of display labels.
- Preserve the raw metadata used to build the id in a details/account_settings object for migration and debugging.
- Prefer account or policy numbers when available; otherwise fall back to normalized provider/product names.
- Render business metadata separately in the UI: product as the primary label, provider/fund as supporting text, stable id hidden from users.
