# Deployment & CI/CD Architecture

**Author:** Kujan (DevOps/Platform)  
**Date:** 2026-04-30  
**Status:** Recommended (pending approval)  
**Scope:** Hosting options, CI/CD pipeline, secrets management, observability, migration plan, cost projections

---

## 1. Hosting Options Comparison

### Frontend Hosting

| Platform | Free Tier Limits | After Free | GitHub Integration | Custom Domain | Regions | Notes |
|---|---|---|---|---|---|---|
| **Vercel** | Unlimited deployments; 100 GB egress/month; builds ≤ 2h | $20/mo (1 user, 150GB egress) | Native git push → deploy | ✅ Yes (free) | 30+ global | **Recommended** — purpose-built for Next.js, instant preview deploys on PR, automatic Postgres integration |
| **Netlify** | 300 min build time/month; 100 GB egress; unlimited sites | $19/mo (unlimited builds, 200GB) | Native git integration | ✅ Yes (free) | 30+ global | Strong alternative; slightly better build quota; less integrated DB experience |
| **Cloudflare Pages** | 500 builds/month; unlimited egress; 10ms deploy | $20/mo (unlimited builds) | GitHub Actions required | ✅ Yes (free) | 200+ global | Best for static-heavy sites; less ideal for Next.js SSR workloads |

**Recommendation:** **Vercel** — optimized for Next.js, automatic environment variable sync, built-in Postgres integrations via Supabase, instant PR preview deploys.

---

### Backend API Hosting (FastAPI)

| Platform | Free Tier Limits | After Free | GitHub Integration | Custom Domain | Docker Support | Cron Jobs | Notes |
|---|---|---|---|---|---|---|---|
| **Render** | 750 hours/month shared CPU; 1 instance; sleep after 15m inactivity | $7/mo (1 basic instance; no auto-sleep) | via git auto-deploy | ✅ Yes | ✅ Native | ✅ Built-in | Good starting point; auto-scales poorly; shared resource contention |
| **Fly.io** | 3 shared-cpu instances; 3 GB RAM total; 160 GB storage; USA region | $0.15/hr per VM (typical $12–20/mo for 1 small instance) | via git or CI/CD | ✅ Yes | ✅ Full | ✅ Machines | **Strong option** — global, good for stateless APIs, responsive support |
| **Railway** | $5 free credit/month (~10 hrs compute) | Pay-as-you-go; ~$5–20/mo for 1 small instance | Native git integration | ✅ Yes | ✅ Native | Limited | Developer-friendly; transparent pricing; good for prototypes |
| **Google Cloud Run** | 2M requests/month free; 360k GB-seconds compute; 1 concurrent instance | $0.40/M requests + compute costs (~$10–30/mo realistic) | via GitHub Actions | ✅ Yes | ✅ Full | ✅ Cloud Scheduler | Serverless; cold-start latency ~2s; finicky secrets handling |
| **Azure Container Apps** | 4 vCPU + 8 GB RAM total; 1M HTTP requests; up to 8 instances | $0.018/vCPU-hr (~$15–40/mo) | via GitHub Actions | ✅ Yes | ✅ Full | Limited | GA since 2023; good RBAC; less community presence vs Fly |
| **Hugging Face Spaces** | Free tier; 2 CPU, 4 GB RAM; auto-sleep after 24h inactivity | Pro: $7/mo (no sleep); GPU available | GitHub auto-sync | ✅ Yes | ✅ Docker | ❌ No | Designed for ML; not ideal for production APIs |

**Recommendation:** **Fly.io** — good balance of price, performance, and global reach. Fallback to **Render** for simplicity (but watch auto-sleep costs). **Cloud Run** if serverless cold-start is acceptable and you want per-request billing.

---

### Database + Auth

