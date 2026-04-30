# StakTrakr Tailscale sidecar — wraps the upstream tailscale/tailscale image
# to re-apply the 192.168.1.0/24 subnet route after containerboot starts.
#
# Why: containerboot drops TS_ROUTES from prefs on restart when the persistent
# state volume is present. Without re-applying, Fly.io silently loses its route
# to home sqld (192.168.1.81:8080). See STRK-6 / Foundation/infrastructure.md.

FROM tailscale/tailscale:latest

COPY docker-entrypoint.sh /usr/local/bin/strk-tailscale-entrypoint.sh
RUN chmod +x /usr/local/bin/strk-tailscale-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/strk-tailscale-entrypoint.sh"]
