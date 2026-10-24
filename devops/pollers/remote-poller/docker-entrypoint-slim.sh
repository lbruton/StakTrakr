#!/bin/bash
set -e

echo "[entrypoint] Starting StakTrakr thin publisher..."

# ── 1. Export env vars for cron jobs (cron doesn't inherit Docker env) ──
# The jobs run as node, so node reads it through the group; nobody else can.
# Root's HOME/USER/LOGNAME stay out: sourcing them would point node's git at /root.
printenv | grep -vE '^(_|HOME|USER|LOGNAME)=' > /etc/environment
chown root:node /etc/environment
chmod 640 /etc/environment

# ── 2. Configure git credentials ───────────────────────────────────────
# The publish job pushes as node, so the store helper reads node's home.
_GIT_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -n "$_GIT_TOKEN" ]; then
  git config --system credential.helper store
  printf 'https://x-access-token:%s@github.com\n' "$_GIT_TOKEN" > /home/node/.git-credentials
  chown node:node /home/node/.git-credentials
  chmod 600 /home/node/.git-credentials
fi

# ── 3. Write cron schedule ─────────────────────────────────────────────
# STRK-402: every job is wrapped in `flock -n <job>.flock timeout -k 30 <N>`.
# `flock -n` guarantees at most one instance of a given job runs at a time —
# belt-and-suspenders alongside each script's own internal lock — and
# `timeout -k 30 <N>` puts a hard ceiling on a single run so a stalled sqld
# connection or a hung network fetch can no longer wedge a cron slot forever
# (the OOM-killed repack that caused the 2026-09-26 outage held its slot for
# 86 minutes with nothing to stop it). Budgets: spot 600s, publish 720s,
# provider-export 240s, cleanup 1800s — all comfortably above observed normal
# run time, tight enough to guarantee eventual recovery.
#
# Cleanup runs DAILY (03:17 UTC, between the :08 and :23 publish slots). It
# was weekly until the STRK-402 soak measured the real growth rate: each
# publish leaves ~325 loose git objects, ~31k inodes/day, so the volume
# (195,840 inodes) hit run-publish.sh's INODE_FLOOR after ~5 days — before the
# Sunday cron ever ran — and the cleanup executed inside a publish slot
# instead (2026-10-02 01:23 UTC, 83s). Daily keeps each run to ~31k loose
# objects (~15s) and leaves the pre-flight floor as a true backstop.
echo "[entrypoint] Writing cron schedule (spot + publish + provider-export + daily cleanup)..."
: > /etc/cron.d/retail-poller
echo "0,30 * * * * node . /etc/environment; flock -n /tmp/spot.flock timeout -k 30 600 /app/run-spot.sh >> /var/log/spot-poller.log 2>&1" >> /etc/cron.d/retail-poller
echo "8,23,38,53 * * * * node . /etc/environment; flock -n /tmp/publish-cron.flock timeout -k 30 720 /app/run-publish.sh >> /var/log/publish.log 2>&1" >> /etc/cron.d/retail-poller
echo "*/5 * * * * node . /etc/environment; cd /app && flock -n /tmp/provider-export.flock timeout -k 30 240 node export-providers-json.js >> /var/log/provider-export.log 2>&1" >> /etc/cron.d/retail-poller
echo "17 3 * * * node . /etc/environment; flock -n /tmp/cleanup-cron.flock timeout -k 30 1800 /app/cleanup-export.sh >> /var/log/cleanup.log 2>&1" >> /etc/cron.d/retail-poller
chmod 0644 /etc/cron.d/retail-poller

# ── 4. Tailscale state directory (on persistent /data volume) ──────────
mkdir -p /data/tailscale /var/run/tailscale /data/retail

# ── 5. Create log files ────────────────────────────────────────────────
touch /var/log/spot-poller.log /var/log/publish.log \
      /var/log/http-server.log /var/log/provider-export.log /var/log/cleanup.log
chown node:node /var/log/spot-poller.log /var/log/publish.log \
      /var/log/http-server.log /var/log/provider-export.log /var/log/cleanup.log

# ── 6. Hand the data volume to node, except tailscaled's root-owned state ──
# /data stays root-owned and sticky: node creates entries there (the reshallow
# git-dir, the squash month marker) but cannot rename root's /data/tailscale.
# The volume keeps files written by earlier root-run images; re-own only those.
chown root:node /data
chmod 1775 /data
find /data -mindepth 1 -path /data/tailscale -prune -o ! -user node -exec chown -h node:node -- {} +

echo "[entrypoint] Handing off to supervisord..."
exec "$@"
