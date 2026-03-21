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

# System packages: git (for GitHub Pages push), cron, supervisor, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    cron \
    ca-certificates \
    supervisor \
    curl \
    gnupg \
    lsb-release \
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
RUN npm install --omit=dev

COPY shared/*.js ./

# Remote-specific scripts (spot + publish only)
COPY remote-poller/run-spot.sh remote-poller/run-publish.sh ./
RUN chmod +x run-spot.sh run-publish.sh

# Git config for committing to api branch
RUN git config --global user.name "StakTrakr Poller" \
    && git config --global user.email "poller@staktrakr.local"

# ── Cron jobs (baked-in defaults — entrypoint overwrites) ──
RUN (echo "0,30 * * * * root . /etc/environment; /app/run-spot.sh >> /var/log/spot-poller.log 2>&1"; \
     echo "8,23,38,53 * * * * root . /etc/environment; /app/run-publish.sh >> /var/log/publish.log 2>&1"; \
     echo "*/5 * * * * root . /etc/environment; cd /app && node export-providers-json.js >> /var/log/provider-export.log 2>&1") \
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
