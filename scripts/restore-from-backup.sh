#!/usr/bin/env bash
# ============================================================================
# restore-from-backup.sh — Decrypt and restore a trading-journal pg_dump backup
#
# Usage:
#   ./scripts/restore-from-backup.sh <encrypted-file> <target-db-url>
#
# Environment variables required:
#   AGE_IDENTITY_FILE  — path to your age private key file
#                        (e.g. ~/.config/age/trading-journal.key)
#
# Example:
#   AGE_IDENTITY_FILE=~/.config/age/trading-journal.key \
#     ./scripts/restore-from-backup.sh \
#     trading-journal-backup-20260501-030000.dump.age \
#     "postgresql://postgres:pass@db.xxxx.supabase.co:5432/postgres"
#
# ⚠️  WARNING — READ BEFORE RUNNING
# ─────────────────────────────────────────────────────────────────────────────
# NEVER restore directly to a production database without first:
#   1. Taking a manual snapshot/dump of the current prod data.
#   2. Verifying the backup is the correct point-in-time you intend to restore.
#   3. Notifying any active users of the downtime window.
#
# --clean + --if-exists will DROP all existing objects before recreating them.
# Restoring to prod without a snapshot means that data is UNRECOVERABLE.
#
# This script is intended for:
#   - Restore drills against a scratch / dev Supabase project
#   - Disaster recovery to a NEW Supabase project (not prod)
#
# ⚠️  IMPORTANT: Use the DIRECT connection URL (port 5432), NOT the pooler
# URL (port 6543). pg_restore is incompatible with PgBouncer transaction mode.
# ============================================================================

set -euo pipefail

# ── Argument validation ──────────────────────────────────────────────────────
if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <encrypted-file> <target-db-url>" >&2
  exit 1
fi

ENCRYPTED_FILE="$1"
TARGET_DB_URL="$2"

if [[ ! -f "$ENCRYPTED_FILE" ]]; then
  echo "Error: encrypted file not found: $ENCRYPTED_FILE" >&2
  exit 1
fi

if [[ -z "${AGE_IDENTITY_FILE:-}" ]]; then
  echo "Error: AGE_IDENTITY_FILE environment variable is not set." >&2
  echo "  Example: export AGE_IDENTITY_FILE=~/.config/age/trading-journal.key" >&2
  exit 1
fi

if [[ ! -f "$AGE_IDENTITY_FILE" ]]; then
  echo "Error: age identity file not found: $AGE_IDENTITY_FILE" >&2
  exit 1
fi

# ── Dependency checks ────────────────────────────────────────────────────────
for cmd in age pg_restore psql; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: required command not found: $cmd" >&2
    exit 1
  fi
done

echo "=== Trading Journal Restore Script ==="
echo "Encrypted file : $ENCRYPTED_FILE"
echo "Target DB      : $(echo "$TARGET_DB_URL" | sed 's|:.*@|:***@|')"
echo "Identity file  : $AGE_IDENTITY_FILE"
echo ""

# ── Step 1: Decrypt the backup ───────────────────────────────────────────────
# age -d decrypts; -i specifies the private key identity file.
# The decrypted file is a pg_dump custom-format binary (.dump).
DECRYPTED_FILE="${ENCRYPTED_FILE%.age}"

echo "[1/3] Decrypting backup..."
age -d -i "$AGE_IDENTITY_FILE" -o "$DECRYPTED_FILE" "$ENCRYPTED_FILE"
echo "      Decrypted → $DECRYPTED_FILE ($(du -sh "$DECRYPTED_FILE" | cut -f1))"

# ── Cleanup trap: remove decrypted dump when script exits ────────────────────
cleanup() {
  if [[ -f "$DECRYPTED_FILE" ]]; then
    rm -f "$DECRYPTED_FILE"
    echo ""
    echo "[cleanup] Removed plaintext dump: $DECRYPTED_FILE"
  fi
}
trap cleanup EXIT

# ── Step 2: Restore to target database ──────────────────────────────────────
# Flags:
#   --clean         DROP objects before recreating (ensures clean state)
#   --if-exists     suppress errors on DROP if object doesn't exist
#   --no-owner      skip SET ROLE / ALTER OWNER — avoids role-name mismatches
#                   between source and target Supabase projects
#   --no-privileges skip GRANT/REVOKE — RLS policies ARE preserved (they're
#                   stored as objects, not privileges)
#   --single-transaction  wrap restore in one transaction for atomicity
echo "[2/3] Restoring to target database..."
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --dbname="$TARGET_DB_URL" \
  "$DECRYPTED_FILE"
echo "      Restore complete."

# ── Step 3: Verification queries ─────────────────────────────────────────────
# Count rows in three representative tables to confirm data landed correctly.
# Update table names if your schema differs.
echo "[3/3] Running verification queries..."
echo ""

TABLES=("trades" "positions" "income_entries")

for TABLE in "${TABLES[@]}"; do
  COUNT=$(psql "$TARGET_DB_URL" --no-psqlrc --tuples-only --quiet \
    -c "SELECT COUNT(*) FROM \"${TABLE}\";" 2>/dev/null || echo "N/A (table may not exist)")
  printf "  %-20s %s rows\n" "${TABLE}:" "$(echo "$COUNT" | xargs)"
done

echo ""
echo "=== Restore complete. Verify the counts above against your last known baseline. ==="
echo ""
echo "Suggested sanity queries to run manually:"
echo "  SELECT MAX(created_at) FROM trades;           -- most recent trade"
echo "  SELECT COUNT(*) FROM trades WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW());"
echo "  SELECT SUM(amount) FROM income_entries;       -- total income sum"
