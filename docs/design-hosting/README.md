# Design: Hosting & Sharing the Trading Journal

This folder holds the design for moving the Trading Journal off a local laptop
to free hosted services and enabling household-level sharing (couples / spouses).

## Start here

📄 **[design.md](design.md)** — the unified, opinionated design document.

## Sections (per-domain deep dives)

| # | Section | Owner |
|---|---------|-------|
| 01 | [Architecture overview & alternatives](sections/01-architecture-overview.md) | Keaton |
| 02 | [Frontend strategy (Vercel + Next.js + Supabase SSR)](sections/02-frontend-strategy.md) | Fenster |
| 03 | [Auth, sharing & security](sections/03-auth-sharing-security.md) | Rabin |
| 04 | [Deployment & CI/CD](sections/04-deployment-cicd.md) | Kujan |
| 05 | [Backend strategy (hybrid)](sections/05-backend-strategy.md) | Hockney |
| 06 | [Data architecture (raw → compute → cooked)](sections/06-data-architecture.md) | McManus |

## Diagrams

`.excalidraw` files open in [excalidraw.com](https://excalidraw.com) (drag-and-drop)
or via the **Excalidraw** VS Code extension.

| # | Diagram |
|---|---------|
| 01 | [System context](diagrams/01-system-context.excalidraw) |
| 02 | [Auth UX flow](diagrams/02-auth-ux-flow.excalidraw) |
| 03 | [Auth + household sharing flow](diagrams/03-auth-sharing-flow.excalidraw) |
| 04 | [Deployment topology](diagrams/04-deployment-topology.excalidraw) |
| 05 | [Data flow (raw → compute → cooked)](diagrams/05-data-flow.excalidraw) |
| 06 | [Data model (households & layers)](diagrams/06-data-model.excalidraw) |

## Reviews

| Reviewer | Verdict |
|----------|---------|
| 🔒 [Rabin (Security)](reviews/rabin-review.md) | Approved with conditions |
| ⚙️ [Kujan (DevOps)](reviews/kujan-review.md) | Approved with conditions |
| 🧪 [Redfoot (Test/Risk)](reviews/redfoot-review.md) → [re-review](reviews/redfoot-rereview.md) | Changes requested → Approved with conditions |
| 🔧 [Hockney revision log](reviews/hockney-revision.md) | — |

## Status

Approved by all reviewers. One pre–Phase 1 ask remains (Redfoot): a concrete
local/dev repro runbook before kicking off the migration.
