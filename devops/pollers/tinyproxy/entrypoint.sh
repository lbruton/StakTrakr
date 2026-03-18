#!/bin/sh
# tinyproxy entrypoint — wait for shared network namespace from tailscale sidecar
# network_mode: container:tailscale-staktrakr means we have no network if tailscale isn't up
#
# The compose healthcheck on tailscale gates our startup via depends_on,
# but we still verify the network is actually routable before binding.

set -e

# Ensure log directory exists (Alpine package may not create it)
mkdir -p /var/log/tinyproxy
chown tinyproxy:tinyproxy /var/log/tinyproxy

# Wait for a routable (non-loopback) network interface
# With depends_on + healthcheck this should be near-instant, but we retry
# generously in case of transient namespace delays
TIMEOUT=300
ELAPSED=0
echo "tinyproxy: waiting for network namespace..."
while ! grep -q '00000000' /proc/net/route 2>/dev/null; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "tinyproxy: ERROR — no routable interface after ${TIMEOUT}s. Is tailscale-staktrakr running?"
    exit 1
  fi
done
echo "tinyproxy: network ready after ${ELAPSED}s"

# Also wait for the Tailscale IP to be assigned (100.x.x.x)
ELAPSED=0
echo "tinyproxy: waiting for Tailscale IP..."
while ! ip addr 2>/dev/null | grep -q '100\.'; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "tinyproxy: WARNING — no Tailscale IP after ${TIMEOUT}s, starting anyway"
    break
  fi
done
if ip addr 2>/dev/null | grep -q '100\.'; then
  TS_IP=$(ip addr 2>/dev/null | grep -o '100\.[0-9.]*' | head -1)
  echo "tinyproxy: Tailscale IP ${TS_IP} ready after ${ELAPSED}s"
fi

# Forward port 8191 from Tailscale namespace to Docker host → Byparr container.
# Fly.io reaches Byparr at 100.112.198.50:8191 via Tailscale, socat routes to
# the Docker bridge gateway (host port 8191 → staktrakr-byparr:8191).
GATEWAY=$(ip route | grep default | awk '{print $3}')
if [ -n "$GATEWAY" ]; then
  echo "tinyproxy: starting socat port 8191 forwarder to gateway ${GATEWAY}"
  socat TCP-LISTEN:8191,fork,reuseaddr TCP:${GATEWAY}:8191 &
fi

exec tinyproxy -d
