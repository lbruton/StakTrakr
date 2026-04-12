#!/bin/bash
# StakTrakr Home Poller — LXC Ubuntu 24.04 setup script
# Run this once inside the LXC container as root.

set -e

echo "=== Installing Node.js 22 ==="
apt update
apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo "Node: $(node -v), npm: $(npm -v)"

echo "=== Creating poller directory ==="
mkdir -p /opt/poller/data/retail
mkdir -p /opt/poller/data/api
mkdir -p /var/log

echo "=== Copying poller files ==="
# Run from the StakTrakrApi/devops/retail-poller directory on your workstation:
#   rsync -av . root@<LXC_IP>:/opt/poller/
# Or copy files manually. Required files:
#   price-extract.js  db.js  sqld-client.js  api-export.js  package.json
#   run-home.sh  .env  data/retail/providers.json

echo "=== Installing npm dependencies ==="
cd /opt/poller
npm install

echo "=== Installing Chromium for Playwright ==="
npx playwright install chromium
npx playwright install-deps chromium

echo "=== Setting permissions ==="
chmod +x /opt/poller/run-home.sh

echo "=== Installing crontab ==="
cat > /etc/cron.d/retail-poller << 'EOF'
# StakTrakr home poller — runs at :30 past every hour
# Offset from Fly.io :00 run to stagger Turso writes
30 * * * * root /opt/poller/run-home.sh >> /var/log/retail-poller.log 2>&1
*/5 * * * * root . /opt/poller/.env; cd /opt/poller && node export-providers-json.js >> /var/log/provider-export.log 2>&1
EOF
chmod 644 /etc/cron.d/retail-poller

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to /opt/poller/.env and fill in Turso credentials"
echo "  2. Copy providers.json to /opt/poller/data/retail/providers.json"
echo "  3. Test run: cd /opt/poller && bash run-home.sh"
echo "  4. Check logs: tail -f /var/log/retail-poller.log"