| Platform | Free Tier DB | Free Auth | After Free | GitHub Integration | Backups | Regions | Notes |
|---|---|---|---|---|---|---|---|
| **Supabase** (Postgres + Auth) | 500MB storage; 2 concurrent connections; basic backups | 50k+ users; JWT-based | $25/mo (500M storage, 100 concurrent) | Native PostgreSQL; great REST/GraphQL APIs | Daily (7 days) | 4 regions (US, EU, APAC, S. America) | **Recommended** — purpose-built Postgres + Auth combo; RLS for frontend queries |
| **Neon** (Postgres only) + **Clerk** (Auth) | 0.5 GB storage; 5 concurrent connections; 7-day backups | 10k+ monthly active users | $14/mo Neon + $99/mo Clerk Pro (overkill for 50 users) | Both have GitHub Actions integrations | Auto daily + manual | US East (free), EU (paid) | Decoupled auth adds complexity; Clerk premium is costly |
| **Neon** + **Auth.js** (OSS) | 0.5 GB storage; good enough; auth on backend | None (self-managed) | $14/mo Neon only | Neon integrates; Auth.js via code | Auto daily | US East (free), EU (paid) | Minimal cost; Auth.js self-hosting adds maintenance burden |

**Recommendation:** **Supabase** — single integrated provider, RLS support, excellent for small teams, built-in Auth UI components, excellent docs.

---

### Scheduled Jobs & Heavy Compute

| Platform | Use Case | Free Tier | After Free | Setup Complexity | Notes |
|---|---|---|---|---|---|
| **Local Docker** (current) | Heavy compute, backtesting, data sync | Unlimited (your hardware) | N/A | Trivial (already running) | Keep as-is for backtesting; push results to Supabase |
| **GitHub Actions Cron** | Nightly jobs, lightweight tasks | 2,000 min/month free tier | $0.008/min overages | Medium (YAML workflow) | Good for: nightly Alembic migrations, data exports, cleanup jobs |
| **Supabase pg_cron** (PostgreSQL extension) | DB maintenance, reporting, ETL | Included with Postgres | Included | Low (SQL functions) | Excellent for: purging old logs, refreshing materialized views, scheduled backups |
| **Render Cron Jobs** | Periodic API calls, webhooks | $0/mo (on Render) | Included in Render bill | Medium (Render dashboard) | Tight Render integration; easy to set up alongside web service |
| **Fly.io Cron Machines** | Periodic tasks, cleanup | Included with Fly | Included | Low (Fly CLI) | Lightweight; excellent for small periodic tasks; scales with Fly bills |
| **Cloud Run Jobs** (Google) | One-off or scheduled tasks | 4,000 vCPU-seconds/month free | $0.004/vCPU-second | Medium (Cloud Scheduler + Cloud Run Jobs) | Serverless; good for transient workloads; requires GCP setup |

**Recommendation:** 
- **Local Docker** — keep for heavy compute (backtesting, live data sync)
- **GitHub Actions Cron** — for nightly Alembic migrations and schema syncs
- **Supabase pg_cron** — for database-level maintenance (if SQL-expressible)

---

## 2. Recommended Deployment Topology

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Developer's Machine                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Local Docker Compose                                      │   │
│  │ • FastAPI Backend (port 8000)                            │   │
│  │ • Next.js Frontend (port 3000)                           │   │
│  │ • PostgreSQL (port 5432)                                 │   │
│  │ • Heavy compute jobs (Pandas, backtesting)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ↓ (push)                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ GitHub Repository                                        │   │
│  │ • Triggers CI/CD on push to main                         │   │
│  │ • Stores secrets in GH Actions secrets                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
         ┌─────────┐    ┌──────────┐    ┌──────────────┐
         │ Vercel  │    │Supabase  │    │ GH Actions   │
         │         │    │          │    │              │
         │Next.js  │    │PostgreSQL│    │Nightly cron  │
         │ (git    │    │+ Auth    │    │tasks         │
         │ deploy) │    │(hosted)  │    │              │
         │         │    │          │    │• Alembic     │
         │Preview  │    │Postgres  │    │  migrations  │
         │deploys  │    │backups   │    │• Data sync   │
         │on PR    │    │(daily)   │    │• Cleanup     │
         └─────────┘    └──────────┘    └──────────────┘
              ↓               ↑               
              └───────────────┘
         (ENV from Vercel → API calls to Supabase)
