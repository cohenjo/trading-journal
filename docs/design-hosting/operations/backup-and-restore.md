# Backup and Restore Operations Guide

> **Owner:** Kujan (DevOps/Platform)
> **Last updated:** 2026-05-02
> **Related issue:** TJ-009 / GH #62
> **Related runbook:** `../runbooks/supabase-02-remote.md` § 7

---

## 1. Strategy Overview

### What Gets Backed Up

| Scope | Included | Notes |
|-------|----------|-------|
| Schema (DDL) | ✅ Yes | All tables, views, functions, RLS policies, indexes |
| Application data | ✅ Yes | All rows in all public-schema tables |
| Supabase Auth tables | ✅ Yes | `auth.users`, hashed passwords, provider tokens — pg_dump captures the full `auth` schema |
| RLS policies | ✅ Yes | Policies are stored as DDL objects, not privileges — they survive `--no-privileges` restore |
| Storage objects (files) | ❌ No | Supabase Storage bucket files are NOT included; dump only covers database rows |
| Realtime configuration | ⚠️ Partial | Channel config in the DB is included; Supabase dashboard settings are not |

> ⚠️ **Auth note:** Because `auth.users` password hashes (bcrypt) are included in the dump, anyone who decrypts the backup can see hashed passwords. Treat backup files as **highly sensitive credentials**. The `age` encryption in this setup protects them at rest; ensure the private key is guarded accordingly (see § 2.3).

### Backup Format

- **Tool:** `pg_dump --format=custom --compress=9`
- **Format:** PostgreSQL custom binary format — most flexible for selective restore; smallest compressed size
- **Encryption:** `age` public-key encryption (recipient: `AGE_PUBLIC_KEY` secret)
- **Output:** `.dump.age` file per run

### Schedule

| Trigger | Frequency | Time |
|---------|-----------|------|
| Scheduled | Daily | 03:00 UTC |
| Manual | On demand | `workflow_dispatch` |

### Retention

| Store | Retention | Cost |
|-------|-----------|------|
| GitHub Actions artifacts | **90 days** (hard maximum on any plan) | Free (included in Actions minutes/storage) |
| Secondary store (R2 / S3 / B2) | Configurable (recommended: 1 year) | See § 5 |

> ⚠️ **Free-tier note on PITR:** Supabase free tier has **no automated backups and no Point-in-Time Recovery**. The Supabase dashboard shows "7-day managed backups" only on Pro/Team plans. On the free tier, **this GitHub Actions nightly job is your only backup**. Do not rely on Supabase dashboard backups unless you are on a paid plan.

### Where Backups Are Stored

**Primary:** GitHub Actions artifact storage. Each run uploads the `.dump.age` file to the repository's artifact store. Accessible from the Actions UI at: `https://github.com/cohenjo/trading-journal/actions`.

**Secondary (optional):** A secondary off-site store (Cloudflare R2, AWS S3, or Backblaze B2) is configured as a commented stub in the workflow. Uncomment the relevant option to enable.

---

## 2. One-Time Setup (Jony's Checklist)

Complete these steps once before the first backup runs.

### 2.1 Generate an `age` Keypair

`age` (by Filippo Valsorda) is a modern, simple file encryption tool.

```bash
# Install age (macOS)
brew install age

# Generate a keypair
# - Private key (identity): ~/.config/age/trading-journal.key
# - Public key (recipient): printed to stdout, also stored in the key file header
age-keygen -o ~/.config/age/trading-journal.key
```

**Example output:**

```
Public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmrzlce
```

The public key is a `age1...` Bech32 string. Copy it — you'll add it to GitHub secrets next.

### 2.2 Add GitHub Secrets

Navigate to: `https://github.com/cohenjo/trading-journal/settings/secrets/actions`

Add the following **3 secrets**:

| Secret name | Value | Notes |
|-------------|-------|-------|
| `AGE_PUBLIC_KEY` | `age1ql3z7...` (the Bech32 public key from step 2.1) | Safe to store here — it's public by design |
| `SUPABASE_PROD_DB_URL` | `postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres` | **Must be the DIRECT URL (port 5432)** — see § 2.3 |
| *(optional secondary)* | Keys for R2 / S3 / B2 if using secondary store | Only needed if you uncomment a secondary store in the workflow |

> ⚠️ **Port 5432, not 6543:** `pg_dump` requires a direct PostgreSQL connection. The transaction-pooler URL (port 6543, PgBouncer) does **not** work with `pg_dump` — it breaks because `pg_dump` uses session-level features (`SET`, `LOCK TABLE`, `COPY`) incompatible with transaction-mode pooling. Always use the **Direct** URL from: **Supabase Dashboard → Project Settings → Database → Connection string → URI mode → Direct**.

### 2.3 Store the Private Key OFF-SITE (Critical)

> ⚠️ **WARNING:** If you lose the private key (`~/.config/age/trading-journal.key`), **all encrypted backups become permanently unreadable**. There is no recovery mechanism. Treat this key like a master password.

**Required:** Store the private key in at least **two** of these locations outside the repo:

