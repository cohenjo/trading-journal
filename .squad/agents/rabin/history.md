# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application covering financial planning, income tracking, and options trading workflows.
- **Stack:** TypeScript/React frontend, Python/FastAPI backend, PostgreSQL, Aspire, Copilot SDK
- **Agent:** Rabin (Security Engineer)
- **Created:** 2026-02-23T22:46:19Z

## Summary of Work

### Phase 0: Security Foundations (Feb–May 2026)

**Initial Assessment (2026-02-23):** Identified critical vulnerabilities in initial codebase: exposed credentials (IB accounts), zero authentication across 17 API endpoints, unrestricted CORS, missing security headers. Recommended 2–3 week hardening plan.

**Auth & RLS Design (2026-04-30):** Led architecture design for Supabase Auth + household sharing. Wrote comprehensive runbook, migration files, and pgTAP test suite (581 tests). Established security definer patterns for RLS helper functions with strict `search_path` configuration (`public, pg_temp`).

**RLS Audit & Coverage (2026-05-01–05-13):** Verified 9 frontend-direct CRUD targets have full RLS protection. Discovered and fixed RLS anti-pattern: enabled RLS on reference tables (`security_reference`, `tase_yahoo_map`) per canonical pattern (RLS enabled + permissive SELECT, not disabled).

**Incident Response (2026-05-03):** Handled security incident INC-2026-05-03-001 — Supabase service-role key leaked in `.squad/decisions.md`. Rotated key, hardened `.gitignore`, filed incident report, established secret-handling policy (secrets in `.env.local` only, pre-commit gitleaks, push protection enabled).

**Supabase Platform Changes Review (2026-05-14):** Reviewed Supabase announcements (default grants removal, API security, @supabase/server). Identified 30 legacy tables with anon grants (enforce Oct 30 deadline) and P0 fix for `household_audit_log`. Drafted conventions for explicit grants, JWT migration, and reference-table SELECT-only pattern.

### Key Learnings

1. **RLS Correctness:** Strict `search_path` configuration (`public, pg_temp`) prevents temp-table injection. All SECURITY DEFINER helpers must use explicit paths. pgTAP is essential for RLS scenario validation.

2. **Reference Data Pattern:** Global reference data (no household_id) should have RLS ENABLED + permissive SELECT policy (using `true`), NOT disabled. This satisfies Supabase advisor requirements and maintains audit compliance.

