#!/bin/bash
# StakTrakr Publisher — commits volume data and force-pushes to api branch
# GitHub Pages serves the api branch. main holds devops code — never overwrite it.
# Single writer. No merge conflicts possible.
# Cron: 8,23,38,53 * * * *  (4x/hr, runs ~3 min after spot poll completes)

set -e

# Lockfile guard — skip if previous publish is still running.
# flock (STRK-402) — kernel-managed and tied to fd 9's process lifetime, so a
# SIGKILL (OOM-kill, `fly machine restart` mid-run) releases it automatically.
# The prior noclobber lock needed its EXIT trap to fire to clean up, which
# does not happen on SIGKILL — the 2026-09-26 outage left it stranded and a
# manual `rm -f` was required before any publish could run again. fd 9 is
# inherited by cleanup-export.sh when called below, so CLEANUP_SKIP_LOCK=1
# there is still race-free without re-acquiring the lock.
PUBLISH_LOCK=/tmp/retail-publish.flock
exec 9>"$PUBLISH_LOCK"
if ! flock -n 9; then
  echo "[$(date -u +%H:%M:%S)] Previous publish still running, skipping"
  exit 0
fi

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

# ── Bootstrap re-shallow guard (STRK-402) ───────────────────────────────
# A full (non-shallow) repo here means either a fresh full `git clone` or a
# volume from before this fix landed. Re-shallow now instead of waiting for
# the daily cron or the inode floor below — a full-history repo is exactly
# the condition that let `git repack -a` OOM the machine in the first place.
# Continuing to publish below is deliberate, not an oversight: cleanup-export.sh
# builds the new git-dir in a sibling directory and only swaps it in after
# fetch + reset both succeed, so a failed cleanup here leaves the existing
# (still full-history, still fully functional) repo completely untouched —
# there is nothing unsafe to publish against.
if [ ! -f .git/shallow ]; then
  echo "[$(date -u +%H:%M:%S)] WARN: repo is not shallow — running cleanup to re-shallow before publishing"
  CLEANUP_SKIP_LOCK=1 /app/cleanup-export.sh || echo "[$(date -u +%H:%M:%S)] ERROR: cleanup failed"
fi

# ── Pre-flight space backstop (STRK-187) ────────────────────────────────
# Backstop for a daily cleanup cron that has stopped running. Measured growth
# (STRK-402 soak, 2026-09-27 → 10-02) is ~31k inodes/day of loose git objects
# on the 3GB / 195,840-inode volume, on top of a ~16.5k-inode clean baseline.
# With the daily cron healthy, usage peaks near 48k and never approaches the
# floor; with it dead, the floor trips after ~5 days and the cleanup runs here
# instead, inside the publish slot (~83s at that size, well under the 720s
# publish timeout). Below floor → clean now, then publish.
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
