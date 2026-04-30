# Session: Hosting Runbook Split — Post-Batch Consolidation

**Date:** 2026-04-30  
**Requested by:** Jony Vesterman Cohen  
**Scribe:** Consolidating 7 parallel agent deliverables (Kujan, Rabin, Hockney, Fenster, Keaton) into unified documentation.

---

## Summary

**What happened:** Squad executed a parallel batch split of the hosting migration runbook. Kujan, Rabin, Hockney, Fenster, and Keaton each delivered 1–2 focused runbooks (supabase-01/02/03, vercel-01/02/03) covering infrastructure setup, deployment, and policy. The split revealed a critical finding: Supabase free tier supports 2 projects maximum, not 3 — requiring architectural adjustment to design.md.

**Files produced:**
- 6 runbook files (Supabase 3-part: local dev, remote, auth+RLS; Vercel 3-part: project, deploys, policy)
- 1 runbook index (`docs/design-hosting/runbooks/README.md`)
- 1 design.md edit (2-project topology, +17/-4 lines)
- 1 combined draft (kept for reference: setup-supabase.md)

**Critical finding:** Free tier topology → 2 projects (dev/preview shared + prod), not 3. Mitigations: per-PR seed reset or upgrade to Pro ($25/mo).

**Decisions merged:** 3 inbox entries (keaton-issue-decomposition, kujan-supabase-runbook, keaton-supabase-2project-topology) consolidated into `.squad/decisions.md`.

**Next:** Jony to verify free-tier constraints and choose region (`eu-central-1` recommended); TJ-001 can start once local setup validated.
