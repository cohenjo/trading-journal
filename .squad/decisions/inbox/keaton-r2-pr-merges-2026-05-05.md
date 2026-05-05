# Keaton R2 PR review + cleanup — 2026-05-05

## PRs merged
- **#271** (Kujan backup fix): squash-merged — closes #266
  - Root cause: ubuntu-22.04 runner dropped `postgresql-client-15` from default APT on v20260413.88.1
  - Fix verified: PGDG signing key fetched over HTTPS, stored in `/etc/apt/keyrings/`, signed-by sources.list.d entry, second `apt-get update` before install, `postgresql-client-15` version pin unchanged
  - CI: all required checks green; runner stays on ubuntu-22.04
- **#272** (Redfoot E2E fix): squash-merged — closes #267
  - Root cause: `dividend_accounts` missing from `cleanupHouseholdData()` Promise.allSettled block
  - Fix verified: single-line addition in correct FK deletion order
  - CI: all required checks green

## Issues closed
- **#266** — auto-closed on merge of #271 (COMPLETED)
- **#267** — auto-closed on merge of #272 (COMPLETED)
- **#99** — stale meta-tracker, closed as "not planned"

## Follow-ups noted
- **Kujan**: audit why GitHub Secrets went empty on 2026-05-03 (ref: #162); add a secret health-check step to nightly workflow
- **Rabin/Hockney**: investigate why `deleteE2eUser` still fails with `Database error deleting user` after cleanup — other tables may not be covered by `cleanupHouseholdData` blocking the user cascade (ref: #272 PR body)
