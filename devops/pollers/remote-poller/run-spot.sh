#!/bin/bash
# StakTrakr Spot Price Poller — single-shot cron wrapper
# Runs spot-extract.js against the persistent volume data directory.
# Cron: 0,30 * * * *  (2x/hr, on the hour and half-hour)

set -e

DATA_DIR="/data/staktrakr-api-export/data"
POLLER_DIR="/app/spot-poller"  # legacy reference — Python poller no longer active

if [ ! -d "$DATA_DIR" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: DATA_DIR $DATA_DIR not found — is volume mounted?"
  exit 1
fi

if [ -z "${METAL_PRICE_API_KEY:-}" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: METAL_PRICE_API_KEY not set"
  exit 1
fi

echo "[$(date -u +%H:%M:%S)] Starting spot price poll..."
METAL_PRICE_API_KEY="$METAL_PRICE_API_KEY" \
  DATA_DIR="$DATA_DIR" \
  SQLD_URL="${SQLD_URL:-$TURSO_DATABASE_URL}" \
  SQLD_AUTH_TOKEN="${SQLD_AUTH_TOKEN:-$TURSO_AUTH_TOKEN}" \
  POLLER_ID=fly-spot \
  node /app/spot-extract.js

echo "[$(date -u +%H:%M:%S)] Spot poll complete."