3. **Secret Handling:** Rotate service-role keys on every leak (they're JWTs). Pre-commit scanning + push protection + `.env.local` discipline prevent most exposure. History rewrite not necessary if key rotation invalidates it.

4. **Household Lifecycle:** household_id is NOT auto-set by database; both frontend and backend must inject from session context. RLS validates ownership; type system must prevent omission.

5. **Anon Access:** Never grant anon SELECT on sensitive tables (even with RLS). Reference tables are OK with RLS + permissive policy. 30 legacy tables need backfill by May 20. P0: `household_audit_log` revoke.

6. **JWT Security:** Legacy HS256 keys (symmetric) should migrate to asymmetric before Oct 30. Frontend (@supabase/ssr) + backend review both needed.

**Advisory Triage & Next.js Security Audit (2026-06-04):** Triaged a suspicious "Outdated Next.js detected" message Jony received. Confirmed it was social-engineering-style phrasing (no CVE, "device secure", "your copy") but mapped to a real version drift. Ran `npm audit` and found next@16.2.6 bundles postcss@8.4.31 (vulnerable to GHSA-qx2v-qp2m-jg93, CVE-2026-41305, CVSS 6.1 moderate XSS). Confirmed next@16.2.7 is real and latest but still bundles postcss@8.4.31 — upgrade alone does not clear the audit. Issued routine bump recommendation: next@16.2.7 + postcss overrides to 8.5.10+. Documented phishing pattern indicators and established advisory-triage policy and reusable skill.

### Active Decision Merges

- `rabin-auth-sharing.md` (merged 2026-04-30)
- `rabin-secret-handling-policy.md` (merged 2026-05-03)
- Supabase platform changes consolidated into main decisions (2026-05-14)

---

## Team Updates

📌 **Team update (2026-02-23T22:59:59Z):** Security Hardening consolidated - CRITICAL: credentials exposed in git, zero authentication across 17 API endpoints, unrestricted CORS, missing security headers. Week 1 actions: rotate credentials immediately, implement JWT auth, restrict CORS, add security headers middleware. Application MUST NOT be deployed to production in current state. Estimated 2-3 weeks to production-ready. — Keaton, Hockney, Rabin

📌 **Team update (2026-04-30T15:00:37Z):** Hosting design v1 approved — full-stack architecture (Vercel/Supabase/Next.js/FastAPI-local) with household sharing, RLS auth, and phased migration plan. Team consensus reached after research + synthesis + review + revision cycles.

📌 **Team update (2026-05-02T09:03:04Z):** DB-trigger SECURITY DEFINER is canonical for cross-RLS provisioning. When inserting on behalf of user (e.g., household_members), only SECURITY DEFINER functions can bypass RLS. Applies to user signup provisioning: handle_new_auth_user (profile) and handle_new_user_household chains. — Coordinator

📌 **Team update (2026-05-05T18:32:37Z):** Secret handling policy decision merged into shared decisions. Reskill pass extracted secret-handling-policy skill (high confidence) with defense-in-depth patterns, pre-commit scanning, push protection, and rotation response. — Scribe (wind-down)

📌 **Team update (2026-05-13T18:32:37Z):** RLS migration for reference tables (`security_reference`, `tase_yahoo_map`) successfully applied to remote Supabase. Migration follows correct security pattern: RLS enabled, SELECT policies for authenticated users, no anonymous access, service_role retains ALL privileges. Supabase advisor ERROR-level security findings now cleared.

📌 **Team update (2026-05-14T19:40:00Z):** Supabase security review complete — 30 anon-exposed tables + household_audit_log P0 fix + JWT migration to June. Recommendations merged into shared roadmap. — Rabin

📌 **Team update (2026-05-29T122212Z):** Credit-Card Expense Analysis Pipeline architecture proposal completed by Keaton. Work items CC-1..CC-14 pending Jony sign-off on Section 8 blockers. Your assignments coming imminently.

📌 **Team update (2026-06-04T10:51:29.757+03:00):** Advisory triage complete — suspicious "Outdated Next.js" alert analyzed as social-engineering-style (no CVE/GHSA, consumer-device language). Real finding: next@16.2.6 bundles postcss@8.4.31 (GHSA-qx2v-qp2m-jg93, moderate XSS). Recommendation: routine bump to next@16.2.7 + postcss override ≥8.5.10. Policy and skill created. — Rabin

## Learnings

### Next.js Advisory Channels (2026-06-04)

**Authoritative advisory sources for Next.js:**
1. **GitHub Security Advisories (GHSA):** `https://github.com/vercel/next.js/security/advisories` — primary source; each advisory has GHSA-xxx-xxx-xxx ID, CVE, severity, affected/patched versions, and a technical description.
2. **GitHub Dependabot alerts:** Filed as issues/PRs referencing GHSA IDs with specific remediation steps.
3. **npm audit:** Cites GHSA advisory URLs directly. Lists affected package ranges and suggested fix versions.
4. **Vercel security blog / Next.js blog:** `https://nextjs.org/blog` — announced simultaneously with GHSA for high/critical advisories. Always references CVE IDs.
5. **CVE databases:** NVD, Mitre, SentinelOne — republish GHSA findings with CVSS vectors.

**What legit advisory language looks like:**
- "GHSA-xxxx-xxxx-xxxx: [title] affecting next@<16.2.5"
- "This CVE (CVE-20xx-xxxxx) affects your dependency `next` at version X.Y.Z"
- "Severity: CRITICAL (CVSS 9.1)"
- References fix in a specific version: "Fixed in 16.2.5+"
- Includes remediation: "Run `npm install next@16.2.7`"

### CVE Landscape for next@16.2.6 (as of 2026-06-04)

- **GHSA-qx2v-qp2m-jg93 (CVE-2026-41305):** PostCSS < 8.5.10 XSS via unescaped `</style>`. next@16.2.6 bundles postcss@8.4.31 internally — this is the active `npm audit` finding. CVSS 6.1 (moderate). Practical risk low for this app (no user-submitted CSS processing), but audit signal is real.
- **CVE-2026-44578:** Critical SSRF in WebSocket-Upgrade handler in self-hosted Next.js — fixed in 16.2.5. Already resolved in our 16.2.6 install.
- **13 CVEs batch-fixed in 16.2.6 (May 2026):** SSRF (CVE-2026-44578), middleware bypass, CSP-nonce XSS, DoS via image optimizer, cache poisoning in RSC, dynamic route injection. All patched at our current version.
- **next@16.2.7:** Available on npm as `latest`. Still bundles postcss@8.4.31 (same version), so does NOT clear the audit finding unilaterally. Likely contains bug fixes and minor hardening on top of 16.2.6's security release.

### Phishing Pattern Indicators in "Outdated Dependency" Alerts

Red flags that distinguish social-engineering from legitimate dependency alerts:
1. **Consumer device language** — "keep your device secure": SAST/Dependabot/npm audit never refer to a developer's device; they refer to applications, repositories, or projects.
2. **Non-technical possession phrasing** — "your Next.js copy": legitimate tooling says "your dependency", "your application", "the `next` package in your project".
3. **No CVE or GHSA ID** — every real advisory has at least one of these; their absence is a red flag.
4. **No severity rating** — npm audit always states Severity: moderate/high/critical; Dependabot tags advisory level.
5. **No specific version range** — real advisories state exact affected ranges like `>= 9.3.4-canary.0, < 16.2.5`.
6. **No link to authoritative source** — real alerts link to GHSA, CVE, or npm advisory page.
7. **Urgency without specificity** — "please update" without explaining what exploit is mitigated.

Social-engineering prompts often latch onto real version drift to increase credibility. Always verify independently against npm audit, GHSA, or Dependabot before acting on any unsolicited "update" prompt.

## 2026-06-04: PostCSS CVE Triage (GHSA-qx2v-qp2m-jg93)

**Alert:** "device not secure" unsolicited message — flagged as phishing (7/7 red flags)
**Real CVE Found:** GHSA-qx2v-qp2m-jg93 (CVE-2026-41305) in postcss@8.4.31 bundled by next@16.2.7
**Mitigation:** Override postcss to ^8.5.10 (applied by Fenster in commit 2eb1ca0)
**Outcome:** CVE cleared; audit diff now clean

**Decision authored:** "Treat Unsolicited Dependency Alerts as Phishing-by-Default"
**Skill authored:** `.squad/skills/triage-dependency-advisory/SKILL.md`

**Related decision:** Merged to `.squad/decisions.md` on 2026-06-04T11:00 UTC
