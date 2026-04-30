# Kujan Deployability Review — design.md

**Reviewer:** Kujan (DevOps/Platform Engineer)  
**Date:** 2026-05-01  
**Status:** APPROVED WITH CONDITIONS  
**Scope:** Synthesis of sections 02–06 into unified design.md for hosting deployment, CI/CD, secrets, observability, and cost.

---

## Verdict: APPROVED WITH CONDITIONS

The synthesis successfully integrates all five sections into a coherent deployment strategy. **No deployment recommendations were lost.** However, several free-tier assumptions need explicit human verification, and three specific configurations require clarification before implementation.

---

## Summary

**What works:**
- The hybrid architecture (Option C) is sound: Vercel/Next.js for frontend, Supabase for database + auth, local Docker for compute.
- CI/CD pipeline ordering is correct: migrations run before frontend deploy (design.md Phase 1 executes alembic before Vercel).
- Secrets layout is well-structured: public anon keys in Vercel, service role + database URL in GitHub Actions only.
- Observability choices are pragmatic for the user's scale: Vercel Analytics + Docker stdout in Phase 1, optional Better Stack in Phase 2.
- Cost projections are realistic ($0–3 solo, $3–15 for household, $70–150 for 50 users).

**What needs verification or clarification:**
1. Free-tier limits are cited but assume 2026 Supabase policies—need human confirmation.
2. Local Docker → Supabase over NAT/dynamic IP: acknowledged but lacks explicit retry/restart strategy.
3. Connection pooling split (`SUPABASE_DB_DIRECT_URL` vs pool URL) is mentioned but not fully wired into the CI/CD pipeline sections.
4. Preview deploy OAuth callback strategy is documented but not yet tested against real Supabase/Google behavior.
5. Backup survival during Supabase free-tier "pause" is not explicitly detailed—only mentioned as a risk.
6. Custom domain story is deferred as an "open question"; should be resolved before Phase 2.

---

## Findings

### 🔴 Blocking

**None.** The design is deployable as written.

---

### 🟡 Important

#### 1. Local Docker → Supabase Connection Reliability (Medium urgency)

**Where:** design.md § 4.4, § 10 Risk #2, sections/05-backend-strategy.md § "Local Docker connected to Supabase"

**Issue:** The design acknowledges that laptop sleep, network changes, and dynamic IPs break worker jobs—but only describes the problem, not the solution.

**Current text:**
> Laptop sleep pauses jobs and can miss market windows.
> IP-based DB allow lists are painful if the machine moves networks.

**Gap:** No documented restart strategy or connection retry logic. What happens when the Docker worker loses TLS connection to Supabase? Does it:
- Retry with exponential backoff?
- Crash and alert the user?
- Log silently and resume on next scheduler run?