```

### Deployment Topology Key Points

1. **Frontend:** Vercel with auto-deploy from GitHub
   - PR preview deployments (automatic on every PR)
   - Environment variables synced from Vercel dashboard
   - API endpoint points to hosted backend (or local for dev)

2. **Backend:** *Option A (Recommended)* — Serverless/Container to Fly.io or Render
   - Stateless FastAPI container deployed from GitHub Actions
   - Environment variables in GitHub Actions secrets → passed to container
   - Postgres connection via Supabase service role

3. **Backend:** *Option B (If lightweight)* — Backend-less; use Supabase Edge Functions
   - Move light API logic to TypeScript Edge Functions
   - Python heavy compute stays local or offloads to Cloud Run

4. **Database:** Supabase (PostgreSQL + Auth)
   - Single source of truth for user data
   - RLS policies enforce multi-user isolation (if applicable)
   - Backups daily (7-day retention on free tier)
   - Service role key (for server-to-server calls) stored in GitHub Actions secrets

5. **Heavy Compute:** Local Docker (unchanged)
   - Developer runs backtesting, data import locally
   - Results written to Supabase Postgres (INSERT batch operations)
   - Scheduled nightly syncs via GitHub Actions cron (if needed)

### Why This Topology?

- **Free tier friendly:** Vercel free → 100 GB egress; Supabase free → 500 MB storage; Fly.io $0 startup cost
- **Simple:** One git push triggers the entire CI/CD pipeline
- **Scalable:** Vercel, Supabase, Fly scale automatically; heavy compute stays local until needed
- **Secure:** Environment variables centralized; service keys never exposed in frontend

---

## 3. CI/CD Pipeline

### GitHub Actions Workflows

All workflows stored in `.github/workflows/`:

#### A. **PR Validation** (`squad-ci.yml` — existing, enhanced)

**Trigger:** `pull_request` to `main`

**Jobs:**

```yaml
frontend-lint-test:
  - npm ci
  - npm run lint (ESLint)
  - npx tsc --noEmit (type-check)
  - npm run test:unit (vitest)
  - Report: coverage report to comment

backend-lint-test:
  - uv sync
  - ruff check apps/backend (lint)
  - mypy apps/backend (type-check)
  - pytest apps/backend --cov (unit tests)
  - Connect: PostgreSQL service container for integration tests
  - Report: coverage report to comment

vercel-preview:
  - Automatic via Vercel GitHub integration (no explicit workflow needed)
  - Creates preview URL posted to PR

schema-diff:
  - NEW: Fetch current Supabase schema (via `supabase db pull` or custom SQL)
  - Check for breaking migrations not yet deployed
  - Warn if PR contains Alembic migrations not matching current schema

docker-build:
  - Build both frontend and backend images (validation only, no push)
```

#### B. **Main Merge Deploy** (`squad-deploy.yml` — new)

**Trigger:** `push` to `main` (after PR merge)

**Jobs:**

```yaml
deploy-frontend:
  - Vercel deployment automatic (git hook)
  - No explicit workflow step needed; Vercel CLI can force if desired

deploy-database:
  - Connect to Supabase via `SUPABASE_DB_URL` (service role key in secrets)
  - Run: alembic upgrade head
  - On failure: Slack alert (if integrated)
  - Rollback command: alembic downgrade -1 (manual, for now)

deploy-backend:
  - IF backend kept as separate service:
    - Build container image
    - Tag: ghcr.io/cohenjo/trading-journal-backend:latest
    - Push to GitHub Container Registry
    - Trigger Fly.io / Render deployment via webhook or API
  - IF backend moved to Edge Functions:
    - Deploy TypeScript files to Supabase Edge Functions
