#!/bin/bash
# StakTrakr Publisher cleanup — retention sweep + re-shallowed git maintenance
# STRK-187: keeps /data inode/block usage bounded (2026-06-11 outage root-cause fix).
# STRK-402: git maintenance re-shallows instead of repacking full history
# (2026-09-26 outage — see below).
#
# Callers:
#   - Daily cron (03:17 UTC) — standalone, takes the publish lock
#   - run-publish.sh pre-flight backstop — CLEANUP_SKIP_LOCK=1 (lock already held)
#   - Manual via `fly ssh console --app staktrakr`
#
# Retention: data/15min day-dirs >90d, data/hourly day-dirs >365d (path-derived
# dates, NOT mtime — a re-clone resets every mtime but paths never lie).
#
# Git (STRK-402): re-shallow to a fresh depth-1 clone of the current tip, then
# repack the (now tiny) remainder. `git repack -a` previously ran against the
# repo's ENTIRE history — years of 4x/hour publish commits, ~3M objects — and
# `--window-memory` only caps the per-delta window, not the object list it has
# to enumerate first. That repack grew to 685MB RSS and was OOM-killed after
# 86 minutes, wedging the whole machine (tailscaled froze, sqld timed out, the
# */5 provider-export cron piled up) while still holding the publish lock.
# Because it never reached `prune`, inodes stayed pinned and the next publish
# re-entered the same repack — a permanent loop that a plain machine restart
# did not clear. Re-shallowing bounds the object count to the current tree
# (~16k objects, one 12MB pack) regardless of how much history has
# accumulated. A fresh `git init --bare` (not an in-place `git fetch --depth
# 1`) is required: fetching --depth into an already-unshallow repo does not
# reliably drop the existing full history — verified only via full reinit
# during the incident recovery. The new git-dir is built in a SIBLING
# directory and only swapped in after fetch + reset both succeed, so a
# transient network failure during cleanup can never destroy the working
# repo. The swap itself renames the old `.git` out of the way before renaming
# the new one into place (never `rm -rf` before the new one exists), so even
# a failure mid-swap leaves the old repo recoverable rather than gone. No
# `git gc` (it OOMs on the 512MB machine; gc.auto=0 in repo config). GNU date
# required.
#
# STRK-406: after the re-shallow, squash-api-history.sh collapses the remote
# `api` history to one orphan commit once per UTC month (see that script).

set -e

REPO_DIR="/data/staktrakr-api-export"
PUBLISH_LOCK=/tmp/retail-publish.flock
PUBLISH_BRANCH="${PUBLISH_BRANCH:-api}"

# Emit a UTC-timestamped, [cleanup]-tagged log line. Args: message words.
log() { echo "[$(date -u +%H:%M:%S)] [cleanup] $*"; }

# Serialize with run-publish.sh unless the caller already holds the lock.
# flock (STRK-402) — see run-publish.sh for why this replaced the noclobber
# lock. When run-publish.sh calls this script with CLEANUP_SKIP_LOCK=1, fd 9
# is already open and flock'd in the parent and inherited here unchanged, so
# no re-acquire is needed.
if [ "${CLEANUP_SKIP_LOCK:-0}" != "1" ]; then
  exec 9>"$PUBLISH_LOCK"
  if ! flock -n 9; then
    log "Publish lock held, skipping (will retry next schedule)"
    exit 0
  fi
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

# ── Git maintenance: re-shallow (STRK-402, 512MB-safe) ──────────────────
# Flags duplicate the repo's pack.* config on purpose: they survive a fresh
# re-clone where someone forgets to re-apply the config (the documented
# failure mode behind the 2026-06-11 outage).
log "git objects before:"
git count-objects -v | sed 's/^/[cleanup]   /'

# Build the new shallow repo in a sibling dir on the SAME filesystem as
# REPO_DIR (a sibling, not a path nested under it, so `git init` can't nest a
# second repo inside the still-live one) and only swap it in after fetch +
# reset both succeed. A transient network failure here must never destroy
# the existing (working) repo — leaving cleanup to retry next schedule with
# the old, still-functional history intact is strictly better than a bricked
# repo with no commits.
NEW_GIT_DIR=$(mktemp -d "$(dirname "$REPO_DIR")/.git-reshallow.XXXXXX")
OLD_GIT_DIR=".git.old.$$"
# If the swap below is interrupted between its two renames — the first
# succeeded (.git is now at $OLD_GIT_DIR) but the second failed or never ran
# — $OLD_GIT_DIR holds the ONLY remaining copy of the repository. An
# unconditional `rm -rf` here would delete it, which is precisely the
# failure a reviewer caught: a naive cleanup trap defeating the whole point
# of renaming instead of deleting. Restore it instead; NEW_GIT_DIR is always
# disposable regardless of how far the swap got.
_cleanup_reshallow_tmp() {
  if [ ! -e .git ] && [ -d "$OLD_GIT_DIR" ]; then
    mv "$OLD_GIT_DIR" .git
    log "WARN: re-shallow swap interrupted — restored the original .git; will retry next schedule"
  fi
  rm -rf "$NEW_GIT_DIR" "$OLD_GIT_DIR"
}
trap _cleanup_reshallow_tmp EXIT
git init --bare -q "$NEW_GIT_DIR"
cp .git/config "$NEW_GIT_DIR/config"
git --git-dir="$NEW_GIT_DIR" symbolic-ref HEAD "refs/heads/${PUBLISH_BRANCH}"
git --git-dir="$NEW_GIT_DIR" --work-tree="$REPO_DIR" fetch --depth 1 origin "$PUBLISH_BRANCH"
git --git-dir="$NEW_GIT_DIR" --work-tree="$REPO_DIR" reset FETCH_HEAD

# Only now that fetch + reset both succeeded. `mv` is a single rename() per
# hop, so unlike `rm -rf .git` this never destroys anything: renaming .git
# out of the way first means that if the second rename somehow fails (e.g.
# NEW_GIT_DIR ended up on a different filesystem), the original is still
# fully intact and recoverable with `mv "$OLD_GIT_DIR" .git` — a plain
# `rm -rf .git` before the swap has no such recovery path.
mv .git "$OLD_GIT_DIR"
mv "$NEW_GIT_DIR" .git
rm -rf "$OLD_GIT_DIR"

git reflog expire --expire=now --all
git repack -a -d -l --threads=1 --window=5 --window-memory=32m --depth=20
git prune --expire=now
git pack-refs --all

log "git objects after:"
git count-objects -v | sed 's/^/[cleanup]   /'

log "df after:"
df -P /data
df -Pi /data

# ── Monthly api-history squash (STRK-406) ───────────────────────────────
# Runs after the re-shallow so it operates on the fresh depth-1 repo, and under
# the publish flock held above (or inherited via CLEANUP_SKIP_LOCK=1), so it
# cannot race a publish. Non-fatal by design: `set -e` is active, so the `||`
# is what keeps a failed squash from failing cleanup (it retries next run).
/app/squash-api-history.sh || log "WARN: squash-api-history.sh failed (non-fatal)"

log "Done."