**What the user needs before Phase 4:**
- FastAPI worker must implement a connection pool with `pool_pre_ping=True` (mentioned in design.md § 10 Risk #3, but not wired into actual FastAPI code guidance).
- Alembic must use the direct URL, not PgBouncer transaction pool (mentioned but unclear if .env.local guidance covers this).
- Docker compose health checks or process supervisors (systemd, supervisor) should restart failed workers.

**Recommendation:** Add a section to 05-backend-strategy.md (or reference from design.md) that shows:
1. FastAPI/SQLModel config snippet with `pool_pre_ping=True` and timeouts.
2. Local Docker healthcheck YAML.
3. Preferred restart mechanism (systemd timer, cron wrapper, or Docker's `restart: unless-stopped`).

---

#### 2. Supabase Free-Tier "Pause" During Inactivity — Backup Survival

**Where:** design.md § 10 Risk #2 (acknowledged but incomplete)

**Issue:** Supabase freezes free-tier projects after 2 weeks of inactivity. The design mentions daily backups (7-day retention), but does **not** explain:
- Can you restore from a backup after the project is frozen?
- Should `pg_dump` backups be automated immediately, or is the built-in backup sufficient?
- Is there a recovery plan if the project becomes frozen mid-deployment?

**Current text in design.md:**
> Monitor storage; plan upgrade to Pro ($25/mo) if approaching limits. Supplement with local `pg_dump` backups before risky migrations.

**Gap:** This is good for **risky migrations**, but doesn't address routine backup automation or recovery from freeze.

**Recommendation:** Verify Supabase's freeze behavior (as of 2026) and clarify in a new subsection:
1. **Freeze policy:** Does Supabase freeze free-tier projects after N days of zero API activity?
2. **Backup retention during freeze:** Are daily backups preserved while the project is frozen?
3. **Recovery procedure:** Can you unfreeze and restore a backup immediately, or is there a manual support ticket required?
4. **Day-one mitigation:** Should a `pg_dump` cron job be added to the local Docker environment **from Phase 1**, or is Supabase's built-in backup sufficient?

**Until verified, flag design.md § 8 (Cost Profile) with a note:** *"Supabase free tier may pause after 2 weeks of inactivity; confirm backup retention and recovery procedure as part of Phase 1 validation."*

---

#### 3. CI/CD Secrets Layout — CLERK_SECRET_KEY Remnant

**Where:** design.md § 4.5, sections/04-deployment-cicd.md § 3 ("GitHub Actions Secrets Configuration")

**Issue:** The GitHub Actions secrets table lists:
```
CLERK_SECRET_KEY          → If using Clerk (optional)
```

But Rabin's auth design (section 03, adopted in design.md § 4.2) specifies **Supabase Auth only**, not Clerk.

**Recommendation:** Remove `CLERK_SECRET_KEY` from the secrets table. The comment "(optional)" is misleading—Clerk is not part of the recommended design.

---

#### 4. Preview Deploy OAuth Callback — Feasibility Not Confirmed

**Where:** sections/02-frontend-strategy.md § "Preview deployments"

**Issue:** Three strategies are proposed:
1. Stable redirect proxy (recommended).
2. Per-PR allowlisting (fallback).
3. Local-only workaround.

**Gap:** None of these have been tested against **real Supabase + Google OAuth** behavior as of 2026. The design assumes #1 is feasible but doesn't detail the implementation.

**What the user must verify before Phase 2:**
- Can you register a stable callback URL (e.g., `https://auth.trading-journal.example.com/auth/callback`) with Supabase and Google, then use OAuth state/cookies to route preview requests back to preview URLs?
- Does Supabase's OAuth flow support this pattern, or does it require an explicit redirect URI for each preview URL?
- If strategy #1 fails, is per-PR allowlisting (strategy #2) automated enough to work in CI, or is it a manual bottleneck?

**Recommendation:** Before starting Phase 2, run a small spike (1–2 hours):
1. Create a test Supabase project (free tier).
2. Test Google OAuth with strategy #1 (stable proxy).
3. Document the flow in a runbook or update sections/02-frontend-strategy.md with the tested approach.

---

#### 5. Connection Pooling Split — Configuration Not Yet Wired

**Where:** design.md § 10 Risk #3, sections/04-deployment-cicd.md § 4 ("Secrets Management"), sections/05-backend-strategy.md § "Local Docker connected to Supabase"

**Issue:** The design correctly identifies that:
- **Web traffic (FastAPI, Server Actions)** should use PgBouncer pooled URL: `SUPABASE_DB_POOL_URL`.
- **Batch jobs and Alembic** should use direct connection: `SUPABASE_DB_DIRECT_URL`.

However:
- The GitHub Actions secrets configuration (design.md § 10 recommends storing both URLs) is not shown in sections/04-deployment-cicd.md.
- The `.env.local` guidance in section 04 does not distinguish between pooled and direct URLs.
- The Alembic migration step in Phase 1 (section 04, Phase 1 § "Run Alembic migrations against Supabase") does not explicitly state which URL to use.

**Recommendation:** Update sections/04-deployment-cicd.md (GitHub Actions Secrets section):
```
SUPABASE_DB_DIRECT_URL    → postgresql://... direct connection (for alembic, batch jobs)
SUPABASE_DB_POOL_URL      → postgresql://... PgBouncer pooled (for web traffic)
```

Also update Phase 1 migration step:
```bash
# Phase 1, step 2: Run alembic upgrade against DIRECT connection
alembic upgrade head  # uses SQLALCHEMY_DATABASE_URL or DATABASE_URL env var
# Ensure .env.local points to SUPABASE_DB_DIRECT_URL
```

---

### 🟢 Nits

#### 1. Domain/DNS Deferred — Mark as Decision Required

**Where:** design.md § 11 ("Open Questions for Review")

**Status:** Acknowledged in "Decisions still needed from Jony":
> Will the app use a custom domain (e.g., `trading-journal.example.com`) or just `*.vercel.app`? Affects OAuth configuration and stable callback URL strategy.

**Recommendation:** This is not a blocker, but it should be resolved **before Phase 2** begins, not after Phase 1. Add a placeholder to Phase 2:
> **Prerequisite:** Jony confirms custom domain plan. If using a custom domain, register it and configure DNS/SSL before connecting OAuth providers.

---

#### 2. Free-Tier Limits — Cite Specific 2026 Supabase Policies

**Where:** design.md § 1 (Executive Summary), § 4.3, § 8 (Cost Profile), and throughout

**Current text:**
> Supabase free tier: 500 MB storage, 2 concurrent connections, daily backups (7-day retention).

**Issue:** These numbers are current (as of 2026-05-01), but they may change. If this design is reviewed in mid-2026 or later, the limits could be outdated.

**Recommendation:** Add a note to design.md:
> **Free-tier limits verified:** 2026-05-01. Check [Supabase Pricing](https://supabase.com/pricing) before deploying. Major changes (e.g., new storage limit) require re-evaluation of cost projections in § 8.

---

#### 3. Vercel Egress Limits — Monitor Early

**Where:** design.md § 8, sections/04-deployment-cicd.md § 1

**Current text:**
> Vercel free tier: 100 GB egress/month; builds ≤ 2h

**Issue:** For a trading app with charts and financial data, bandwidth usage is hard to predict. If users are downloading PDFs, exporting CSVs, or fetching high-resolution charts, egress could spike.

**Recommendation:** Add to Phase 2 (Frontend to Vercel):
> **Monitor Vercel analytics after launch.** Check egress usage weekly. If approaching 80 GB/month with 5 users, upgrade to Vercel Pro ($20/mo). If <5 GB/month, remain on free tier.

---

#### 4. GitHub Actions Overages — Specify Thresholds

**Where:** sections/04-deployment-cicd.md § 1, design.md § 8

**Current text:**
> GitHub Actions: $0–2 (nightly cron ~100 min/month; well within free tier)

**Issue:** 2,000 min free tier is generous, but heavy CI (linting, testing, Docker builds) can add up. No threshold is specified for when to consider paid runners.

**Recommendation:** Add to Phase 0 validation:
> **GitHub Actions baseline:** Run `squad-ci.yml` + `squad-deploy.yml` + `squad-nightly.yml` locally and measure. If total < 1,000 min/month, remain on free tier. If > 1,500 min/month, consider paid runners or optimize build cache.

---

## Things the User Must Verify (Out-of-Date Risk)

1. **Supabase free-tier limits (2026):** Storage cap, concurrent connections, backup retention.
   - Action: Check https://supabase.com/pricing before Phase 1.
   - Risk: If limits have decreased, cost projections in § 8 are pessimistic.

2. **Supabase project freeze policy:** Does inactivity cause data loss? Can you restore from backup after freeze?
   - Action: Test on a trial project before relying on Supabase for critical financial data.
   - Risk: If backup recovery is not straightforward, add local `pg_dump` automation from Phase 1.

3. **Google OAuth + Supabase redirect URI validation (2026):** Can you use a stable proxy domain, or must each preview URL be explicitly allowlisted?
   - Action: Run the preview deploy spike in Phase 1 (1–2 hours).
   - Risk: If strategy #1 (stable proxy) fails, fallback to strategy #2 (per-PR allowlisting) is manual and could become a bottleneck.

4. **Vercel egress usage for trading app:** How much egress is typical for a household of 2–5 users with charts and exports?
   - Action: Monitor analytics in the first week of Phase 2.
   - Risk: If egress exceeds 100 GB/month sooner than expected (e.g., with video tutorials or large PDF exports), upgrade to Vercel Pro earlier.

5. **FastAPI + SQLModel + Supabase connection pooling:** Does `pool_pre_ping=True` and prepared statement cache disabling resolve transaction pool issues, or are deeper adapter changes needed?
   - Action: Hockney to verify in Phase 0 (local Supabase dev environment).
   - Risk: If pooling issues persist, consider hosted backend (Fly.io) earlier or implement a connection retry loop.

---

## Recommendation to Lead

**Proceed with Phase 0 and Phase 1 as outlined.** The design is solid and all deployment recommendations are present.

Before moving to **Phase 2 (Frontend to Vercel + Supabase Auth)**, ensure:

1. ✅ **Supabase free-tier limits confirmed** — run a test project, verify backup retention.
2. ✅ **Preview deploy OAuth strategy validated** — test the stable proxy callback flow or confirm fallback is acceptable.
3. ✅ **Custom domain decision made** — confirm DNS/SSL plan for production callback URL.
4. ✅ **Connection pooling tested** — verify `pool_pre_ping=True` works with SQLModel in the local environment.
5. ✅ **GitHub Actions secrets updated** — remove `CLERK_SECRET_KEY`, add both `SUPABASE_DB_DIRECT_URL` and `SUPABASE_DB_POOL_URL`.

All five are low-risk spikes (< 1 week total). No blockers to starting Phase 1.

---

## Minor Documentation Improvements for Next Update

- Add a troubleshooting section to sections/04-deployment-cicd.md: "Common failures during Phase 1 database cutover" (e.g., connection pool exhaustion, migration timeout).
- Add a runbook to sections/05-backend-strategy.md: "Local Docker healthcheck + restart on Supabase connection loss."
- Add a spike checklist to sections/02-frontend-strategy.md: "Preview deploy OAuth validation steps."
- Clarify .env.local setup guidance in sections/04-deployment-cicd.md: show both `DATABASE_URL` (direct, for local dev) and the distinction for production (pooled vs. direct).

---

**Sign-off:** Kujan (DevOps/Platform Engineer)  
**Date:** 2026-05-01
