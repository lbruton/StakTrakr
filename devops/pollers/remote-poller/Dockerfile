############################################################
# StakTrakr Thin Publisher — Fly.io Container
# ─────────────────────────────────────────────
# Lightweight publisher: reads from Turso, exports JSON,
# pushes to GitHub Pages. No scraping, no browsers.
#
#   1. Cron            — spot poll + publish + provider export
#   2. serve.js        — HTTP health endpoint (port 8080)
#   3. Tailscale       — diagnostic VPN to home network
#
# Managed by supervisord. ~150MB image vs ~2GB all-in-one.
# Full image archived as Dockerfile.full for rollback.
############################################################

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# System packages: git (GitHub Pages push), cron, supervisor, jq (publish logging),
# python3/make/g++ (native addon compilation for better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    cron \
    ca-certificates \
    supervisor \
    curl \
    gnupg \
    jq \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Tailscale (kept for diagnostics — free, no harm)
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
      > /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
      > /etc/apt/sources.list.d/tailscale.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends tailscale iptables \
    && rm -rf /var/lib/apt/lists/*

# ── Poller app ────────────────────────────────────────────
WORKDIR /app

# Shared poller code (single source of truth)
COPY shared/package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev

COPY shared/*.js ./
# Shared shell helpers (run-lock.sh). run-local.sh is not shipped in this slim
# image today, but keeping the helper present means re-enabling it cannot
# silently reintroduce the STRK-255 wedge.
COPY shared/*.sh ./

# Remote-specific scripts (spot + publish + cleanup)
COPY remote-poller/run-spot.sh remote-poller/run-publish.sh remote-poller/cleanup-export.sh ./
RUN chmod +x run-spot.sh run-publish.sh cleanup-export.sh

# Git config for committing to api branch
RUN git config --global user.name "StakTrakr Poller" \
    && git config --global user.email "poller@staktrakr.local"

# ── Cron jobs (baked-in defaults — entrypoint overwrites) ──
RUN (echo "0,30 * * * * root . /etc/environment; /app/run-spot.sh >> /var/log/spot-poller.log 2>&1"; \
     echo "8,23,38,53 * * * * root . /etc/environment; /app/run-publish.sh >> /var/log/publish.log 2>&1"; \
     echo "*/5 * * * * root . /etc/environment; cd /app && node export-providers-json.js >> /var/log/provider-export.log 2>&1"; \
     echo "17 3 * * 0 root . /etc/environment; /app/cleanup-export.sh >> /var/log/cleanup.log 2>&1") \
    > /etc/cron.d/retail-poller \
    && chmod 0644 /etc/cron.d/retail-poller

# ── Supervisord config ───────────────────────────────────
COPY remote-poller/supervisord-slim.conf /etc/supervisor/conf.d/staktrakr.conf

# ── Entrypoint ────────────────────────────────────────────
COPY remote-poller/docker-entrypoint-slim.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
