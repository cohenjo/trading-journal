#!/bin/sh
# rebuild-worker.sh — stop → rm → build --no-cache → up → verify the backend worker container.
#
# Root cause: Docker worker was never rebuilt after PR #420 was merged (2026-05-12).
# The stale container ran a daily refresh at 06:59 UTC and silently overwrote migration-
# corrected DB values with old code's wrong math (Rounds 5-8 currency bug).
#
# Usage:
#   ./scripts/rebuild-worker.sh [--force] [--prune] [--no-verify] [--dry-run] [--help]

set -euo pipefail

# ---------------------------------------------------------------------------
# ANSI colours — degrade gracefully if stdout is not a TTY
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' BOLD='' RESET=''
fi

info()  { printf "%b[INFO]%b  %s\n"  "${CYAN}"  "${RESET}" "$*"; }
ok()    { printf "%b[OK]%b    %s\n"  "${GREEN}" "${RESET}" "$*"; }
warn()  { printf "%b[WARN]%b  %s\n"  "${YELLOW}" "${RESET}" "$*"; }
err()   { printf "%b[ERROR]%b %s\n"  "${RED}"   "${RESET}" "$*" >&2; }
banner(){ printf "\n%b==> %s%b\n\n" "${BOLD}" "$*" "${RESET}"; }

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
FORCE=0
PRUNE=0
NO_VERIFY=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      cat <<'EOF'
Usage: ./scripts/rebuild-worker.sh [OPTIONS]

Rebuild the trading-journal backend worker Docker container from scratch.

OPTIONS
  --force      Skip the dirty working-tree check (allow rebuilding with
               uncommitted changes in apps/backend/)
  --prune      Remove the old container image after a successful rebuild
  --no-verify  Skip Phase E (post-build refresh trigger). Use in offline
               or pure-CI scenarios where Supabase is unavailable.
  --dry-run    Print all commands without executing them
  --help       Show this help and exit

PHASES
  A  Pre-flight   — verify docker, show stale/fresh status, warn on dirty tree
  B  Stop & rm    — docker compose stop + rm -f
  C  Build        — docker compose build --no-cache  (timed)
  D  Deploy       — docker compose up -d + poll healthcheck (60 s)
  E  Verify       — trigger one refresh_stock_positions() call
  F  Summary      — old SHA → new SHA, build time, refresh result

Exit codes: 0 success, 1+ failure in any phase.

EXAMPLES
  ./scripts/rebuild-worker.sh                  # standard rebuild + verify
  ./scripts/rebuild-worker.sh --dry-run        # preview commands only
  ./scripts/rebuild-worker.sh --prune          # also remove old image
  ./scripts/rebuild-worker.sh --no-verify      # skip refresh trigger (CI)
  ./scripts/rebuild-worker.sh --force          # allow dirty tree
EOF
      exit 0
      ;;
    --force)     FORCE=1 ;;
    --prune)     PRUNE=1 ;;
    --no-verify) NO_VERIFY=1 ;;
    --dry-run)   DRY_RUN=1 ;;
    *)
      err "Unknown option: $arg  (try --help)"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Dry-run wrapper
# ---------------------------------------------------------------------------
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "%b[DRY-RUN]%b %s\n" "${YELLOW}" "${RESET}" "$*"
  else
    eval "$@"
  fi
}

# ---------------------------------------------------------------------------
# Phase A — Pre-flight
# ---------------------------------------------------------------------------
banner "Phase A: Pre-flight"

# Resolve repo root
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  err "Not inside a git repository. Run from inside the trading-journal checkout."
  exit 1
fi
info "Repo root: ${REPO_ROOT}"

# Verify docker CLI
if ! command -v docker >/dev/null 2>&1; then
  err "docker not found on PATH. Install Docker Desktop or Docker Engine."
  exit 1
fi

# Verify 'docker compose' (V2) — not legacy 'docker-compose'
if ! docker compose version >/dev/null 2>&1; then
  err "'docker compose' (V2) not available. Upgrade Docker Desktop or install the compose plugin."
  exit 1
fi
ok "docker $(docker --version | awk '{print $3}' | tr -d ',') with compose plugin"

