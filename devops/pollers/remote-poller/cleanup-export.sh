#!/bin/bash
# StakTrakr Publisher cleanup — retention sweep + memory-capped git maintenance
# STRK-187: keeps /data inode/block usage bounded (2026-06-11 outage root-cause fix).
#
# Callers:
#   - Weekly cron (Sunday 03:17 UTC) — standalone, takes the publish lock
#   - run-publish.sh pre-flight backstop — CLEANUP_SKIP_LOCK=1 (lock already held)
#   - Manual via `fly ssh console --app staktrakr`
#
# Retention: data/15min day-dirs >90d, data/hourly day-dirs >365d (path-derived
# dates, NOT mtime — a re-clone resets every mtime but paths never lie).
# Git: reflog expire → memory-capped repack → prune → pack-refs. No `git gc`
# (it OOMs on the 512MB machine; gc.auto=0 in repo config). GNU date required.

set -e

REPO_DIR="/data/staktrakr-api-export"
PUBLISH_LOCK=/tmp/retail-publish.lock

log() { echo "[$(date -u +%H:%M:%S)] [cleanup] $*"; }

# Serialize with run-publish.sh unless the caller already holds the lock.
# noclobber makes test-and-create atomic (no race with the publish cron).
if [ "${CLEANUP_SKIP_LOCK:-0}" != "1" ]; then
  if ! (set -o noclobber; echo "$$" > "$PUBLISH_LOCK") 2>/dev/null; then
    log "Publish lock held, skipping (will retry next schedule)"
    exit 0
  fi
  trap 'rm -f "$PUBLISH_LOCK"' EXIT
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  log "ERROR: $REPO_DIR is not a git repo."
  exit 1
fi

cd "$REPO_DIR"

log "df before:"
df -P /data
df -Pi /data

# ── Retention sweep ─────────────────────────────────────────────────────
# Day dirs are data/<tree>/YYYY/MM/DD — zero-padded, so lexicographic
# comparison against a cutoff path is a correct date comparison.
prune_tree() { # $1 = subdir under data/, $2 = days to keep
  local tree="$1" keep_days="$2" cutoff rel
  cutoff=$(date -u -d "-${keep_days} days" +%Y/%m/%d)
  [ -d "data/$tree" ] || return 0
  find "data/$tree" -mindepth 3 -maxdepth 3 -type d | sort | while read -r d; do
    rel="${d#data/"$tree"/}" # YYYY/MM/DD
    if [[ "$rel" < "$cutoff" ]]; then
      rm -rf "$d"
      log "Pruned $d (older than ${keep_days}d)"
    fi
  done
  # Remove now-empty YYYY/MM and YYYY dirs (each empty dir still costs an inode)
  find "data/$tree" -mindepth 1 -type d -empty -delete 2>/dev/null || true
}

prune_tree 15min 90
prune_tree hourly 365

# ── Git maintenance (512MB-safe) ────────────────────────────────────────
# Flags duplicate the repo's pack.* config on purpose: they survive a fresh
# re-clone where someone forgets to re-apply the config (the documented
# failure mode behind the 2026-06-11 outage).
log "git objects before:"
git count-objects -v | sed 's/^/[cleanup]   /'

git reflog expire --expire=now --all
git repack -a -d -l --threads=1 --window=5 --window-memory=32m --depth=20
git prune --expire=now
git pack-refs --all

log "git objects after:"
git count-objects -v | sed 's/^/[cleanup]   /'

log "df after:"
df -P /data
df -Pi /data

log "Done."