```

#### C. **Nightly Jobs** (`squad-nightly.yml` — new)

**Trigger:** `schedule: cron: '0 2 * * *'` (2 AM UTC daily)

**Jobs:**

```yaml
database-maintenance:
  - Connect to Supabase
  - Run Alembic migrations (in case any were staged)
  - Vacuum analyze tables (for query optimizer)
  - Export metrics to dashboard (optional)

heavy-compute:
  - Option A: GitHub Actions
    - Fetch latest market data from IB Gateway (or mock API)
    - Run backtest pipeline (Python Docker image)
    - INSERT results to Supabase
  - Option B: Local Docker (manual cron on dev machine)
    - Developers run locally via cron job (less recommended)
```

### GitHub Actions Secrets Configuration

All secrets stored in **GitHub repo settings** → **Secrets and variables** → **Actions**:

```
SUPABASE_URL              → https://xxxx.supabase.co
SUPABASE_SERVICE_KEY      → service_role JWT token (never in frontend code)
DATABASE_URL              → postgresql://[user]:[password]@[host]:[port]/[db]
VERCEL_TOKEN              → GitHub App token (optional, for force deploys)
CLERK_SECRET_KEY          → If using Clerk (optional)
IB_GATEWAY_USERID         → Interactive Brokers username (encrypted)
IB_GATEWAY_PASSWORD       → Interactive Brokers password (encrypted)
```

**Access Pattern:**
- Frontend (Vercel): Only receives `NEXT_PUBLIC_SUPABASE_URL` (public), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe)
- Backend (Fly/Render): Receives `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (private)
- GitHub Actions: Full access to all secrets for deployment

---

## 4. Secrets Management

### Development (Local `.env.local`)

Never commit `.env.local`:

```bash
# .env.local (git-ignored)
DATABASE_URL=postgresql://postgres:password@localhost:5432/trading_journal
SUPABASE_URL=http://localhost:54321  # Supabase local dev
SUPABASE_SERVICE_KEY=eyJ...          # Supabase local key
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
IB_GATEWAY_USERID=your-ib-user
IB_GATEWAY_PASSWORD=your-ib-password
```

### Production

**Vercel (Frontend):**
- Sync variables from Vercel dashboard → **Settings** → **Environment Variables**
- Auto-injected into Next.js build: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Fly.io / Render (Backend):**
- Store secrets in GitHub Actions → passed as container env vars at deploy time
- OR: Use Fly.io/Render secrets manager → integrated with deployment

