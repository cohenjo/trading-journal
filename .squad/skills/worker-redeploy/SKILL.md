---
name: worker-redeploy
description: Rebuild the backend Docker worker container after any code change to apps/backend/app/worker/, Dockerfile, or dependency files
author: Hockney (Backend Dev)
created: 2026-05-12
tags: [backend, docker, worker, ops, round8-meta]
applies_to:
  - apps/backend/app/worker/**
  - apps/backend/Dockerfile
  - apps/backend/pyproject.toml
  - apps/backend/uv.lock
---

# Worker Redeploy Skill

## Why this skill exists

In May 2026, Rounds 5–8 of the trading-journal currency bug traced back to a single, silent failure: **the Docker worker container was never rebuilt after PR #420 was merged.** That PR contained the correct GBp/ILA normalisation code — but the live container kept running the old binary. Every night at 06:59 UTC the stale worker's daily refresh overwrote the correctly-migrated DB values with wrong math, producing a full week of confused user reports and four reactive PRs (#417 → #425).

The container has no automatic image-sync mechanism. Code changes in `apps/backend/` do **not** take effect until the container is explicitly stopped, rebuilt with `--no-cache`, and restarted. This skill encodes the rebuild protocol so it is never skipped again.

## When to invoke

Invoke this skill **immediately after merging** (or before deploying) any PR that touches:

| Path | Why |
|---|---|
| `apps/backend/app/worker/**` | Scheduler, refresh logic, currency maths |
| `apps/backend/Dockerfile` | Runtime environment, Python version, base image |
| `apps/backend/pyproject.toml` | Dependency declarations |
| `apps/backend/uv.lock` | Pinned dependency tree |

> **Do not wait for the next scheduled run.** If the stale container fires first, the damage is done silently.

## The procedure — automated script

From the repository root:

```bash
./scripts/rebuild-worker.sh
```

Phases the script executes:

| Phase | What it does |
|---|---|
| A — Pre-flight | Verify docker + compose, show current image SHA and container age, warn on dirty tree |
| B — Stop & rm | `docker compose stop` then `rm -f` |
| C — Build | `docker compose build --no-cache` (timed) |
| D — Deploy | `docker compose up -d` + poll healthcheck up to 60 s + last 30 log lines |
| E — **Verify** | Confirm new image SHA ≠ old SHA; trigger `refresh_stock_positions()` and print result |
| F — Summary | Old SHA → New SHA, build time, refresh result |

Script flags:

```
--force       Skip dirty-tree check
--prune       Remove old image after rebuild
--no-verify   Skip Phase E (offline / CI)
--dry-run     Print all commands without executing
--help        Usage
```

## Manual fallback

If the script is unavailable, run these exact commands (as Hockney-15 did on 2026-05-12):

```bash
docker compose -f docker-compose.backend.yml stop backend
docker compose -f docker-compose.backend.yml rm -f backend
docker compose -f docker-compose.backend.yml build --no-cache backend
docker compose -f docker-compose.backend.yml up -d backend
sleep 10
docker logs trading_journal_backend_supabase --tail 30
docker exec trading_journal_backend_supabase uv run python -c \
  "from app.worker.yahoo_refresh import refresh_stock_positions; print(refresh_stock_positions())"
```

Expected refresh output: `{'refreshed': ~297, 'skipped': ~17, 'failed': ~7}` (failed = delisted tickers — normal).

## Coordinator routing rule

When Copilot (or any squad member) merges a PR whose diff touches any `applies_to:` path listed in this skill's frontmatter, the task is **INCOMPLETE** until:

1. `./scripts/rebuild-worker.sh` has run successfully on the host machine, **or**
2. A human operator has confirmed a manual rebuild was performed.

Surface this skill automatically when reviewing such PRs. Include a checklist item in the PR description:

```
- [ ] Worker container rebuilt (`./scripts/rebuild-worker.sh`) ← REQUIRED before next scheduled run
```

## Verification checklist

After rebuilding, confirm all of the following before marking complete:

- [ ] **Image SHA changed** — `docker inspect trading_journal_backend_supabase --format='{{.Image}}'` returns a different digest than before the rebuild
- [ ] **Healthcheck passed** — container status is `healthy` within 60 s
- [ ] **One refresh completes** — `refresh_stock_positions()` returns without exception; `refreshed` count > 0
- [ ] **≥1 DB row matches expected value** — spot-check a known position:
  - BARC market_value ≈ £8,897 (not £926k)
  - LUMI dividend_yield ≈ 0.0456 (not 0.039 or 3.9)

## History

| Date | Event |
|---|---|
| 2026-05-12 | Round 8 root cause confirmed: stale image `33fd12cab77e` (built 2026-05-11 pre-PR-#420) ran daily refresh at 06:59 UTC, overwriting migration `20260512090000`'s corrections. Hockney-15 rebuilt to image `f524b85d7383` (PR #425). This skill created as Round 8 Phase 2.5 meta-fix. |
| — | PR #420 (`d853426`): correct GBp/ILA normalisation code — the code that was silently inactive for ~1 week |
| — | Migration `20260512090000`: corrected 8 LSE market_values and nulled 15 bad yields — undone by stale container 30 min later |
| — | Issue #423: architectural fix deferred (Keaton) |
