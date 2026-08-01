############################################################
# StakTrakr Home Poller Container
# ────────────────────────────────
# Lightweight retail + spot poller for the home VM.
# Uses external Firecrawl (or direct Playwright) — no
# embedded Redis/RabbitMQ/PostgreSQL like the Fly.io image.
#
# Services (supervisord):
#   1. Cron       — retail poller, spot poller, provider export, goldback
#   2. Dashboard  — provider editor + status UI (port 3010)
#   3. Metrics    — Prometheus exporter (port 9100)
#
# Build context: devops/pollers/ (needs shared/ + home-poller/)
############################################################

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# System packages: cron, supervisor, chromium deps for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    cron \
    supervisor \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    procps \
    iputils-ping \
    openssl \
    # Chromium dependencies for Playwright
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# ── Block ad/tracker domains at OS level ──────────────────
# Same blocklist as fly container — reduces CPU/bandwidth ~30-50%.
RUN printf '%s\n' \
  '# --- Ad networks & trackers (blocked for scraper performance) ---' \
  '0.0.0.0 www.googletagmanager.com' \
  '0.0.0.0 googletagmanager.com' \
  '0.0.0.0 www.google-analytics.com' \
  '0.0.0.0 google-analytics.com' \
  '0.0.0.0 ssl.google-analytics.com' \
  '0.0.0.0 analytics.google.com' \
  '0.0.0.0 connect.facebook.net' \
  '0.0.0.0 www.facebook.com' \
  '0.0.0.0 pixel.facebook.com' \
  '0.0.0.0 bat.bing.com' \
  '0.0.0.0 clarity.ms' \
  '0.0.0.0 www.clarity.ms' \
  '0.0.0.0 cdn.klaviyo.com' \
  '0.0.0.0 static.hotjar.com' \
  '0.0.0.0 script.hotjar.com' \
  '0.0.0.0 js.hs-analytics.net' \
  '0.0.0.0 cdn.segment.com' \
  '0.0.0.0 cdn.amplitude.com' \
  '0.0.0.0 cdn.cookielaw.org' \
  '0.0.0.0 consent.cookiebot.com' \
  '0.0.0.0 js-agent.newrelic.com' \
  '0.0.0.0 bam.nr-data.net' \
  > /tmp/tracker-blocklist.txt

WORKDIR /app

# ── Shared poller code (single source of truth) ──────────
COPY shared/package.json shared/package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

# Cache-bust: change this value to force rebuild of JS layer
ARG CACHE_BUST=2026-03-19a
COPY shared/*.js ./
# Shared shell helpers (run-lock.sh) are sourced by run-home.sh at runtime.
# Without this the source fails and `set -e` aborts the whole run (STRK-255).
COPY shared/*.sh ./
COPY shared/.env.example ./.env.example

# Spot-poller Python source + deps
COPY shared/spot-poller/ /app/spot-poller/
RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "requests>=2.32.4" python-dotenv

# ── Home-specific files ──────────────────────────────────
COPY home-poller/dashboard.js ./dashboard.js
COPY home-poller/metrics-exporter.js ./metrics-exporter.js
COPY home-poller/run-home.sh ./run-home.sh
COPY home-poller/check-flyio.sh ./check-flyio.sh
RUN chmod +x run-home.sh check-flyio.sh

# ── Install Playwright Chromium ──────────────────────────
RUN npx playwright install chromium \
    && npx playwright install-deps chromium

# Move tracker blocklist into app dir
RUN mv /tmp/tracker-blocklist.txt /app/tracker-blocklist.txt

# ── Self-signed TLS cert for dashboard HTTPS (port 3011) ──
RUN openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /app/tls-key.pem -out /app/tls-cert.pem \
    -days 3650 -subj "/CN=staktrakr-home-poller"

# ── Supervisord config ───────────────────────────────────
COPY home-poller/supervisord.conf /etc/supervisor/conf.d/home-poller.conf

# ── Entrypoint ────────────────────────────────────────────
COPY home-poller/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Dashboard (HTTP + HTTPS) + Metrics ports
EXPOSE 3010 3011 9100

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
