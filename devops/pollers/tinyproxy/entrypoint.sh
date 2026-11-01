#!/bin/sh
# tinyproxy entrypoint — wait for shared network namespace from tailscale sidecar
# network_mode: container:tailscale-staktrakr means we have no network if tailscale isn't up
#
# The compose healthcheck on tailscale gates our startup via depends_on,
# but we still verify the network is actually routable before binding.

set -e

# Tailnet peers allowed to use the proxy come from the stack env, so the public
# repo holds no addresses. Without them Fly.io cannot reach the proxy, so stop.
CONF=/tmp/tinyproxy.conf

# Succeeds for one IPv4 or IPv6 address with an optional CIDR prefix; hostnames,
# ports and out-of-range octets or prefixes fail.
valid_addr() {
  printf '%s\n' "$1" | awk '
    function prefix_ok(p, max) { return p ~ /^[0-9]+$/ && p + 0 <= max }
    {
      n = split($0, part, "/")
      if (n > 2) exit 1
      a = part[1]
      if (a ~ /^[0-9.]+$/) {
        if (n == 2 && !prefix_ok(part[2], 32)) exit 1
        if (split(a, oct, ".") != 4) exit 1
        for (i = 1; i <= 4; i++)
          if (oct[i] !~ /^[0-9][0-9]?[0-9]?$/ || oct[i] + 0 > 255) exit 1
        exit 0
      }
      if (a !~ /^[0-9a-fA-F:]+$/) exit 1
      if (n == 2 && !prefix_ok(part[2], 128)) exit 1
      if (a ~ /:::/ || (a ~ /^:/ && a !~ /^::/) || (a ~ /:$/ && a !~ /::$/)) exit 1
      rest = a
      doubles = gsub(/::/, "", rest)
      if (doubles > 1) exit 1
      groups = 0
      g = split(a, grp, ":")
      for (i = 1; i <= g; i++) {
        if (grp[i] == "") continue
        if (grp[i] !~ /^[0-9a-fA-F][0-9a-fA-F]?[0-9a-fA-F]?[0-9a-fA-F]?$/) exit 1
        groups++
      }
      if (doubles == 0 && groups != 8) exit 1
      if (doubles == 1 && groups > 7) exit 1
      exit 0
    }'
}

cp /etc/tinyproxy/tinyproxy.conf "$CONF"
ALLOWED=0
for addr in $(echo "${TINYPROXY_ALLOW:-}" | tr ',' ' '); do
  if ! valid_addr "$addr"; then
    echo "tinyproxy: ERROR — TINYPROXY_ALLOW entry '${addr}' is not an IP address or CIDR"
    exit 1
  fi
  echo "Allow ${addr}" >> "$CONF"
  ALLOWED=$((ALLOWED + 1))
done
if [ "$ALLOWED" -eq 0 ]; then
  echo "tinyproxy: ERROR — TINYPROXY_ALLOW has no addresses. Set it to the tailnet addresses of this VM and the Fly.io container."
  exit 1
fi

# The image creates and owns the log directory; a root override must keep it.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /var/log/tinyproxy
  chown tinyproxy:tinyproxy /var/log/tinyproxy
fi

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
# Fly.io reaches Byparr at <home-tailnet-ip>:8191 via Tailscale, socat routes to
# the Docker bridge gateway (host port 8191 → staktrakr-byparr:8191).
GATEWAY=$(ip route | grep default | awk '{print $3}')
if [ -n "$GATEWAY" ]; then
  echo "tinyproxy: starting socat port 8191 forwarder to gateway ${GATEWAY}"
  socat TCP-LISTEN:8191,fork,reuseaddr TCP:${GATEWAY}:8191 &
fi

exec tinyproxy -d -c "$CONF"
