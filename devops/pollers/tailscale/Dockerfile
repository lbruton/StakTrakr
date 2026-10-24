# StakTrakr Tailscale sidecar — wraps the upstream tailscale/tailscale image
# to re-apply the 192.168.1.0/24 subnet route after containerboot starts.
#
# Why: containerboot drops TS_ROUTES from prefs on restart when the persistent
# state volume is present. Without re-applying, Fly.io silently loses its route
# to home sqld (192.168.1.81:8080). See STRK-6 / Foundation/infrastructure.md.

FROM tailscale/tailscale:v1.104.2@sha256:b11583ad2e93e4671128538c88cf11f460444a5d7e449311dd1933a400ab849d

COPY docker-entrypoint.sh /usr/local/bin/strk-tailscale-entrypoint.sh
RUN chmod +x /usr/local/bin/strk-tailscale-entrypoint.sh

# Runs as root by design: tailscaled opens /dev/net/tun and sets routes under
# NET_ADMIN (docker-compose.tinyproxy.yml), as the upstream image does.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint, dockerfile.security.missing-user.missing-user
ENTRYPOINT ["/usr/local/bin/strk-tailscale-entrypoint.sh"]