| Location | Instructions |
|----------|-------------|
| **1Password** (primary) | Create a new Secure Note: "Trading Journal age backup key". Paste the full contents of `~/.config/age/trading-journal.key` |
| **Encrypted USB drive** (offline) | Copy the key file to an offline encrypted drive stored physically separately from your laptop |
| **Trusted cloud (encrypted)** | Bitwarden / iCloud Keychain — encrypt the file first if using a generic cloud service |

**Never:**
- ❌ Commit the private key to this repository
- ❌ Add it to GitHub secrets (the workflow only needs the public key for encryption)
- ❌ Store it only on your laptop (single point of failure)

---

## 3. Restore Drill Runbook (Quarterly)

Run this drill every quarter to verify backups are actually restorable.

> **Goal:** Confirm that a backup from the last 7 days can be decrypted and restored to a scratch database, and that row counts match expectations.

### Step 1: Download the Latest Artifact

1. Go to: `https://github.com/cohenjo/trading-journal/actions/workflows/nightly-backup.yml`
2. Click the most recent successful run.
3. Under **Artifacts**, download `trading-journal-backup-YYYYMMDD-HHMMSS.dump.age`.
4. Note the SHA-256 shown in the workflow summary and keep it for verification.

### Step 2: Verify the SHA-256 Checksum

```bash
# Verify integrity of the downloaded file
sha256sum trading-journal-backup-*.dump.age
# Compare output against the SHA-256 logged in the workflow summary
```

### Step 3: Spin Up a Scratch Supabase Project

1. Go to Supabase dashboard → **New project**
2. Name: `trading-journal-restore-drill-YYYYMMDD`
3. Region: `eu-central-1`
4. Copy the **Direct** connection string (port 5432).

### Step 4: Run the Restore Script

```bash
export AGE_IDENTITY_FILE=~/.config/age/trading-journal.key

./scripts/restore-from-backup.sh \
  trading-journal-backup-YYYYMMDD-HHMMSS.dump.age \
  "postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres"
```

### Step 5: Run Sanity Queries

```sql
-- Connect with psql or Supabase Dashboard → SQL Editor

-- 1. Most recent trade (should match production)
SELECT MAX(created_at) AS latest_trade FROM trades;

-- 2. Row counts (compare against known baseline)
SELECT
  (SELECT COUNT(*) FROM trades)         AS trade_count,
  (SELECT COUNT(*) FROM positions)      AS position_count,
  (SELECT COUNT(*) FROM income_entries) AS income_count;

-- 3. Auth users present
SELECT COUNT(*) AS user_count FROM auth.users;

-- 4. Data freshness — most recent row across key tables
SELECT 'trades' AS tbl, MAX(created_at) FROM trades
UNION ALL
SELECT 'positions', MAX(created_at) FROM positions;
```

### Step 6: Document Results

Fill in this table and save to the drill log (keep in your password manager or 1Password note):

| Field | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| trade_count | ~N (from last drill) | — | — |
| position_count | — | — | — |
| income_count | — | — | — |
| latest_trade timestamp | within 24h of backup date | — | — |
| Total restore time | < 5 min | — | — |

### Step 7: Destroy the Scratch Project

After the drill, delete the scratch project from the Supabase dashboard to avoid incurring quota usage against the free-tier 2-project limit.

---

## 4. Disaster Recovery Scenarios

### Scenario A: "I accidentally deleted prod data"

**Severity:** High — data loss, but project is still running.

1. **Immediately stop further writes** if possible (e.g., set app to maintenance mode or revoke the DB URL from Vercel env vars).
2. Identify which data was deleted and when (use Supabase Studio → Table Editor → filter by `created_at`).
3. Download the most recent backup artifact from GH Actions (before the deletion event).
4. Spin up a **new scratch Supabase project** (do NOT restore to prod directly).
5. Run the restore script against the scratch project.
6. **Manually copy back** only the affected rows using `pg_dump --table=<table> --where="..."` + `psql COPY` or direct INSERT.
7. Verify the prod DB looks correct before re-enabling writes.
8. Post an incident summary to the squad.

> ⚠️ Never use `pg_restore --clean` against prod without a fresh snapshot. It will **drop and recreate all objects**, causing extended downtime.

### Scenario B: "Supabase project paused or deleted"

**Severity:** Medium–High — full outage but data may be recoverable from backup.

**If paused (free-tier inactivity):**
1. Log in to Supabase dashboard and click **Restore** on the paused project.
2. The project resumes; data is preserved. No restore needed.
3. Prevent future pauses: keep the app active or upgrade to Pro.

**If deleted (accidental or billing lapse):**
1. Contact Supabase support immediately — deleted projects may be recoverable within 24–72h.
2. If unrecoverable, provision a new Supabase project: follow `supabase-02-remote.md` §2–4.
3. Apply migrations: `supabase db push --project-ref <new-ref>`.
4. Restore from the most recent backup artifact using `restore-from-backup.sh`.
5. Update `SUPABASE_PROD_DB_URL` in GH secrets and all Vercel environment variables.
6. Verify auth callbacks and redirect URIs still work (see `supabase-03-auth-rls.md`).

### Scenario C: "Encryption key (age private key) lost"

