# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture and cross-cutting decisions | Keaton | System boundaries, major design choices, trade-offs |
| Frontend UX and React components | Fenster | Dashboards, planning screens, data visualization flows |
| Backend APIs and data services | Hockney | FastAPI endpoints, service layers, persistence logic |
| Financial models and calculations | McManus | Budget forecasts, retirement cash flow, dividend/bond modeling |
| Copilot SDK and AI services | Kobayashi | Agent service wiring, orchestration patterns, SDK integration |
| Platform and environment | Kujan | Aspire apphost, Docker, infra/dev workflow, CI |
| Security and compliance | Rabin | Auth, authorization, secrets, secure defaults |
| Testing and quality | Redfoot | Unit/integration testing, edge cases, regression coverage |
| Session logging and decisions merge | Scribe | Automatic logging and memory maintenance |
| Backlog/work monitoring | Ralph | Issue/PR board checks, work queue movement |
| Async issue work (bugs/tests/small scoped tasks) | @copilot 🤖 | Well-defined issues with clear acceptance criteria |

## Rules

1. Route single-domain work to domain owner.
2. Route multi-domain work to Keaton first, then fan out.
3. Redfoot reviews testability and risk on substantial changes.
4. Rabin reviews security-sensitive changes before merge.
5. Scribe runs after substantial work to maintain logs and decisions.
