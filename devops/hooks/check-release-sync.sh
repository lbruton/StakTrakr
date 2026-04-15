#!/usr/bin/env bash
# Enforce release-artifact sync. Fails commit if APP_VERSION in js/constants.js
# disagrees with any of: version.json, package.json, CHANGELOG.md section,
# js/about.js embedded What's New entry.
#
# Triggered by .pre-commit-config.yaml on every commit. Safe to run anytime:
#   bash devops/hooks/check-release-sync.sh
set -u

cd "$(git rev-parse --show-toplevel)" || exit 2

fail() { echo "release-sync: $1" >&2; exit 1; }

APP_VERSION=$(grep -E '^const APP_VERSION[[:space:]]*=' js/constants.js | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
[ -n "$APP_VERSION" ] || fail "could not parse APP_VERSION from js/constants.js"

VJ_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' version.json | head -1)
PKG_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)

[ "$VJ_VERSION" = "$APP_VERSION" ]  || fail "version.json ($VJ_VERSION) != APP_VERSION ($APP_VERSION)"
[ "$PKG_VERSION" = "$APP_VERSION" ] || fail "package.json ($PKG_VERSION) != APP_VERSION ($APP_VERSION)"

grep -qE "^## \[${APP_VERSION//./\\.}\]" CHANGELOG.md \
  || fail "CHANGELOG.md missing '## [$APP_VERSION]' section"

grep -qE "v${APP_VERSION//./\\.}[^0-9]" js/about.js \
  || fail "js/about.js getEmbeddedWhatsNew missing entry for v$APP_VERSION"

exit 0
