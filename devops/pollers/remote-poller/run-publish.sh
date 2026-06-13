#!/bin/bash
# StakTrakr Publisher — commits volume data and force-pushes to api branch
# GitHub Pages serves the api branch. main holds devops code — never overwrite it.
# Single writer. No merge conflicts possible.
# Cron: 8,23,38,53 * * * *  (4x/hr, runs ~3 min after spot poll completes)

set -e

# Lockfile guard — skip if previous publish is still running.
# noclobber makes test-and-create atomic (no race with cleanup-export.sh).
PUBLISH_LOCK=/tmp/retail-publish.lock
if ! (set -o noclobber; echo "$$" > "$PUBLISH_LOCK") 2>/dev/null; then
  echo "[$(date -u +%H:%M:%S)] Previous publish still running, skipping"
  exit 0
fi
trap 'rm -f "$PUBLISH_LOCK"' EXIT

REPO_DIR="/data/staktrakr-api-export"
REMOTE="https://${GITHUB_TOKEN}@github.com/lbruton/StakTrakrApi.git"

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: $REPO_DIR is not a git repo."
  exit 1
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: GITHUB_TOKEN not set"
  exit 1
fi

cd "$REPO_DIR"

# ── Pre-flight space backstop (STRK-187) ────────────────────────────────
# Floors sized to absorb one inter-cleanup week of growth (~30k inodes) on
# the 3GB / 195,840-inode volume. Below floor → clean now, then publish.
INODE_FLOOR=25000
BLOCKS_FLOOR_KB=307200 # 300MB
free_inodes=$(df -Pi /data | awk 'NR==2{print $4}')
free_kb=$(df -P /data | awk 'NR==2{print $4}')
if [ "${free_inodes:-0}" -lt "$INODE_FLOOR" ] || [ "${free_kb:-0}" -lt "$BLOCKS_FLOOR_KB" ]; then
  echo "[$(date -u +%H:%M:%S)] WARN: low space (free inodes=${free_inodes}, free kb=${free_kb}) — running cleanup"
  CLEANUP_SKIP_LOCK=1 /app/cleanup-export.sh || echo "[$(date -u +%H:%M:%S)] ERROR: cleanup failed"
  free_inodes=$(df -Pi /data | awk 'NR==2{print $4}')
  free_kb=$(df -P /data | awk 'NR==2{print $4}')
  if [ "${free_inodes:-0}" -lt "$INODE_FLOOR" ] || [ "${free_kb:-0}" -lt "$BLOCKS_FLOOR_KB" ]; then
    echo "[$(date -u +%H:%M:%S)] CRITICAL: still below floor after cleanup (free inodes=${free_inodes}, free kb=${free_kb}) — publishing anyway"
  fi
fi

# Export latest data from Turso → JSON files (picks up data from all pollers)
DATA_DIR="$REPO_DIR/data" node /app/api-export.js

# Export v2 API files (non-fatal — v1 still publishes if v2 fails)
DATA_DIR="$REPO_DIR/data" node /app/api-export-v2.js || echo "[$(date -u +%H:%M:%S)] v2 export failed (non-fatal)"

# Generate providers.json from Turso (non-fatal — keeps existing file if Turso is down)
DATA_DIR="$REPO_DIR/data" node /app/export-providers-json.js || true

# Stage all data changes (retail, spot hourly, goldback).
# NOTE: `git add <path>` stages DELETIONS of tracked files too (git ≥2.0) —
# the cleanup-export.sh retention sweep relies on this. Do not "fix".
git add data/

HAS_STAGED=false
HAS_UNPUSHED=false
git diff --cached --quiet || HAS_STAGED=true
git fetch origin api --quiet 2>/dev/null && \
  [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/api)" ] && HAS_UNPUSHED=true || true

if ! $HAS_STAGED && ! $HAS_UNPUSHED; then
  echo "[$(date -u +%H:%M:%S)] Nothing to publish — no staged changes and no unpushed commits."
  exit 0
fi

# ── Verify-then-push (STRK-187) ─────────────────────────────────────────
# api2 (local serve.js) is the primary by design; git/Pages is redundancy.
# Before pushing, prove serve.js is alive and the manifest on disk is fresh,
# complete JSON — catches a dead server, a zero-byte/truncated manifest
# (the full-disk failure mode), and an exporter that silently stopped
# refreshing generated_at.
MANIFEST=$(curl -s --max-time 10 http://localhost:8080/data/api/manifest.json || true)
GEN_AT=$(echo "$MANIFEST" | jq -r '.generated_at // empty' 2>/dev/null || true)
if [ -z "$GEN_AT" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: api2 manifest missing/unparseable — SKIPPING push (api2 unaffected, exports on disk)"
  exit 1
fi
if $HAS_STAGED; then
  # Freshness check only when this cycle exported — a push-only retry cycle
  # legitimately serves an older manifest. Parse the timestamp into a variable
  # first: an empty command substitution inside $(( )) is a fatal syntax error.
  GEN_TS=$(date -d "$GEN_AT" +%s 2>/dev/null) || GEN_TS=""
  if [ -z "$GEN_TS" ]; then
    echo "[$(date -u +%H:%M:%S)] ERROR: api2 manifest generated_at unparseable (${GEN_AT}) — SKIPPING push"
    exit 1
  fi
  AGE_MIN=$((($(date -u +%s) - GEN_TS) / 60))
  if [ "$AGE_MIN" -gt 30 ]; then
    echo "[$(date -u +%H:%M:%S)] ERROR: api2 manifest stale (${AGE_MIN}m, generated_at=${GEN_AT}) — SKIPPING push"
    exit 1
  fi
fi

# Commit only after the freshness gate passes (STRK-187). Committing before the
# gate left an unpushed local commit on any gate `exit 1`; the next cron run
# (HAS_STAGED=false / HAS_UNPUSHED=true) skips the freshness check entirely and
# force-pushes that stale/rejected commit — defeating verify-then-push. Keep the
# commit here, behind the gate, so a rejected cycle leaves no commit to resurrect.
if $HAS_STAGED; then
  # Build a meaningful commit message
  RETAIL_TS=$(jq -r '.generated_at // "unknown"' data/api/manifest.json 2>/dev/null || echo "unknown")
  DATE=$(date -u +%Y-%m-%dT%H:%MZ)
  git commit -m "publish: ${DATE} | retail=${RETAIL_TS}"
fi

# Force-push to api branch — sole writer, no merge conflicts.
# IMPORTANT: push to api, NOT main. main holds devops code.
if ! git push --force "$REMOTE" HEAD:api; then
  echo "[$(date -u +%H:%M:%S)] ERROR: git push to api branch FAILED — api2 still fresh, published feed (api.staktrakr.com) goes stale until a later cycle succeeds"
  exit 1
fi

RETAIL_TS=$(jq -r '.generated_at // "unknown"' data/api/manifest.json 2>/dev/null || echo "unknown")
echo "[$(date -u +%H:%M:%S)] Published to api. Retail ts: ${RETAIL_TS}"