**Severity:** CRITICAL — backups are permanently unreadable.

> ⛔ **Recovery is IMPOSSIBLE.** Age encryption is asymmetric and non-reversible without the private key. There is no backdoor, no key escrow, and no way to recover data from an `.age` file without the matching identity file. **All encrypted backup files become permanently useless.**

**Immediate actions:**
1. Generate a new `age` keypair (see § 2.1).
2. Update the `AGE_PUBLIC_KEY` GitHub secret with the new public key.
3. Manually trigger the backup workflow (`workflow_dispatch`) to create a new backup with the new key.
4. Accept the data-loss window: the last uncorrupted data state you can recover is whatever is currently in the live Supabase database.
5. If prod is still running, dump it immediately with the new key as a fresh baseline.
6. Store the new private key in multiple locations (see § 2.3).

**Prevention:**
- The only prevention is proper key storage (§ 2.3). Do it now, not after a loss event.

---

## 5. Cost Estimate

### GitHub Actions Minutes

| Component | Estimate |
|-----------|----------|
| pg_dump runtime (small DB, ~10MB) | ~30 seconds |
| age encryption | ~2 seconds |
| Artifact upload | ~10 seconds |
| **Total per run** | **~60–90 seconds** |
| Monthly total (30 days) | ~45 minutes |
| GitHub Free tier included | 2,000 min/month |
| **Cost** | **$0** (trivial; well within free quota) |

### Artifact Storage

| Component | Size | Cost |
|-----------|------|------|
| One backup file (small DB) | ~5–20 MB encrypted | — |
| 90 days retention × 30 days/month | ~30 files × 15 MB = ~450 MB | GitHub Free: 500 MB artifact storage included |
| **Cost** | — | **$0** for a small trading DB |

### Secondary Store (if enabled)

| Provider | Free tier | Estimated cost |
|----------|-----------|---------------|
| Cloudflare R2 | 10 GB free, 1M ops free | **$0** for this workload |
| AWS S3 (eu-central-1) | None | ~$0.023/GB/month = **<$0.01/month** |
| Backblaze B2 | 10 GB free | **$0** for this workload |

> **Recommendation:** Cloudflare R2 is the best secondary store for this use case — it's free for this data volume, has no egress fees, and is geographically distributed.

---

## 6. Limitations and Known Constraints

### What pg_dump Does NOT Capture

| Item | Included | Notes |
|------|----------|-------|
| Supabase Storage bucket files | ❌ No | Only the `storage.objects` metadata rows are captured, not the actual files in object storage |
| Supabase dashboard settings | ❌ No | Email templates, SMTP config, OAuth provider settings |
| Edge Function source code | ❌ No | Stored in Supabase dashboard; back up separately or keep in-repo |
| Realtime channel config | ⚠️ Partial | Only what's stored as DB rows |
| Supabase project-level settings | ❌ No | API URL, anon key, JWT secret — document separately |

### pg_dump vs Supabase CLI dump

This workflow uses native `pg_dump` rather than `supabase db dump` because:
1. `pg_dump --format=custom` produces a smaller, more flexible output than the SQL text format used by `supabase db dump`
2. `pg_dump` is available on the GitHub-hosted runner without installing the full Supabase CLI
3. Custom format supports parallel restore and selective table restore

**Trade-off:** `supabase db dump` applies Supabase-specific filters (e.g., excludes `pg_*` system tables). This `pg_dump` approach includes more schema detail, which is generally beneficial for full restores.

### Artifact Retention Hard Limit

GitHub Actions artifact retention is **capped at 90 days on all plans** (free and paid). Artifacts older than 90 days are automatically deleted. If you need longer retention, the secondary store (R2 / S3 / B2) is mandatory.

### Direct URL Requirement

`pg_dump` and `pg_restore` require the **direct PostgreSQL connection** (port 5432). The transaction-pooler URL (port 6543, PgBouncer) is incompatible because `pg_dump` uses:
- Session-level `SET` commands
- `LOCK TABLE` with access-share locks
- `COPY` protocol in streaming mode

Always use the direct URL in `SUPABASE_PROD_DB_URL`. Find it at: **Dashboard → Project Settings → Database → Connection string → Direct**.

### Auth Data in Backups

The `auth` schema (including `auth.users`, `auth.sessions`, `auth.mfa_factors`) is included in the backup because `pg_dump` without `--schema=public` captures all schemas. This is intentional — it allows a full restore including user accounts. However, it means:
- Backup files contain bcrypt-hashed passwords
- Backup files contain OAuth refresh tokens (if any)
- **Treat all backup files as highly sensitive** — encryption via `age` provides the necessary protection at rest

---

## 7. Cross-References

| Resource | Link |
|----------|------|
| Nightly backup workflow | `.github/workflows/nightly-backup.yml` |
| Restore script | `scripts/restore-from-backup.sh` |
| Supabase remote provisioning | `../runbooks/supabase-02-remote.md` |
| Supabase Auth / RLS | `../runbooks/supabase-03-auth-rls.md` |
| Related GH issue | `cohenjo/trading-journal#62` (TJ-009) |
