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
STATUS_FILE="/tmp/flyio-health.json"
TIMEOUT=10
SQLD_HEALTH_TIMEOUT=8

log() { echo "[$(date -u +%H:%M:%S)] [flyio-check] $*"; }

# Extract a JSON field from a single-line response. Shape is fixed by
# serve.js (no nesting), so grep is sufficient — no jq dependency.
json_bool() { echo "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*(true|false)" | grep -oE "(true|false)$"; }
json_num()  { echo "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*[0-9]+" | grep -oE "[0-9]+$"; }
json_str()  { echo "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | sed -E 's/.*"([^"]*)"$/\1/'; }

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

# Preserve sqld_reachable_last_success across runs — set to now on OK,
# carry forward the previous timestamp on FAIL so the dashboard can render
# "Xm ago" elapsed-time.
sqld_last_success=""
if [ -f "$STATUS_FILE" ]; then
  sqld_last_success=$(json_str "$(cat "$STATUS_FILE" 2>/dev/null | tr -d '\n')" "sqld_reachable_last_success")
fi
if [ "$sqld_ok" = "true" ]; then
  sqld_last_success=$(date -u +%Y-%m-%dT%H:%M:%SZ)
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
  "sqld_reachable_last_success": "${sqld_last_success}"
}
EOF
