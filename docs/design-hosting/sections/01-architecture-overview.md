# Architecture Overview and Alternatives

![System Context](../diagrams/01-system-context.excalidraw)

> Note: the diagram is an Excalidraw JSON file. Open it with Excalidraw or the VS Code Excalidraw extension.

## Goals

- Move the trading-journal app from a laptop-only deployment to free or very low-cost hosted services.
- Support a small trusted audience, initially Jony and a few invited people such as a spouse.
- Prefer Supabase for managed Postgres and authentication, including Google OAuth.
- Prefer Vercel for the Next.js frontend because it fits the current stack and low-ops goal.
- Preserve couples/spouses data sharing and extend the existing settings concept into an auth-backed invite flow.
- Keep heavy compute local for now: backtests, broker sync jobs, and other Docker workloads can write raw or computation tables into the hosted database.
- Keep the first hosted version understandable, reversible, and cheap before optimizing for scale.

## Non-goals

- Do not build a multi-tenant SaaS platform for unknown public users in this phase.
- Do not resume IBKR integration as part of the hosting migration; manual entries are the default workflow.
- Do not move all heavy compute to managed cloud jobs unless local Docker becomes operationally painful.
- Do not require paid infrastructure before the app has real shared-user usage.
- Do not redesign every backend domain model as part of hosting; make only the changes needed for hosted auth, sharing, and deployment boundaries.

## Proposed reference architecture

The reference architecture is a lean hosted frontend plus managed data/auth platform: the Next.js app runs on Vercel, authenticates users through Supabase Auth with Google OAuth, reads and writes user-facing trading-journal data in Supabase Postgres, and optionally calls a retained FastAPI service only where existing backend logic cannot yet be collapsed safely. Local Docker remains the execution environment for expensive or broker-adjacent workloads and writes controlled outputs into raw/computation tables; the hosted UI reads curated/cooked tables so sharing the app does not require sharing the laptop runtime.

Components and runtime locations:

- **User browser:** Hosted users access the app over HTTPS and sign in with Google OAuth.
- **Vercel / Next.js 15 frontend:** Runs the React UI, server components/routes where useful, Supabase SSR session handling, and lightweight UI-facing API routes if selected.
- **Supabase Auth:** Owns user identity, sessions, Google OAuth, passwordless recovery if enabled, and invite acceptance identity checks.
- **Supabase Postgres:** Stores application data, ownership/sharing relationships, raw ingestion tables, computation outputs, and cooked read models. Row Level Security should be the default authorization boundary.
- **Optional FastAPI backend:** Runs on a free/cheap container platform only for APIs that still require Python services, SQLModel/Alembic continuity, or domain logic too risky to port immediately.
- **Local Docker compute:** Runs backtests, broker syncs, and data-processing jobs on Jony's machine; writes through service credentials or constrained database roles to raw/computation tables.
- **CI/CD:** GitHub Actions validates changes; Vercel deploys frontend previews/production; backend deployment depends on whether Option A or B is selected.

## Alternatives matrix

### Frontend host

| Alternative | Pros | Cons | Recommendation |
|---|---|---|---|
| **Vercel** | Best fit for Next.js 15; strong preview deployments; simple environment-variable management; generous hobby tier for a small app; low friction with Supabase SSR. | Hobby limits and commercial-use policy need review; serverless functions can hide backend complexity if overused; vendor-specific deployment settings. | **Recommended** for the first hosted frontend. It minimizes migration work and maximizes Next.js compatibility. |
| Netlify | Good static/frontend hosting; preview deploys; simple forms/functions ecosystem. | Next.js support is usually less first-party than Vercel; fewer reasons to switch given the existing Next.js stack. | Viable fallback if Vercel limits or policy become a blocker. |
| Cloudflare Pages | Excellent edge network; cheap/free; strong performance; Workers ecosystem can be powerful. | Next.js feature compatibility can require adapter constraints; operational model differs from Vercel; database/auth story still external. | Consider later for cost/performance hardening, not the fastest path. |
| Self-hosted frontend | Maximum control; no platform limits beyond the host; can colocate with backend. | More ops burden, TLS, deploys, monitoring, uptime, and security patching; contradicts small/free low-ops goal. | Not recommended for the first shared deployment. |

### Database and auth

| Alternative | Pros | Cons | Recommendation |
|---|---|---|---|
| **Supabase** | Postgres plus Auth in one product; Google OAuth; existing frontend dependencies already present; RLS supports spouse/couple sharing; free tier fits small project; direct SQL access for local compute. | Requires careful RLS design; Supabase Auth must be reconciled with existing FastAPI auth; free-tier limits and backups need review. | **Recommended** as the default DB+Auth platform. It matches user preference and current dependencies. |
| Neon + Clerk | Strong managed Postgres plus polished hosted auth; good developer experience; separation of concerns. | Two vendors; Clerk may add cost/complexity; current repo already has Supabase libraries. | Good alternative for a more productized app, but not first choice here. |
| Neon + Auth.js | Postgres-first and flexible; keeps auth closer to Next.js; can avoid auth vendor lock-in. | More custom auth/session work; invite/share flows and backend JWT validation need more design; less turnkey than Supabase Auth. | Consider only if Supabase Auth/RLS blocks needed workflows. |
| PlanetScale + auth provider | Operationally mature MySQL platform; good branching workflows. | App is already Postgres/SQLModel/Alembic-oriented; Supabase RLS and Postgres features are a better fit; auth still separate. | Not recommended for this migration. |
| Self-hosted Postgres + Authentik | Maximum control and portability; powerful auth options. | Highest ops burden; backups, patching, OAuth, TLS, email, and uptime become Jony's responsibility; poor fit for free/cheap low-maintenance sharing. | Not recommended unless privacy/control requirements dramatically increase. |

