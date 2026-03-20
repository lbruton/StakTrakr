#!/bin/bash
set -e

echo "[entrypoint] Starting StakTrakr all-in-one container..."

# ── 0. Inject tracker blocklist into /etc/hosts ─────────────────────────
# /etc/hosts is read-only during Docker build but writable at runtime.
if [ -f /app/tracker-blocklist.txt ]; then
  cat /app/tracker-blocklist.txt >> /etc/hosts
  echo "[entrypoint] Tracker blocklist injected ($(wc -l < /app/tracker-blocklist.txt) entries)"
fi

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

# ── 3. Initialize PostgreSQL ───────────────────────────────────────────
PG_DATA="/var/lib/postgresql/17/main"
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  echo "[entrypoint] Initializing PostgreSQL..."
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres /var/lib/postgresql
  su - postgres -c "/usr/lib/postgresql/17/bin/initdb -D $PG_DATA"

  # Enable pg_cron and tune for Firecrawl
  echo "shared_preload_libraries = 'pg_cron'" >> "$PG_DATA/postgresql.conf"
  echo "cron.database_name = 'postgres'" >> "$PG_DATA/postgresql.conf"
  # Listen on localhost only (container-internal)
  sed -i "s/#listen_addresses = 'localhost'/listen_addresses = 'localhost'/" "$PG_DATA/postgresql.conf"
  # Allow local connections without password
  echo "local all all trust" > "$PG_DATA/pg_hba.conf"
  echo "host all all 127.0.0.1/32 trust" >> "$PG_DATA/pg_hba.conf"

  # Start postgres temporarily to run init SQL
  su - postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D $PG_DATA -w start"
  su - postgres -c "psql -f /opt/postgres/nuq.sql" || echo "[entrypoint] WARN: nuq.sql init had errors (non-fatal)"
  su - postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D $PG_DATA -w stop"
  echo "[entrypoint] PostgreSQL initialized."
else
  echo "[entrypoint] PostgreSQL data directory exists, skipping init."
  chown -R postgres:postgres /var/lib/postgresql
fi

# ── 4. (Clone removed) run-local.sh clones fresh each run ──────────────
# API repo is no longer cloned at entrypoint — stateless clone in run-local.sh

# ── 5.5. Dynamic cron schedule (overrides Dockerfile baked-in crontab) ──
# ENV toggles: set RETAIL_ENABLED=0 or GOLDBACK_ENABLED=0 to disable those crons.
# When retail is disabled, retry is also skipped (no retail data to retry).
RETAIL_ENABLED="${RETAIL_ENABLED:-1}"
GOLDBACK_ENABLED="${GOLDBACK_ENABLED:-1}"
CRON_SCHEDULE="${CRON_SCHEDULE:-15,45}"
if [ "$RETAIL_ENABLED" = "1" ] && ! echo "$CRON_SCHEDULE" | grep -qE '^[0-9*/,\-]+$'; then
  echo "[entrypoint] ERROR: Invalid CRON_SCHEDULE '${CRON_SCHEDULE}' — aborting." >&2
  exit 1
fi
echo "[entrypoint] Writing cron schedule (retail=${RETAIL_ENABLED}, goldback=${GOLDBACK_ENABLED})..."
: > /etc/cron.d/retail-poller
if [ "$RETAIL_ENABLED" = "1" ]; then
  echo "${CRON_SCHEDULE} * * * * root . /etc/environment; /app/run-local.sh >> /var/log/retail-poller.log 2>&1" >> /etc/cron.d/retail-poller
  echo "15 * * * * root . /etc/environment; /app/run-retry.sh >> /var/log/retail-retry.log 2>&1" >> /etc/cron.d/retail-poller
else
  echo "[entrypoint] Retail + retry crons DISABLED"
fi
echo "0,30 * * * * root . /etc/environment; /app/run-spot.sh >> /var/log/spot-poller.log 2>&1" >> /etc/cron.d/retail-poller
echo "8,23,38,53 * * * * root . /etc/environment; /app/run-publish.sh >> /var/log/publish.log 2>&1" >> /etc/cron.d/retail-poller
if [ "$GOLDBACK_ENABLED" = "1" ]; then
  echo "1 * * * * root . /etc/environment; /app/run-goldback.sh >> /var/log/goldback-poller.log 2>&1" >> /etc/cron.d/retail-poller
else
  echo "[entrypoint] Goldback cron DISABLED"
fi
echo "*/5 * * * * root . /etc/environment; cd /app && node export-providers-json.js >> /var/log/provider-export.log 2>&1" >> /etc/cron.d/retail-poller
chmod 0644 /etc/cron.d/retail-poller

# ── 5.6. Tailscale state directory (on persistent /data volume) ───────
mkdir -p /data/tailscale /var/run/tailscale /data/retail

# ── 6. Create log files ───────────────────────────────────────────────
touch /var/log/retail-poller.log /var/log/http-server.log \
      /var/log/spot-poller.log /var/log/publish.log /var/log/retail-retry.log \
      /var/log/goldback-poller.log /var/log/provider-export.log

echo "[entrypoint] Handing off to supervisord..."
exec "$@"
