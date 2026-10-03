#!/bin/bash
# StakTrakr Publisher — monthly history squash of the StakTrakrApi `api` branch
# STRK-406: the 15-minute publish cycle adds ~200 blobs per run, so the GitHub
# repo grows ~0.85 GB/month while the served tip tree stays ~92 MB. GitHub
# Pages serves only the tip tree and sqld (not git history) is the durable
# record, so replacing the whole history with ONE orphan commit that carries the
# SAME tree is invisible to consumers and lets GitHub reclaim the old objects.
#
# Callers:
#   - cleanup-export.sh (after the re-shallow block) — already holds the
#     publish flock, so this cannot race a publish.
#   - Manual: `FORCE_SQUASH=1 /app/squash-api-history.sh` via `fly ssh console`,
#     inside a publish-safe window (:08-:23 / :38-:53).
#
# Cadence: once per UTC month. The month is persisted in MARKER_FILE rather than
# gated on day-of-month, because the cleanup cron is daily — a day gate would
# squash several times, and a lost lock on the 1st would skip a whole month.
#
# Failure policy: every failure path logs WARN and exits 0 with the local repo
# untouched and the marker unwritten, so publishing continues and the squash
# retries on the next daily run.
#
# Local-ref sync is the critical step. If the push succeeded but the local api
# ref still pointed at the old chain, the next publish would see
# HEAD != origin/api (HAS_UNPUSHED in run-publish.sh) and force-push the old
# history back over the squash. So the ref is moved immediately after the push.
#
# Env (all overridable for tests): REPO_DIR, REMOTE, PUBLISH_BRANCH, MARKER_FILE,
# FORCE_SQUASH. GNU or BSD date both work (only `date -u +%Y-%m` / `+%F`).

REPO_DIR="${REPO_DIR:-/data/staktrakr-api-export}"
PUBLISH_BRANCH="${PUBLISH_BRANCH:-api}"
MARKER_FILE="${MARKER_FILE:-/data/.api-squash-month}"

# Emit a UTC-timestamped, [squash]-tagged log line. Args: message words.
log() { echo "[$(date -u +%H:%M:%S)] [squash] $*"; }

this_month=$(date -u +%Y-%m)

if [ "${FORCE_SQUASH:-0}" != "1" ] && [ "$(cat "$MARKER_FILE" 2>/dev/null)" = "$this_month" ]; then
  log "Already squashed for ${this_month}, skipping"
  exit 0
fi

# Pushing needs credentials; cleanup-export.sh's fetch does not (public repo).
# A bare `fly ssh` session without /etc/environment has no GITHUB_TOKEN.
if [ -z "${REMOTE:-}" ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    log "WARN: GITHUB_TOKEN not set and no REMOTE override — skipping squash"
    exit 0
  fi
  REMOTE="https://${GITHUB_TOKEN}@github.com/lbruton/StakTrakrApi.git"
fi

if ! cd "$REPO_DIR" 2>/dev/null || ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "WARN: $REPO_DIR is not a git repo — skipping squash"
  exit 0
fi

OLD=$(git rev-parse "refs/heads/${PUBLISH_BRANCH}" 2>/dev/null) || {
  log "WARN: no local ${PUBLISH_BRANCH} ref — skipping squash"
  exit 0
}
TREE=$(git rev-parse "${OLD}^{tree}")

# Orphan commit (no -p) built straight from the tree object: the work tree and
# index are never touched, so a failure here cannot disturb a half-staged publish.
NEW=$(git commit-tree "$TREE" -m "publish: monthly history squash $(date -u +%F)") || {
  log "WARN: commit-tree failed — skipping squash"
  exit 0
}

# Explicit expected value: refuse to overwrite if anything else advanced the
# remote since we last saw it (there should be no other writer).
#
# The push error is logged (token redacted): the first production run (2026-10-03)
# was rejected by a GitHub ruleset (GH013, non-fast-forward blocked) and the bare
# WARN gave no way to tell that from a lease mismatch or a network failure.
if ! PUSH_OUT=$(git push --force-with-lease="${PUBLISH_BRANCH}:${OLD}" "$REMOTE" \
  "${NEW}:refs/heads/${PUBLISH_BRANCH}" 2>&1); then
  log "WARN: squash push rejected or failed — local repo unchanged, will retry next run"
  if [ -n "${GITHUB_TOKEN:-}" ]; then PUSH_OUT=${PUSH_OUT//"$GITHUB_TOKEN"/***}; fi
  # Also strip userinfo from any URL, so a credential supplied through a REMOTE
  # override (which differs from GITHUB_TOKEN) cannot reach the log. Current git
  # already anonymizes the URLs it echoes; this guards against that changing.
  printf '%s\n' "$PUSH_OUT" | sed -E -e 's#(://)[^/@[:space:]]+@#\1***@#g' -e 's/^/[squash]   /'
  exit 0
fi

# Push landed: move the local ref (and the symbolic HEAD with it) NOW.
git update-ref "refs/heads/${PUBLISH_BRANCH}" "$NEW" "$OLD"

echo "$this_month" >"$MARKER_FILE"
log "Squashed ${PUBLISH_BRANCH}: ${OLD} -> ${NEW} (tree ${TREE})"
