#!/bin/bash
# StakTrakr Retail Poller — local Docker run script
# Runs Firecrawl extraction (+ Playwright fallback), writes to SQLite,
# exports REST API JSON, and pushes to data branch.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Lockfile guard with stuck-run watchdog (STRK-255).
# At a 15-minute cadence a 1500s budget means the first contended tick (age
# 900s) skips and the second (age 1800s) kills the wedged tree — matching the
# home poller's "reclaim on the second consecutive contended tick" behaviour
# while leaving a legitimately slow scrape 25 minutes of headroom.
#
# NOTE: this script is currently neither COPYed into the slim Fly.io image nor
# scheduled by docker-entrypoint-slim.sh — retail scraping runs on the home
# poller. It is kept in sync so re-enabling it does not reintroduce the wedge.
LOCKFILE=/tmp/retail-poller.lock
RETAIL_RUN_MAX_SECONDS="${RETAIL_RUN_MAX_SECONDS:-1500}"
. "$SCRIPT_DIR/run-lock.sh"
if ! acquire_run_lock "$LOCKFILE" "$RETAIL_RUN_MAX_SECONDS"; then
  exit 0
fi

DATE=$(date -u +%Y-%m-%d)
echo "[$(date -u +%H:%M:%S)] Starting retail price run for $DATE"

# Prune price log files older than 30 days (non-fatal)
if [ -n "${PRICE_LOG_DIR:-}" ]; then
  find "$PRICE_LOG_DIR" -name "prices-*.jsonl" -mtime +30 -delete 2>/dev/null || true
fi

# StakTrakrApi repo configuration
POLLER_ID="${POLLER_ID:-api}"

# GITHUB_TOKEN used by run-publish.sh for pushing; not required here

# Use the persistent volume clone — no temp dir, no clone overhead
API_EXPORT_DIR="${API_EXPORT_DIR:-/data/staktrakr-api-export}"
# The release trap is armed by acquire_run_lock at acquire time. It used to be
# registered here, ~17 lines after the lock was taken, so any failure in between
# leaked the lock permanently.

if [ ! -d "$API_EXPORT_DIR/.git" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: $API_EXPORT_DIR is not a git repo. Is volume mounted?"
  exit 1
fi
cd "$API_EXPORT_DIR"

# providers.json is now read from Turso at runtime (STAK-348)
# File sync removed — pollers query provider_coins + provider_vendors tables directly
echo "[$(date -u +%H:%M:%S)] Providers loaded from Turso (file sync removed)"

# Tailscale exit node REMOVED (2026-03-02). The exit node routed ALL container
# traffic (including Fly's internal WireGuard SSH) through the home VM, causing
# SSH lockout and deploy issues. Chromium never respected it anyway — tinyproxy
# (HOME_PROXY_URL) handles residential IP routing for Playwright and vision.
# Firecrawl uses the Fly.io datacenter IP directly; ~1/3 of targets may 403,
# but Phase 2 Playwright (via proxy) and vision capture pick them up.

# Run Firecrawl extraction (with Playwright fallback) — writes results to SQLite
echo "[$(date -u +%H:%M:%S)] Running price extraction..."
DATA_DIR="$API_EXPORT_DIR/data" \
FIRECRAWL_BASE_URL="${FIRECRAWL_BASE_URL:-http://firecrawl:3002}" \
BROWSERLESS_URL="${BROWSERLESS_URL:-}" \
BROWSER_MODE=local \
node /app/price-extract.js
# T3 queue status — log failure count, warn if rate looks systemic
RETRY_FILE=/tmp/retail-failures.json
if [ -f "$RETRY_FILE" ]; then
  FAIL_COUNT=$(node -e "try { console.log(require('$RETRY_FILE').length); } catch { console.log(0); }")
  echo "[$(date -u +%H:%M:%S)] T3 queue: $FAIL_COUNT failed SKU(s) queued for retry"
  TOTAL_TARGETS=$(node -e "
    try {
      const p = JSON.parse(require('fs').readFileSync('$API_EXPORT_DIR/data/retail/providers.json','utf8'));
      let n = 0;
      for (const c of Object.values(p.coins)) n += (c.providers||[]).filter(pr=>pr.enabled&&pr.url).length;
      console.log(n);
    } catch { console.log(0); }
  ")
  if [ "$FAIL_COUNT" -gt 0 ] && [ "$TOTAL_TARGETS" -gt 0 ]; then
    PCT=$(( FAIL_COUNT * 100 / TOTAL_TARGETS ))
    if [ "$PCT" -ge 80 ]; then
      echo "[$(date -u +%H:%M:%S)] [WARN] SYSTEMIC failure: ${PCT}% of targets failed — check tinyproxy on home VM"
    fi
  fi
fi

# Vision pipeline — soft-disabled by default (VISION_ENABLED=1 to enable)
# Requires GEMINI_API_KEY when enabled. Uses local Chromium for screenshots.
# Toggle via: fly secrets set VISION_ENABLED=1 / fly secrets unset VISION_ENABLED
if [ "${VISION_ENABLED:-}" = "1" ]; then
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    _ARTIFACT_DIR="${ARTIFACT_DIR:-/tmp/retail-screenshots/$(date -u +%Y-%m-%d)}"
    echo "[$(date -u +%H:%M:%S)] Running vision capture..."
    BROWSER_MODE=local \
      ARTIFACT_DIR="$_ARTIFACT_DIR" \
      DATA_DIR="$API_EXPORT_DIR/data" \
      node /app/capture.js \
      || echo "[$(date -u +%H:%M:%S)] WARN: vision capture failed (non-fatal)"

    echo "[$(date -u +%H:%M:%S)] Running vision extraction..."
    MANIFEST_PATH="$_ARTIFACT_DIR/manifest.json" \
      ARTIFACT_DIR="$_ARTIFACT_DIR" \
      DATA_DIR="$API_EXPORT_DIR/data" \
      node /app/extract-vision.js \
      || echo "[$(date -u +%H:%M:%S)] WARN: vision extraction failed (non-fatal)"
  else
    echo "[$(date -u +%H:%M:%S)] Skipping vision pipeline (GEMINI_API_KEY not set)"
  fi
else
  echo "[$(date -u +%H:%M:%S)] Vision pipeline disabled (VISION_ENABLED=${VISION_ENABLED:-unset})"
fi

# Scrape complete — run-publish.sh handles export + push on its own cadence
echo "[$(date -u +%H:%M:%S)] Scrape done. run-publish.sh will export and push on next cycle."
