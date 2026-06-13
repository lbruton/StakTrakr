#!/bin/bash
set -e

echo "[entrypoint] Starting StakTrakr thin publisher..."

# ── 1. Export env vars for cron jobs (cron doesn't inherit Docker env) ──
printenv | grep -v '^_=' > /etc/environment
chmod 600 /etc/environment

# ── 2. Configure git credentials ───────────────────────────────────────
_GIT_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -n "$_GIT_TOKEN" ]; then
  git config --global credential.helper store
  printf 'https://x-access-token:%s@github.com\n' "$_GIT_TOKEN" > /root/.git-credentials
  chmod 600 /root/.git-credentials
fi

# ── 3. Write cron schedule ─────────────────────────────────────────────
echo "[entrypoint] Writing cron schedule (spot + publish + provider-export + weekly cleanup)..."
: > /etc/cron.d/retail-poller
echo "0,30 * * * * root . /etc/environment; /app/run-spot.sh >> /var/log/spot-poller.log 2>&1" >> /etc/cron.d/retail-poller
echo "8,23,38,53 * * * * root . /etc/environment; /app/run-publish.sh >> /var/log/publish.log 2>&1" >> /etc/cron.d/retail-poller
echo "*/5 * * * * root . /etc/environment; cd /app && node export-providers-json.js >> /var/log/provider-export.log 2>&1" >> /etc/cron.d/retail-poller
echo "17 3 * * 0 root . /etc/environment; /app/cleanup-export.sh >> /var/log/cleanup.log 2>&1" >> /etc/cron.d/retail-poller
chmod 0644 /etc/cron.d/retail-poller

# ── 4. Tailscale state directory (on persistent /data volume) ──────────
mkdir -p /data/tailscale /var/run/tailscale /data/retail

# ── 5. Create log files ────────────────────────────────────────────────
touch /var/log/spot-poller.log /var/log/publish.log \
      /var/log/http-server.log /var/log/provider-export.log /var/log/cleanup.log

echo "[entrypoint] Handing off to supervisord..."
exec "$@"