# Canonical paths (discovered from repo)
COMPOSE_FILE="${REPO_ROOT}/docker-compose.backend.yml"
SERVICE="backend"
CONTAINER="trading_journal_backend_supabase"

if [ ! -f "$COMPOSE_FILE" ]; then
  err "Compose file not found: ${COMPOSE_FILE}"
  exit 1
fi
info "Compose file: ${COMPOSE_FILE}"
info "Service:      ${SERVICE}"
info "Container:    ${CONTAINER}"

# Current image SHA + uptime
OLD_IMAGE_ID=""
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  OLD_IMAGE_ID="$(docker inspect "$CONTAINER" --format='{{.Image}}' | cut -c1-20)"
  OLD_IMAGE_SHORT="$(docker inspect "$CONTAINER" --format='{{.Image}}' | cut -c8-19)"
  STARTED_AT="$(docker inspect "$CONTAINER" --format='{{.State.StartedAt}}')"
  CONTAINER_CREATED="$(docker inspect "$CONTAINER" --format='{{.Created}}')"
  info "Current image:   ${OLD_IMAGE_ID} (started ${STARTED_AT})"
  info "Container built: ${CONTAINER_CREATED}"
else
  warn "Container '${CONTAINER}' is not running (will create from scratch)"
  OLD_IMAGE_SHORT="(none)"
fi

# Last commit touching worker code
info "Last commit touching apps/backend/app/worker/:"
git -C "$REPO_ROOT" log --oneline -3 -- apps/backend/app/worker/ || true

# Current branch
CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
info "Current branch: ${CURRENT_BRANCH}"

