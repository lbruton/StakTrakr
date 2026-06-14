#!/usr/bin/env bash
# Enforce release-artifact sync. Fails commit if APP_VERSION in js/constants.js
# disagrees with any of: version.json, package.json, CHANGELOG.md section,
# js/about.js embedded What's New entry.
#
# Triggered by .pre-commit-config.yaml. Safe to run anytime:
#   bash devops/hooks/check-release-sync.sh
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$REPO_ROOT" ] || { echo "release-sync: not inside a git repository" >&2; exit 2; }
cd "$REPO_ROOT"

fail() { echo "release-sync: $1" >&2; exit 1; }

# Anchored single-line extract, skips APP_VERSION_KEY and similar.
APP_VERSION=$(sed -nE 's/^const APP_VERSION[[:space:]]*=[[:space:]]*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/p' js/constants.js | head -1)
[ -n "$APP_VERSION" ] || fail "could not parse APP_VERSION from js/constants.js"

VJ_VERSION=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' version.json | head -1)
[ -n "$VJ_VERSION" ] || fail "could not parse version from version.json"

PKG_VERSION=$(sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -1)
[ -n "$PKG_VERSION" ] || fail "could not parse version from package.json"

[ "$VJ_VERSION" = "$APP_VERSION" ]  || fail "version.json ($VJ_VERSION) != APP_VERSION ($APP_VERSION)"
[ "$PKG_VERSION" = "$APP_VERSION" ] || fail "package.json ($PKG_VERSION) != APP_VERSION ($APP_VERSION)"

ESCAPED_VERSION=${APP_VERSION//./\\.}

grep -qE "^## \[${ESCAPED_VERSION}\]" CHANGELOG.md \
  || fail "CHANGELOG.md missing '## [$APP_VERSION]' section"

# Scoped to the What's New <li><strong>vX.Y.Z ... pattern to avoid false matches
# elsewhere in about.js (comments, roadmap text, older release bodies).
grep -qE "<li><strong>v${ESCAPED_VERSION}[[:space:]]" js/about.js \
  || fail "js/about.js getEmbeddedWhatsNew missing '<li><strong>v$APP_VERSION ...' entry"

# Ceiling check: cap getEmbeddedWhatsNew at WN_MAX versioned entries. The list is
# trimmed manually by /release, so without this it silently drifts (it grew 5 -> 8
# across 3.35.15-3.35.20 before being reset). Anchored on "v" + a digit to count
# only real version <li>s. The substitution is guarded with `|| true` so a zero
# count surfaces through the explicit fail below rather than aborting under set -e.
WN_MAX=5
WN_COUNT=$(grep -cE "<li><strong>v[0-9]" js/about.js || true)
[ "$WN_COUNT" -le "$WN_MAX" ] \
  || fail "js/about.js getEmbeddedWhatsNew has $WN_COUNT versioned entries (max $WN_MAX) — trim the oldest"

exit 0
