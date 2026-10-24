#!/bin/bash
set -e

echo "[entrypoint] Starting StakTrakr home poller container..."

# ── 0. Inject tracker blocklist into /etc/hosts ─────────────────────────
if [ -f /app/tracker-blocklist.txt ]; then
  cat /app/tracker-blocklist.txt >> /etc/hosts
  echo "[entrypoint] Tracker blocklist injected ($(wc -l < /app/tracker-blocklist.txt) entries)"
fi

# ── 1. Export env vars for cron jobs (cron doesn't inherit Docker env) ──
# The jobs run as node, so node reads it through the group; nobody else can.
# Root's HOME/USER/LOGNAME stay out: sourcing them would override node's own.
printenv | grep -vE '^(_|HOME|USER|LOGNAME)=' > /etc/environment
chown root:node /etc/environment
chmod 640 /etc/environment

# ── 2. Create data directories ──────────────────────────────────────────
mkdir -p /data/retail /data/api /data/hourly /data/logs

# ── 3. Write cron schedule ──────────────────────────────────────────────
# Home poller cron schedule (STAK-478: home is sole retail+goldback scraper):
#   Retail:  :30 (home only — Fly.io does NOT scrape retail)
#   Spot:    :15,:45 (staggered from Fly.io spot at :00,:30)
#   Goldback: :05 hourly (CurrencyLayer-backed rate shifts intraday — STRK-58)
#   Provider export: every 5 min (same as Fly.io)
#   Fly.io health check: every 5 min
echo "[entrypoint] Writing cron schedule..."
cat > /etc/cron.d/home-poller << 'CRON'
# StakTrakr home poller cron jobs
30 * * * * node . /etc/environment; /app/run-home.sh >> /data/logs/retail-poller.log 2>&1
15,45 * * * * node . /etc/environment; POLLER_ID=home-spot METAL_PRICE_API_KEY=$METAL_PRICE_API_KEY DATA_DIR=/data SQLD_URL=$SQLD_URL SQLD_AUTH_TOKEN=$SQLD_AUTH_TOKEN TURSO_DATABASE_URL=$TURSO_DATABASE_URL TURSO_AUTH_TOKEN=$TURSO_AUTH_TOKEN node /app/spot-extract.js >> /data/logs/spot-poller.log 2>&1
5 * * * * node . /etc/environment; cd /app && node goldback-scraper.js >> /data/logs/goldback-poller.log 2>&1
*/5 * * * * node . /etc/environment; cd /app && node export-providers-json.js >> /data/logs/provider-export.log 2>&1
*/5 * * * * node . /etc/environment; /app/check-flyio.sh >> /data/logs/flyio-check.log 2>&1
0 3 * * * node . /etc/environment; node /app/turso-backup-sync.js >> /data/logs/turso-sync.log 2>&1
CRON
chmod 0644 /etc/cron.d/home-poller

# ── 4. Create log files (on persistent volume) ───────────────────────────
touch /data/logs/retail-poller.log /data/logs/spot-poller.log \
      /data/logs/goldback-poller.log /data/logs/provider-export.log \
      /data/logs/flyio-check.log /data/logs/turso-sync.log
# Symlink for dashboard compatibility
ln -sf /data/logs/retail-poller.log /var/log/retail-poller.log

# ── 5. Hand the data volume to node ─────────────────────────────────────
# The volume keeps files written by earlier root-run images; re-own only those.
find /data ! -user node -exec chown node:node {} +

# ── 6. Docker socket access for the dashboard container list ────────────
# The socket's group id comes from the host, so match it at runtime. A gid-0
# socket would put node in the root group; the container list stays empty then.
sock_gid=$( [ -S /var/run/docker.sock ] && stat -c %g /var/run/docker.sock || echo 0)
if [ "$sock_gid" != "0" ]; then
  sock_group=$(getent group "$sock_gid" | cut -d: -f1)
  if [ -z "$sock_group" ]; then
    sock_group=dockersock
    groupadd -g "$sock_gid" "$sock_group"
  fi
  usermod -aG "$sock_group" node
fi

echo "[entrypoint] Handing off to supervisord..."
exec "$@"
