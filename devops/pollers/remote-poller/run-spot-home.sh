#!/bin/bash
# StakTrakr Spot Price Poller — home VM cron wrapper
# Runs spot-extract.js against the home VM poller data directory.
# Cron: 15,45 * * * *  (2x/hr, offset from Fly.io at :00/:30)

set -e

POLLER_DIR="/opt/poller"
DATA_DIR="/opt/poller/data"
ENV_FILE="${POLLER_DIR}/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
else
  echo "[$(date -u +%H:%M:%S)] WARNING: $ENV_FILE not found — falling back to environment"
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "[$(date -u +%H:%M:%S)] ERROR: DATA_DIR $DATA_DIR not found — is /opt/poller mounted?"
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
  POLLER_ID=home-spot \
  node /opt/poller/spot-extract.js

echo "[$(date -u +%H:%M:%S)] Spot poll complete."
