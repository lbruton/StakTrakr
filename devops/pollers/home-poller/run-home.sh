#!/bin/bash
# StakTrakr Home Poller — LXC run script
# Mirrors run-local.sh (Fly.io) with full Firecrawl + Playwright + Vision pipeline.
# Only differences from Fly.io: POLLER_ID=home, cron times, .env loading.
# Cron: 30 * * * * (hourly at :30, offset from Fly.io :00 run)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Lockfile guard with stuck-run watchdog (STRK-255).
# Cron here is hourly (30 * * * *). With a 5400s budget the first contended
# tick (age 3600s) still skips — a slow run gets 90 minutes of headroom — and
# the second (age 7200s) kills the wedged process tree and proceeds. Without
# this a single Playwright stall froze retail data until the container
# restarted ~3.5h later.
#
# The helper sits next to this script inside the image (both land in /app) but
# lives in ../shared/ in the repo, so resolve both layouts.
LOCKFILE=/tmp/retail-poller.lock
RETAIL_RUN_MAX_SECONDS="${RETAIL_RUN_MAX_SECONDS:-5400}"
if [ -f "$SCRIPT_DIR/run-lock.sh" ]; then
  . "$SCRIPT_DIR/run-lock.sh"
else
  . "$SCRIPT_DIR/../shared/run-lock.sh"
fi
if ! acquire_run_lock "$LOCKFILE" "$RETAIL_RUN_MAX_SECONDS"; then
  exit 0
fi

# Load .env if present (home poller stores Turso creds, Firecrawl URL, etc.)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
fi

# STRK-230: cron runs `. /etc/environment` before this script, but plain
# assignments sourced that way are NOT exported, so this child script (→ node)
# never sees them. Re-export ONLY the WEBSCALE_* cookie vars (wspc cookie for
# JM/Provident) plus MB_API_KEY (STRK-321 MintBuilder direct feed) from the
# container env. Scoped deliberately, to leave every other var's behavior
# untouched. Without the MB_API_KEY hop the feed silently falls back to page
# scraping under cron while the dashboard retry (which inherits the Docker
# env) still uses the feed — a confusing half-state.
if [ -f /etc/environment ]; then
  while IFS= read -r _line; do
    case "$_line" in
      WEBSCALE_*=* | MB_API_KEY=*) export "${_line}" ;;
    esac
  done < /etc/environment
fi

DATE=$(date -u +%Y-%m-%d)
echo "[$(date -u +%H:%M:%S)] Starting home retail price run for $DATE"

# Prune price log files older than 30 days (non-fatal)
if [ -n "${PRICE_LOG_DIR:-}" ]; then
  find "$PRICE_LOG_DIR" -name "prices-*.jsonl" -mtime +30 -delete 2>/dev/null || true
fi

# Providers loaded from Turso at runtime (STAK-348)
POLLER_ID="${POLLER_ID:-home}"

# Run Firecrawl extraction (with Playwright fallback) — writes results to Turso.
# MB_API_KEY passed inline as belt-and-braces alongside the re-export above
# (STRK-321): either hop alone suffices, both make the cron path robust.
echo "[$(date -u +%H:%M:%S)] Running price extraction..."
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}" \
FIRECRAWL_BASE_URL="${FIRECRAWL_BASE_URL:-http://localhost:3002}" \
BROWSER_MODE=local \
PLAYWRIGHT_LAUNCH=1 \
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/usr/local/share/playwright}" \
POLLER_ID="$POLLER_ID" \
MB_API_KEY="${MB_API_KEY:-}" \
node "$SCRIPT_DIR/price-extract.js"

# T3 queue status — log failure count, warn if rate looks systemic
RETRY_FILE=/tmp/retail-failures.json
if [ -f "$RETRY_FILE" ]; then
  FAIL_COUNT=$(node -e "try { console.log(require('$RETRY_FILE').length); } catch { console.log(0); }")
  echo "[$(date -u +%H:%M:%S)] T3 queue: $FAIL_COUNT failed SKU(s) queued for retry"
  TOTAL_TARGETS=$(node --input-type=module -e "
    import { createSqldClient } from '$SCRIPT_DIR/sqld-client.js';
    import { getProviders } from '$SCRIPT_DIR/provider-db.js';
    try {
      const c = createSqldClient();
      const p = await getProviders(c);
      let n = 0;
      for (const c2 of Object.values(p.coins)) n += (c2.providers||[]).filter(pr=>pr.enabled&&pr.url).length;
      console.log(n);
    } catch { console.log(0); }
  " 2>/dev/null || echo "0")
  if [ "$FAIL_COUNT" -gt 0 ] && [ "$TOTAL_TARGETS" -gt 0 ]; then
    PCT=$(( FAIL_COUNT * 100 / TOTAL_TARGETS ))
    if [ "$PCT" -ge 80 ]; then
      echo "[$(date -u +%H:%M:%S)] [WARN] SYSTEMIC failure: ${PCT}% of targets failed — check network"
    fi
  fi
fi

# Vision pipeline — soft-disabled by default (VISION_ENABLED=1 to enable)
if [ "${VISION_ENABLED:-}" = "1" ]; then
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    _ARTIFACT_DIR="${ARTIFACT_DIR:-/tmp/retail-screenshots/$(date -u +%Y-%m-%d)}"
    echo "[$(date -u +%H:%M:%S)] Running vision capture..."
    BROWSER_MODE=local \
      PLAYWRIGHT_LAUNCH=1 \
      PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/usr/local/share/playwright}" \
      ARTIFACT_DIR="$_ARTIFACT_DIR" \
      DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}" \
      node "$SCRIPT_DIR/capture.js" \
      || echo "[$(date -u +%H:%M:%S)] WARN: vision capture failed (non-fatal)"

    echo "[$(date -u +%H:%M:%S)] Running vision extraction..."
    MANIFEST_PATH="$_ARTIFACT_DIR/manifest.json" \
      ARTIFACT_DIR="$_ARTIFACT_DIR" \
      DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}" \
      node "$SCRIPT_DIR/extract-vision.js" \
      || echo "[$(date -u +%H:%M:%S)] WARN: vision extraction failed (non-fatal)"
  else
    echo "[$(date -u +%H:%M:%S)] Vision enabled but GEMINI_API_KEY not set — skipping"
  fi
else
  echo "[$(date -u +%H:%M:%S)] Vision pipeline disabled (VISION_ENABLED=${VISION_ENABLED:-unset})"
fi

echo "[$(date -u +%H:%M:%S)] Done."