### Backend API shape

| Alternative | Pros | Cons | Recommendation |
|---|---|---|---|
| Keep FastAPI on Render/Fly/Railway/Cloud Run | Preserves existing Python domain logic, SQLModel models, Alembic migrations, and OpenAPI surface; least risky for backend-heavy flows. | Adds a second deployed service; free tiers may sleep or change; must validate Supabase JWTs and secure CORS; more CI/CD work. | **Recommended for Option B** when preserving backend API boundaries matters more than minimizing services. |
| Collapse into Next.js API routes | Single deployable app; fewer moving pieces; strong fit for UI-adjacent CRUD and invite flows; can use Supabase SSR directly. | Porting Python logic may risk financial correctness; Node runtime differs from existing backend; API route sprawl is possible. | **Recommended for Option A** for manual-entry CRUD and sharing flows, while leaving heavy compute local. |
| Supabase Edge Functions | Close to Supabase Auth/Postgres; good for small auth-triggered workflows; fewer separate services. | Deno/runtime differences; not ideal for existing Python services; local dev and testing differ from current stack. | Use selectively for auth hooks or lightweight server-side actions, not as the main backend replacement yet. |
| PostgREST / direct Supabase client | Very lean; RLS can enforce authorization; fewer custom APIs; excellent for simple CRUD. | Complex domain operations, validation, and financial calculations can leak into clients; hard to preserve existing service logic. | Use for read-heavy/cooked-table access where RLS and views are sufficient. |
| Hybrid | Keep FastAPI for complex Python/financial APIs, use Next.js/Supabase for auth, invites, and simple CRUD. | More architecture decisions and integration tests; two authorization enforcement points. | **Best migration posture** if the team wants low risk with phased simplification. |

### Heavy compute

| Alternative | Pros | Cons | Recommendation |
|---|---|---|---|
| **Local Docker → Supabase** | Keeps expensive backtests and broker-adjacent jobs off free hosting; matches current Docker workflow; easiest path while IBKR is on hold; can write raw/computation outputs for hosted UI. | Laptop availability affects refresh cadence; service credentials must be protected; network/database write failures need retries and observability. | **Recommended now.** Keep compute local and publish curated outputs to Supabase. |
| GitHub Actions cron | Free-ish scheduled jobs; good audit trail; easy secrets management; no always-on server. | Runtime limits; not ideal for broker integrations, long backtests, or stateful workloads; scheduled reliability can vary. | Good fallback for small periodic transforms, not primary heavy compute. |
| Fly Machines | Can run containers on demand; better for longer/background workloads; more control than serverless. | More ops and billing awareness; may exceed free usage; requires deployment packaging. | Consider when local compute needs reliable remote execution. |
| Render Cron | Simple scheduled jobs; container-friendly. | Free-tier constraints and sleeping behavior; less control over long jobs; pricing can change. | Candidate for lightweight scheduled refresh jobs only. |
| Cloud Run Jobs | Strong container jobs model; scales to zero; good IAM story. | Google Cloud setup complexity; billing/project configuration; cold-start and quota considerations. | Best later-stage managed-job option if workloads outgrow local Docker. |

## Recommended end-to-end stacks

### Option A: Lean

- **Frontend/API:** Vercel-hosted Next.js app with selected API routes/server actions.
- **DB/Auth:** Supabase Auth + Supabase Postgres with RLS.
- **Backend:** No separately hosted FastAPI for the initial manual-entry app; port only the small API surface needed for hosted sharing and CRUD.
- **Compute:** Local Docker writes raw/computation tables; UI reads cooked views/tables.

Trade-off: lowest cost and operations, but requires careful selection of which existing FastAPI behavior is safe to defer, port, or expose through Supabase directly.

### Option B: Decoupled API

- **Frontend:** Vercel-hosted Next.js app.
- **DB/Auth:** Supabase Auth + Supabase Postgres with RLS.
- **Backend:** FastAPI hosted on Render, Fly, Railway, or Cloud Run; validates Supabase JWTs and retains Python service boundaries.
- **Compute:** Local Docker continues heavy jobs and can share Python libraries/service code with FastAPI where appropriate.

Trade-off: preserves existing backend architecture and financial-domain code, but adds service deployment, CORS/JWT integration, monitoring, and free-tier reliability concerns.

## Open questions

- Which current FastAPI endpoints are required for the first hosted manual-entry experience, and which can be deferred?
- Should authorization rely primarily on Supabase RLS, FastAPI policy checks, or a layered combination?
- What is the canonical data-sharing model for spouses: account-level membership, household/workspace membership, per-portfolio sharing, or a combination?
- How should local Docker authenticate to Supabase for raw/computation writes without over-privileged service keys on a laptop?
- What backup/export guarantees are acceptable on Supabase free tier for personal financial records?
- Does Vercel's hobby tier policy fit the expected sharing pattern, or should a paid/pro account be planned if usage expands?

## Dependencies on other team sections

- **Rabin (auth/security):** Define Supabase Auth, Google OAuth, invite acceptance, RLS policies, service-role handling, JWT validation, CORS, and secure cookie/session posture.
- **Kujan (deploy/CI):** Define Vercel project setup, environment promotion, Supabase migration workflow, secrets management, preview deploys, and optional FastAPI hosting target.
- **Hockney (backend):** Inventory FastAPI endpoints, recommend keep/port/defer decisions, and define how Python services interact with Supabase-hosted data.
- **McManus (data model):** Define household/spouse sharing tables, raw/computation/cooked table boundaries, precision expectations, and migration impact on existing Postgres schema.
- **Fenster (frontend):** Define frontend auth wiring, invite UX, manual-entry flows, SSR/client data access patterns, and chart reads from cooked tables.
