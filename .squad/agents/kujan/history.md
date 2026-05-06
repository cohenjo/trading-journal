# Project Context

- **Owner:** Jony Vesterman Cohen
- **Project:** Personal finance and trading application
- **Agent:** Kujan (DevOps/Platform)
- **Created:** 2026-02-23T22:46:19Z

## Summary

DevOps/Platform engineer. Owns Supabase infrastructure, Docker/Aspire setup, CI/CD pipelines, pre-commit hooks, secret scanning hardening, E2E CI configuration, and deployment runbooks.

## Recent Focus (2026-05-01 onwards)

- Supabase branching vs 2-project model evaluation (Pro-only; free tier = 2-project)
- E2E CI webserver fixes (Chromium-only, ghc timing)
- E2E CI workflow wiring (smoke/auth/full nightly; deployment-triggered)
- Secret scanning hardening (gitleaks, .gitignore, pre-commit, GitHub push protection)
- E2E safety admin check (single-Supabase opt-in for personal projects)

**Key decisions merged in reskill pass (2026-05-05):**
- TJ-019: Local Docker compute backend + tunnel (cloudflared recommended)

**For detailed historical context, see `history-archive.md`.**

📌 **Team update (2026-05-05T18:32:37Z):** TJ-019 local Docker compute backend + tunnel decision merged into shared decisions. Reskill pass complete. — Scribe (wind-down)

📌 Team update (2026-05-06): FLEX backfill chunking pattern (monthly chunks) + checkpoint resume now in backfill_options.py — useful precedent for #65 (Postgres backfill) and multi-chunk import work — decided by Hockney

📌 Team update (2026-05-06): Transport retry pattern for external HTTP APIs — two-tier strategy (short backoff for network hiccups, long backoff for app throttle). Useful for any external API integration. See decisions.md entry from 2026-05-06. — decided by Hockney
