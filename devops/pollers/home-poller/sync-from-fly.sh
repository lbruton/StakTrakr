#!/bin/bash
# sync-from-fly.sh — Sync shared scraper code from fly-poller/ to stakscrapr home VM
#
# The authoritative source of truth for all scraper code is devops/fly-poller/.
# Home VM (stakscrapr) runs the same code. This script syncs the shared files
# so both pollers stay identical.
#
# Usage:
#   ./sync-from-fly.sh                    # dry-run (show what would change)
#   ./sync-from-fly.sh --apply            # actually copy files
#   ./sync-from-fly.sh --apply --push     # copy + commit + push to stakscrapr

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLY_DIR="$SCRIPT_DIR/../fly-poller"
STAKSCRAPR_DIR="${STAKSCRAPR_DIR:-/Volumes/DATA/GitHub/stakscrapr/devops/retail-poller}"

# Shared files — these must be identical between fly-poller and home VM
SHARED_FILES=(
  price-extract.js
  price-extract-shared.js
  price-extract-provider-config.js
  price-extract-vendors.js
  price-extract-vendor-legacy.js
  price-extract-vendor-goldback.js
  price-extract-vendor-apmex.js
  price-extract-vendor-mintbuilder.js
  webscale-cookies.js
  api-export.js
  capture.js
  extract-vision.js
  vision-patch.js
  db.js
  sqld-client.js
  provider-db.js
  export-providers-json.js
  goldback-scraper.js
  merge-prices.js
  import-from-log.js
  serve.js
  package.json
  package-lock.json
  monitor-oos.sh
  spot-extract.js
  backfill-spot.js
  spot-poller/poller.py
  spot-poller/requirements.txt
  spot-poller/update-seed-data.py
)

DRY_RUN=true
PUSH=false

for arg in "$@"; do
  case "$arg" in
    --apply) DRY_RUN=false ;;
    --push)  PUSH=true ;;
  esac
done

if [ ! -d "$FLY_DIR" ]; then
  echo "ERROR: fly-poller dir not found at $FLY_DIR"
  exit 1
fi

if [ ! -d "$STAKSCRAPR_DIR" ]; then
  echo "ERROR: stakscrapr dir not found at $STAKSCRAPR_DIR"
  echo "Set STAKSCRAPR_DIR to the correct path"
  exit 1
fi

changed=0
for f in "${SHARED_FILES[@]}"; do
  src="$FLY_DIR/$f"
  dst="$STAKSCRAPR_DIR/$f"

  if [ ! -f "$src" ]; then
    echo "SKIP (missing in fly-poller): $f"
    continue
  fi

  if [ ! -f "$dst" ] || ! diff -q "$src" "$dst" >/dev/null 2>&1; then
    echo "CHANGED: $f"
    changed=$((changed + 1))
    if [ "$DRY_RUN" = false ]; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
    fi
  fi
done

if [ "$changed" -eq 0 ]; then
  echo "All shared files are in sync."
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "$changed file(s) differ. Run with --apply to sync."
  exit 0
fi

echo "$changed file(s) synced."

if [ "$PUSH" = true ]; then
  cd "$STAKSCRAPR_DIR"
  git add -A
  git commit -m "chore: sync shared scraper code from StakTrakrApi fly-poller"
  git push origin main
  echo "Pushed to stakscrapr."
fi
