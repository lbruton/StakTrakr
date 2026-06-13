#!/bin/bash
# StakTrakr — Fly.io container health check via Tailscale
# =========================================================
# Pings the Fly.io container's Tailscale IP and checks its
# public HTTP endpoint. Logs result to poller log and writes
# a one-line status file readable by the dashboard.
#
# Run manually or add to cron.
# Suggested cron (every 5 min, as root):
#   */5 * * * * root /opt/poller/check-flyio.sh >> /var/log/retail-poller.log 2>&1
#
# Set FLYIO_TAILSCALE_IP once the container is back up.

FLYIO_TAILSCALE_IP="${FLYIO_TAILSCALE_IP:-100.90.171.110}"
FLYIO_HTTP_URL="${FLYIO_HTTP_URL:-https://api2.staktrakr.com/data/retail/providers.json}"
SQLD_HEALTH_URL="${SQLD_HEALTH_URL:-https://api2.staktrakr.com/health/sqld-reachable}"
PUBLISHED_MANIFEST_URL="${PUBLISHED_MANIFEST_URL:-https://api.staktrakr.com/data/api/manifest.json}"
API2_MANIFEST_URL="${API2_MANIFEST_URL:-https://api2.staktrakr.com/data/api/manifest.json}"
PUBLISH_FRESH_MAX_MIN="${PUBLISH_FRESH_MAX_MIN:-45}"
STATUS_FILE="/tmp/flyio-health.json"
TIMEOUT=10
SQLD_HEALTH_TIMEOUT=8

log() { echo "[$(date -u +%H:%M:%S)] [flyio-check] $*"; }

