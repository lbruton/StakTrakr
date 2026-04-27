#!/bin/sh
# StakTrakr Tailscale wrapper — backgrounds containerboot, re-applies the
# 192.168.1.0/24 subnet route via `tailscale set`, then foregrounds.
#
# Works around containerboot dropping TS_ROUTES from prefs on restart when
# the persistent state volume already contains a prefs file. The wrapper is
# idempotent: `tailscale set` with current prefs is a no-op.

ROUTE="192.168.1.0/24"
TIMEOUT=120

/usr/local/bin/containerboot &
BOOT_PID=$!

# Forward SIGTERM/SIGINT so `docker stop` and `compose down` terminate
# tailscaled cleanly instead of waiting out the 10s grace period.
forward() {
  kill -TERM "$BOOT_PID" 2>/dev/null
  wait "$BOOT_PID" 2>/dev/null
  exit $?
}
trap forward TERM INT

# Wait for tailscaled to be ready, using the same probe as the compose
# healthcheck. 120s covers cold-start auth refresh after long downtime.
echo "[tailscale-wrapper] waiting up to ${TIMEOUT}s for tailscaled..."
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  if tailscale status --peers=false 2>/dev/null | grep -q '100\.'; then
    echo "[tailscale-wrapper] ready after ${ELAPSED}s"
    break
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "[tailscale-wrapper] WARN: tailscaled not ready after ${TIMEOUT}s; skipping route apply"
else
  echo "[tailscale-wrapper] applying --advertise-routes=${ROUTE} --advertise-exit-node"
  tailscale set --advertise-routes="$ROUTE" --advertise-exit-node \
    || echo "[tailscale-wrapper] WARN: tailscale set failed; route may be missing"
fi

wait "$BOOT_PID"
exit $?
