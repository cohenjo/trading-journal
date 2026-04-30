# Decision: Encrypted pg_dump Backup Strategy (TJ-009)

**Date:** 2026-05-02
**Author:** Kujan (DevOps/Platform)
**Issue:** TJ-009 / GH #62
**Status:** Implemented

## Context

Supabase free tier provides no automated backups and no Point-in-Time Recovery. The only managed backups (7-day retention, dashboard-only) are a paid feature. We needed an encrypted off-site backup solution.

## Decision

Implement nightly `pg_dump` from a GitHub Actions runner, encrypted with `age` public-key encryption, stored as a 90-day GH artifact with an optional secondary store stub.

## Key Choices Made

| Choice | Rationale |
|--------|-----------|
| `pg_dump --format=custom` over `supabase db dump` | Custom format is smaller, supports parallel/selective restore, available without Supabase CLI |
| `age` over `gpg` | Modern, simple CLI (no keyring daemon), Bech32 key format, actively maintained by Filippo Valsorda |
| Direct URL (port 5432) | `pg_dump` is incompatible with PgBouncer transaction mode (port 6543) — must use direct connection |
| 90-day artifact retention | GitHub hard maximum; secondary store stub provided for longer retention |
| `--no-owner --no-privileges` on restore | Avoids role-name mismatches between different Supabase projects; RLS policies are preserved as DDL |
| Failure → auto GH issue | Ensures backup failures are not silently missed; tagged `priority:critical,squad:kujan` |

## Files Delivered

- `.github/workflows/nightly-backup.yml`
- `scripts/restore-from-backup.sh`
- `docs/design-hosting/operations/backup-and-restore.md`

## One-Time Setup Required (Jony)

1. `age-keygen -o ~/.config/age/trading-journal.key`
2. Add `AGE_PUBLIC_KEY` to GH secrets (the `age1...` public key)
3. Add `SUPABASE_PROD_DB_URL` to GH secrets (direct URL, port 5432)
4. Store private key in 1Password + offline location

## Impact on Other Team Members

- **Rabin (Security):** Backup files contain `auth.users` bcrypt hashes — `age` encryption is the security boundary; private key custody docs are in the backup-and-restore runbook.
- **Hockney (Backend):** Restore script targets `trades`, `positions`, `income_entries` for verification — update table list if schema changes.
- **Keaton (Lead):** Quarterly restore drill is now documented as an ops ceremony in `backup-and-restore.md` § 3.