# Extract a JSON field from a single-line response. Shape is fixed by
# serve.js (no nesting), so grep is sufficient — no jq dependency.
json_bool() { echo "$1" | grep -oE "(^|[,{])[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*(true|false)([[:space:]]*[,}]|$)" | sed -E 's/^.*:[[:space:]]*(true|false).*$/\1/'; }
json_num()  { echo "$1" | grep -oE "(^|[,{])[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*-?[0-9]+(\.[0-9]+)?([[:space:]]*[,}]|$)" | sed -E 's/^.*:[[:space:]]*(-?[0-9]+(\.[0-9]+)?).*$/\1/'; }
json_str()  { echo "$1" | grep -oE "(^|[,{])[[:space:]]*\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"([[:space:]]*[,}]|$)" | sed -E 's/^.*:[[:space:]]*"([^"]*)".*$/\1/'; }

# ── Tailscale ping (best-effort from Docker bridge) ──────────────────────────
ts_ok=false
ts_ms="skipped"
if [ "$FLYIO_TAILSCALE_IP" != "TODO_REPLACE_WITH_IP" ] && command -v ping > /dev/null 2>&1; then
  if ping -c 1 -W "$TIMEOUT" "$FLYIO_TAILSCALE_IP" > /dev/null 2>&1; then
    ts_ms=$(ping -c 1 -W "$TIMEOUT" "$FLYIO_TAILSCALE_IP" 2>/dev/null | grep -oP 'time=\K[0-9.]+' | head -1)
    ts_ok=true
    log "Tailscale ping OK (${ts_ms:-?}ms)"
  else
    ts_ms="timeout"
    log "INFO: Tailscale ping failed (expected from Docker bridge network)"
  fi
fi

# ── HTTP endpoint check ───────────────────────────────────────────────────────
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$FLYIO_HTTP_URL" 2>/dev/null)
if [ "$http_code" = "200" ] || [ "$http_code" = "404" ]; then
  http_ok=true
  log "HTTP check OK — serve.js responding ($FLYIO_HTTP_URL → $http_code)"
else
  http_ok=false
  log "WARN: HTTP check FAILED ($FLYIO_HTTP_URL → ${http_code:-no response})"
fi

# ── sqld reachability via Fly.io (catches Tailscale subnet route loss) ────────
# Fly.io's serve.js runs SELECT 1 against home sqld via the Tailscale subnet
# route. The probe completing at all signals Fly.io is up; the `ok` field
# signals whether sqld is reachable.
sqld_response=$(curl -s --max-time "$SQLD_HEALTH_TIMEOUT" "$SQLD_HEALTH_URL" 2>/dev/null)
sqld_ok="false"
sqld_latency_ms=""
sqld_error_class=""
if [ -n "$sqld_response" ]; then
  sqld_ok=$(json_bool "$sqld_response" "ok")
  sqld_latency_ms=$(json_num "$sqld_response" "latency_ms")
  sqld_error_class=$(json_str "$sqld_response" "error_class")
  [ -z "$sqld_ok" ] && sqld_ok="false"
fi
[ -z "$sqld_error_class" ] && sqld_error_class="no_response"
if [ "$sqld_ok" = "true" ]; then
  log "sqld-reachable OK (${sqld_latency_ms:-?}ms)"
else
  log "WARN: sqld-reachable FAIL (${sqld_error_class:-no_response} ${sqld_latency_ms:-?}ms)"
fi

# ── Publish freshness (STRK-187) ──────────────────────────────────────────────
# The 2026-06-11 outage was invisible for ~7h because nothing watched the
# published manifest's generated_at. api (GitHub Pages) is the published feed;
# api2 (serve.js) reads the export dir directly — comparing both distinguishes
# "push broken" (api2 fresh, published stale) from "publish broken" (both stale).
manifest_age_min() { # $1 = manifest URL → echoes age in minutes, rc 1 on failure
  local body gen ts now
  body=$(curl -s --max-time "$TIMEOUT" "$1" 2>/dev/null | tr -d '\n')
  gen=$(json_str "$body" "generated_at")
  [ -z "$gen" ] && return 1
  ts=$(date -d "$gen" +%s 2>/dev/null) || return 1
  now=$(date -u +%s)
  echo $(((now - ts) / 60))
}

pub_age=$(manifest_age_min "$PUBLISHED_MANIFEST_URL") || pub_age=""
api2_age=$(manifest_age_min "$API2_MANIFEST_URL") || api2_age=""
pub_fresh=false
api2_fresh=false
[ -n "$pub_age" ] && [ "$pub_age" -le "$PUBLISH_FRESH_MAX_MIN" ] && pub_fresh=true
[ -n "$api2_age" ] && [ "$api2_age" -le "$PUBLISH_FRESH_MAX_MIN" ] && api2_fresh=true
if [ "$pub_fresh" = "true" ]; then
  log "Publish freshness OK (published ${pub_age}m, api2 ${api2_age:-?}m)"
else
  log "WARN: publish freshness FAIL (published ${pub_age:-no_data}m, api2 ${api2_age:-no_data}m, max ${PUBLISH_FRESH_MAX_MIN}m)"
fi

# Preserve sqld_reachable_last_success / publish_fresh_last_success across
# runs — set to now on OK, carry forward the previous timestamp on FAIL so
# the dashboard can render "Xm ago" elapsed-time.
sqld_last_success=""
publish_fresh_last_success=""
if [ -f "$STATUS_FILE" ]; then
  _prev_status=$(cat "$STATUS_FILE" 2>/dev/null | tr -d '\n')
  sqld_last_success=$(json_str "$_prev_status" "sqld_reachable_last_success")
  publish_fresh_last_success=$(json_str "$_prev_status" "publish_fresh_last_success")
fi
if [ "$sqld_ok" = "true" ]; then
  sqld_last_success=$(date -u +%Y-%m-%dT%H:%M:%SZ)
fi
if [ "$pub_fresh" = "true" ]; then
  publish_fresh_last_success=$(date -u +%Y-%m-%dT%H:%M:%SZ)
fi

# ── Write status JSON (dashboard reads this) ─────────────────────────────────
cat > "$STATUS_FILE" << EOF
{
  "checked_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tailscale_ip": "${FLYIO_TAILSCALE_IP}",
  "tailscale_ok": ${ts_ok},
  "tailscale_latency": "${ts_ms}",
  "http_url": "${FLYIO_HTTP_URL}",
  "http_ok": ${http_ok},
  "http_code": "${http_code}",
  "sqld_reachable_url": "${SQLD_HEALTH_URL}",
  "sqld_reachable_ok": ${sqld_ok},
  "sqld_reachable_latency_ms": ${sqld_latency_ms:-null},
  "sqld_reachable_error_class": "${sqld_error_class}",
  "sqld_reachable_last_success": "${sqld_last_success}",
  "published_manifest_url": "${PUBLISHED_MANIFEST_URL}",
  "published_fresh_ok": ${pub_fresh},
  "published_age_min": ${pub_age:-null},
  "api2_fresh_ok": ${api2_fresh},
  "api2_age_min": ${api2_age:-null},
  "publish_fresh_last_success": "${publish_fresh_last_success}"
}
EOF