**Supabase:**
- Service role key stored in GitHub Actions secrets only
- Never exposed in frontend bundle (use `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead)
- Rotate key annually or after security incident

**Best Practices:**
1. Use role-based keys: `SUPABASE_ANON_KEY` for public client, `SUPABASE_SERVICE_KEY` for backend
2. Use `NEXT_PUBLIC_*` prefix **only** for non-sensitive variables (safe to expose to browsers)
3. Never log or console.log secrets
4. Use GitHub secret masking (automatic)
5. Rotate IB Gateway credentials annually or if compromised

---

## 5. Observability & Monitoring

### Current Stack: OpenTelemetry + Aspire Dashboard (Dev)

For hosted production, consider:

| Platform | Free Tier | After Free | Setup | Strengths | Weaknesses |
|---|---|---|---|---|---|
| **Logfire** (Pydantic) | 20k spans/day; 7-day retention | $100/mo+ per tier | Low (Python SDK) | Excellent Python support; structured logging | Overkill for small app; limited frontend JS support |
| **Axiom** | 30-day free trial; then pay-as-you-go (~$0.69/GB) | ~$50–200/mo realistic | Low (CLI + webhook integration) | Great for logs + metrics; cheap | Limited free tier after trial |
| **Better Stack** | 1M log entries/month; 7-day retention | $10/mo (7 days → 30 days) | Low (HTTP endpoint) | Affordable; clean UI; incident response | Smaller team; less integrations |
| **Grafana Cloud Free Tier** | Metrics, logs, traces (limited) | Free tier suitable; optional paid | Medium (agent setup) | Industry standard; integrates with everything | Complex for small app; steep learning curve |
| **Vercel Analytics** | Included (frontend only) | Included | Zero setup | Built-in; great for Next.js | Backend/API not monitored |
| **Keep current (Aspire Dev Only)** | Dev-time observability; no production | N/A | None | Already integrated | Not production-grade |

### Recommendation for Small App (0–50 users)

**Phase 1 (Free tier):**
- **Vercel Analytics** (frontend performance metrics)
- **Docker logs → stdout** (backend logs to console; collected by Fly.io/Render)
- **Supabase Logs UI** (query logs, replication lag)
- Manual Slack/email alerts for deployment failures

**Phase 2 (Optional, when scaling):**
- **Better Stack** ($10/mo) — centralized logging
- **OpenTelemetry + Grafana Cloud** (if detailed tracing needed)

---

## 6. Migration Plan: From Local to Hosted

### Phase 0: Validate Locally (Week 1–2)

1. Run full suite locally: `docker-compose up --build`
2. Ensure CI/CD passes: `.github/workflows/squad-ci.yml` green
3. Backtest pipeline works: heavy compute completes in <10 min

### Phase 1: Database Cutover (Week 3)

**Goal:** Switch from local Postgres → Supabase

1. Export local Postgres schema + seed data:
   ```bash
   pg_dump -U postgres trading_journal > schema.sql
   ```

2. Create Supabase project; import schema:
   ```bash
   psql -h [supabase-host] -U [role] -d trading_journal < schema.sql
   ```

3. Update `DATABASE_URL` in `.env.local` to point to Supabase
4. Run Alembic migrations: `alembic upgrade head`
5. Test backend locally against Supabase:
   ```bash
   docker-compose up backend db  # but db = supabase connection string
   ```

**Rollback:** Keep local Postgres running; revert `DATABASE_URL` in `.env.local`

### Phase 2: Frontend to Vercel (Week 4)

1. Connect GitHub repo to Vercel
2. Set environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_URL` (if backend still localhost, or point to Fly/Render)

3. Push to `main`; Vercel auto-deploys
4. Test preview URL; verify API calls work

**Rollback:** Revert to local frontend; run `npm run dev` locally

### Phase 3: Backend to Fly.io / Render (Week 5, optional)

1. Build Docker image; test locally:
   ```bash
   docker build -f apps/backend/Dockerfile -t backend:latest apps/backend/
   docker run -e DATABASE_URL=postgresql://... backend:latest
   ```

2. Deploy to Fly.io:
   ```bash
   fly auth login
   fly launch --image ghcr.io/cohenjo/trading-journal-backend:latest
   fly secrets set DATABASE_URL=postgresql://...
   ```

3. Test: `curl https://[backend-url]/docs`

**Rollback:** Update `NEXT_PUBLIC_API_URL` in Vercel back to `http://localhost:8000`; run backend locally

### Phase 4: GitHub Actions CI/CD (Week 6)

1. Create `.github/workflows/squad-deploy.yml` (main deploy trigger)
2. Create `.github/workflows/squad-nightly.yml` (cron jobs)
3. Add GitHub Actions secrets
4. Test full pipeline: PR → preview → merge → production deploy

**Rollback:** Disable workflows; manual deploy via `git push` to branches; roll back via Vercel/Fly dashboards

### Rollback Strategy

- **Database:** Keep local Postgres snapshot; Alembic `downgrade` if schema breaks
- **Frontend:** Vercel dashboard allows instant rollback to previous deployment
- **Backend:** Fly.io allows instant rollback; keep previous image in registry
- **Secrets:** If compromised, regenerate in GitHub Actions + rotate in Supabase/Fly

---

## 7. Cost Projections

### Scenario 1: 0 Users (Developer Only)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel (frontend) | $0 | Free tier: 100 GB egress/mo; typically uses <5 GB |
| Supabase (database) | $0 | Free tier: 500 MB storage; single user, low volume |
| Fly.io (backend) | $0–3 | 3 shared-cpu instances free; or 1 small instance ~$2–3 |
| GitHub Actions | $0 | 2,000 min/month free; nightly cron ~50 min/month |
| **Total** | **$0–3** | Fully free-tier compliant |

---

### Scenario 2: 5 Users (Friends/Beta)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel (frontend) | $0–5 | Free tier still covers; 100 GB egress enough for 5 users |
| Supabase (database) | $0–10 | Free tier covers; if approaching 500 MB, consider upgrade to 5 GB ($25/mo) |
| Fly.io (backend) | $3–15 | Shared instances free; if needing dedicated instance, +$7/mo; or stay shared |
| GitHub Actions | $0–2 | ~100 min/month (nightly + test runs); well within free tier |
| Observability | $0–10 | Better Stack ($10/mo) if want centralized logs; else free |
| **Total** | **$3–32** | Likely $3–15 (most stay on free tier) |

---

### Scenario 3: 50 Users (Public Release)

| Component | Monthly Cost | Notes |
|---|---|---|
| Vercel (frontend) | $20 | Standard tier: 1 user, 150 GB egress/mo; realistic for 50 active users |
| Supabase (database) | $25–50 | Pro tier: 8 GB storage (~$25/mo); usage may hit limits; upgrade to Team ($50/mo) if more concurrent connections needed |
| Fly.io (backend) | $15–50 | Depending on traffic; if using Fly machines for autoscaling, ~$20–50/mo realistic |
| GitHub Actions | $0–5 | 2,000 min free; if overages, $0.008/min (~$1–5/mo) |
| Observability | $10–50 | Better Stack ($10/mo); if detailed APM, Grafana Cloud ($25–100/mo) |
| Custom Domain | $10–15 | Vercel: free custom domain; Fly/Render: $10–15/mo if want separate domain |
| **Total** | **$70–150** | Most likely ~$80–120/mo for sustainable small SaaS |

---

### What Triggers First Paid Tier?

1. **Vercel:** Exceeds 100 GB egress/month → upgrade to Standard ($20/mo)
2. **Supabase:** Exceeds 500 MB storage OR 100 concurrent connections → upgrade to Pro ($25/mo)
3. **Fly.io:** Exceeds 3 shared-cpu instances OR adds private IP → upgrade to paid machine ($7+/mo)
4. **GitHub Actions:** Exceeds 2,000 min/month → pay $0.008/min overages

**Realistic thresholds:**
- ~50 daily active users → Vercel Standard + Supabase Pro ($45/mo minimum)
- ~200 daily active users → Fly.io small instance dedicated + team-tier Supabase ($100+/mo)
- ~1,000+ daily active users → consider AWS, GCP, or full managed platform ($500+/mo)

---

## 8. Security Checklist for Deployment

- [ ] All secrets in GitHub Actions secrets; none in `.env.local` committed
- [ ] Supabase RLS policies enabled for multi-user isolation (if applicable)
- [ ] CORS restricted to Vercel frontend domain only (not `*`)
- [ ] JWT expiration set to 1 hour; refresh tokens 7 days (Supabase defaults good)
- [ ] Database backups daily; 7-day retention enabled in Supabase
- [ ] Monitoring alerts set for failed deployments or error spikes
- [ ] Secrets rotated annually; IB Gateway credentials reset seasonally
- [ ] All environment variables validated at startup (fail fast if missing)

---

## References

- [Vercel Deployment Docs](https://vercel.com/docs)
- [Supabase Hosting Guide](https://supabase.com/docs/guides/hosting)
- [Fly.io Deployment](https://fly.io/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Alembic Migrations](https://alembic.sqlalchemy.org/)
- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)

---

**Next Steps:**
1. Approval from Keaton (Lead) on topology
2. Rabin (Security) review of secrets management
3. Fenster + Hockney to implement CI/CD workflows
4. Phase 0 validation (local testing)
5. Phase 1–4 rollout (4–6 weeks estimated)