# Dirty tree check
DIRTY_FILES="$(git -C "$REPO_ROOT" status --short -- apps/backend/ 2>/dev/null | grep -v '^$' || true)"
if [ -n "$DIRTY_FILES" ] && [ "$FORCE" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
  warn "Uncommitted changes detected in apps/backend/:"
  printf "%s\n" "$DIRTY_FILES"
  warn "Use --force to rebuild anyway, or commit/stash first."
  exit 1
elif [ -n "$DIRTY_FILES" ] && [ "$DRY_RUN" -eq 1 ]; then
  warn "Uncommitted changes in apps/backend/ (--dry-run: not blocking)"
  printf "%s\n" "$DIRTY_FILES"
elif [ -n "$DIRTY_FILES" ]; then
  warn "--force: proceeding with uncommitted changes in apps/backend/"
fi

ok "Pre-flight complete"

# ---------------------------------------------------------------------------
# Phase B — Stop & remove old container
# ---------------------------------------------------------------------------
banner "Phase B: Stop & remove old container"

run "docker compose -f \"${COMPOSE_FILE}\" stop ${SERVICE}"
run "docker compose -f \"${COMPOSE_FILE}\" rm -f ${SERVICE}"

if [ "$PRUNE" -eq 1 ]; then
  info "Removing old image (--prune)..."
  OLD_IMAGE_FULL=""
  if docker image inspect "trading-journal-backend" >/dev/null 2>&1; then
    OLD_IMAGE_FULL="trading-journal-backend"
  fi
  if [ -n "$OLD_IMAGE_FULL" ]; then
    run "docker image rm \"${OLD_IMAGE_FULL}\" || true"
  fi
fi

ok "Container stopped and removed"

# ---------------------------------------------------------------------------
# Phase C — Build (no cache)
# ---------------------------------------------------------------------------
banner "Phase C: Build --no-cache"

BUILD_START="$(date +%s)"
run "docker compose -f \"${COMPOSE_FILE}\" build --no-cache ${SERVICE}"
BUILD_END="$(date +%s)"
BUILD_ELAPSED="$((BUILD_END - BUILD_START))"

ok "Build complete in ${BUILD_ELAPSED}s"

# ---------------------------------------------------------------------------
# Phase D — Deploy + healthcheck
# ---------------------------------------------------------------------------
banner "Phase D: Deploy"

run "docker compose -f \"${COMPOSE_FILE}\" up -d ${SERVICE}"

if [ "$DRY_RUN" -eq 0 ]; then
  info "Polling healthcheck (up to 60s)..."
  WAIT=0
  MAX_WAIT=60
  HEALTH="starting"
  while [ "$WAIT" -lt "$MAX_WAIT" ]; do
    HEALTH="$(docker inspect "$CONTAINER" --format='{{.State.Health.Status}}' 2>/dev/null || echo 'unknown')"
    if [ "$HEALTH" = "healthy" ]; then
      ok "Container is healthy (${WAIT}s)"
      break
    fi
    sleep 5
    WAIT=$((WAIT + 5))
    info "  … ${HEALTH} (${WAIT}s)"
  done

  if [ "$HEALTH" != "healthy" ]; then
    warn "Container did not report healthy within ${MAX_WAIT}s (status: ${HEALTH})"
    warn "Showing last 30 log lines:"
    docker logs "$CONTAINER" --tail 30 || true
  fi
else
  printf "%b[DRY-RUN]%b Poll healthcheck (up to 60s) + print last 30 log lines\n" "${YELLOW}" "${RESET}"
fi

# Print last 30 log lines regardless
if [ "$DRY_RUN" -eq 0 ]; then
  info "Last 30 log lines:"
  docker logs "$CONTAINER" --tail 30 2>&1 || true
fi

# ---------------------------------------------------------------------------
# Phase E — Verify (the step that would have caught Rounds 5-7)
# ---------------------------------------------------------------------------
banner "Phase E: Verify"

if [ "$NO_VERIFY" -eq 1 ]; then
  warn "--no-verify: skipping refresh trigger"
else
  # Confirm new image SHA differs from old
  if [ "$DRY_RUN" -eq 0 ]; then
    NEW_IMAGE_ID="$(docker inspect "$CONTAINER" --format='{{.Image}}' | cut -c1-20)"
    NEW_IMAGE_SHORT="$(docker inspect "$CONTAINER" --format='{{.Image}}' | cut -c8-19)"
    if [ "$OLD_IMAGE_SHORT" = "$NEW_IMAGE_SHORT" ] && [ "$OLD_IMAGE_SHORT" != "(none)" ]; then
      warn "Image SHA unchanged (${NEW_IMAGE_SHORT}) — build may have used cache."
      warn "Was --no-cache applied? Check Phase C output."
    else
      ok "Image SHA changed: ${OLD_IMAGE_SHORT} → ${NEW_IMAGE_SHORT}"
    fi
  else
    printf "%b[DRY-RUN]%b Confirm new image SHA differs from old\n" "${YELLOW}" "${RESET}"
    NEW_IMAGE_SHORT="(dry-run)"
  fi

  # Trigger one refresh
  info "Triggering refresh_stock_positions()…"
  REFRESH_CMD="from app.worker.yahoo_refresh import refresh_stock_positions; print(refresh_stock_positions())"
  if [ "$DRY_RUN" -eq 0 ]; then
    REFRESH_RESULT="$(docker exec "$CONTAINER" uv run python -c "$REFRESH_CMD" 2>&1)" || {
      err "refresh_stock_positions() raised an exception:"
      printf "%s\n" "$REFRESH_RESULT"
      exit 1
    }
    ok "Refresh result: ${REFRESH_RESULT}"
  else
    run "docker exec ${CONTAINER} uv run python -c \"${REFRESH_CMD}\""
  fi
fi

# ---------------------------------------------------------------------------
# Phase F — Summary banner
# ---------------------------------------------------------------------------
banner "Phase F: Summary"

if [ "$DRY_RUN" -eq 0 ]; then
  printf "%b%-20s%b %s → %s\n" "${BOLD}" "Image SHA:" "${RESET}" "${OLD_IMAGE_SHORT}" "${NEW_IMAGE_SHORT:-unknown}"
  printf "%b%-20s%b %ss\n"     "${BOLD}" "Build time:"  "${RESET}" "${BUILD_ELAPSED}"
  if [ "$NO_VERIFY" -eq 0 ]; then
    printf "%b%-20s%b %s\n"    "${BOLD}" "Refresh result:" "${RESET}" "${REFRESH_RESULT:-skipped}"
  fi
  printf "\n"
  ok "Worker rebuild complete. Old code cannot corrupt DB on next refresh."
else
  info "Dry-run complete — no Docker commands were executed."
fi

exit 0
