#!/usr/bin/env bash
# stamp-sw-cache.sh — Pre-commit hook for StakTrakr
# Auto-updates CACHE_NAME in sw.js with a build timestamp whenever
# any cached asset is modified in the commit.
#
# Format:  staktrakr-v{APP_VERSION}-b{EPOCH}
# Example: staktrakr-v3.30.08-b1739836800
#
# Install:
#   ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit
#
# The hook is idempotent — running it twice produces the same result
# (the timestamp updates, which is the point).

set -euo pipefail

SW_FILE="sw.js"

# Only run from repo root
if [ ! -f "$SW_FILE" ]; then
  exit 0
fi

# Paths that live in the SW CORE_ASSETS pre-cache list.
# If any of these are staged, the cache name must change.
CACHED_PATTERNS=(
  "css/"
  "fonts/"
  "js/"
  "index.html"
  "data/"
  "images/"
  "manifest.json"
  "sw.js"
  "sw-router.js"
)

# Check if any cached asset is in the staged diff
NEED_STAMP=false
STAGED=$(git diff --cached --name-only 2>/dev/null || true)

for pattern in "${CACHED_PATTERNS[@]}"; do
  if echo "$STAGED" | grep -q "^${pattern}"; then
    NEED_STAMP=true
    break
  fi
done

# Also stamp if sw.js itself is staged (manual edits)
if echo "$STAGED" | grep -q "^sw.js$"; then
  NEED_STAMP=true
fi

if [ "$NEED_STAMP" = false ]; then
  exit 0
fi

# Extract APP_VERSION from constants.js (e.g. "3.30.08")
# Use grep + sed for macOS compatibility (no grep -P or sed \s)
APP_VERSION=$(grep 'const APP_VERSION' js/constants.js 2>/dev/null | sed 's/.*"\([^"]*\)".*/\1/' | head -1)
APP_VERSION="${APP_VERSION:-0.0.0}"

# Build timestamp (Unix epoch seconds)
BUILD_TS=$(date +%s)

NEW_CACHE="staktrakr-v${APP_VERSION}-b${BUILD_TS}"

# Current CACHE_NAME value — accept both single- and double-quoted forms
CURRENT=$(grep 'const CACHE_NAME' "$SW_FILE" 2>/dev/null | sed -E "s/.*[\"']([^\"']*)[\"'].*/\1/" | head -1)

if [ "$CURRENT" = "$NEW_CACHE" ]; then
  exit 0
fi

# Replace CACHE_NAME in sw.js — match both single- and double-quoted forms
# (project uses double quotes per prettier config)
if sed --version >/dev/null 2>&1; then
  # GNU sed
  sed -i -E "s|const CACHE_NAME = [\"'][^\"']*[\"'];|const CACHE_NAME = \"${NEW_CACHE}\";|" "$SW_FILE"
else
  # BSD/macOS sed
  sed -i '' -E "s|const CACHE_NAME = [\"'][^\"']*[\"'];|const CACHE_NAME = \"${NEW_CACHE}\";|" "$SW_FILE"
fi

# Re-stage sw.js so the commit includes the updated cache name
git add "$SW_FILE"

echo "[stamp-sw-cache] CACHE_NAME updated: ${NEW_CACHE}"
