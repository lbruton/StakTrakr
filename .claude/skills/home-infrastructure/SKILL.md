---
name: home-infrastructure
description: >
  Home network infrastructure index and deploy workflows — Portainer VM, NPM reverse proxy,
  Cloudflare tunnels, stack registry, volume inventory. Single source of truth for all local
  IPs, ports, and stack IDs. Use when deploying containers, managing proxy hosts, checking
  stack status, or any task involving the home network. Triggers on: "portainer", "docker deploy",
  "redeploy", "rebuild container", "container logs", "stack", "npm", "proxy", "reverse proxy",
  "SSL cert", "tunnel", "lbruton.cc", "home server", "192.168.1.*"
user-invocable: false
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Home Infrastructure

This skill provides **executable workflows and safety gates** for the home network. All reference data (IPs, stack IDs, ports, hostnames) lives in **DocVault** — read it before acting.

## Self-Diagnose via SSH — Never Ask the User

**Always diagnose infrastructure issues yourself. Never ask the user to check something you can SSH into or query via API.**

| Host          | SSH Command                | Notes                                        |
| ------------- | -------------------------- | -------------------------------------------- |
| Portainer VM  | `ssh lbruton@192.168.1.81` | Docker group; can run `docker` commands      |
| pve (node 1)  | `ssh root@192.168.1.150`   | Hosts VM 101 (Portainer), CT 102 (Semaphore) |
| pve2 (node 2) | `ssh root@192.168.1.151`   |                                              |
| pve3 (node 3) | `ssh root@192.168.1.152`   |                                              |
| ShadowNAS     | `ssh root@192.168.1.10`    | TrueNAS, NFS/SMB shares                      |

**Note:** `ssh -T` and `docker --context portainer` do NOT work from this Mac. Use `ssh lbruton@192.168.1.81` for shell access, or the Portainer REST API for container operations.

### Quick health checks

```bash
# Portainer API alive (no auth)
curl -sk https://192.168.1.81:9443/api/system/status

# Home poller — all services up, turso connected
curl -s http://192.168.1.81:9100/metrics | grep -E "poller_(service_up|turso_up)"

# Home poller — run capture rates (all should be 1.0000)
curl -s http://192.168.1.81:9100/metrics | grep poller_run_capture_rate

# Portainer VM — list all staktrakr containers
TOKEN=$(# fetch from Infisical lbruton.cc project)
curl -sk -H "X-API-Key: $TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json?all=true" \
  | python3 -c "import json,sys; [print(c['Names'], c['State']) for c in json.load(sys.stdin) if 'staktrakr' in str(c['Names']).lower()]"

# Proxmox — check VM 101 is running
ssh root@192.168.1.150 "qm status 101"
```

### Mandatory Vault Read — HARD GATE

**Before ANY action that depends on IPs, ports, stack IDs, or hostnames, read the relevant DocVault page(s):**

```
# Host inventory (IPs, VM/CT IDs, hostnames)
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Host Inventory.md

# Stack registry (stack IDs, ports, compose files, GitOps branches)
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Stack Registry.md

# Proxy hosts, SSL certs, traffic flow
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/NPM.md

# Portainer VM config, API, Docker
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Portainer.md

# DNS, tunnels, Zero Trust
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Cloudflare.md

# Network topology, LACP, access methods
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Home Network.md

# Docker volumes
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Named Volumes.md

# Backup system
Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Backups.md
```

**Do NOT cite IPs, ports, or stack IDs from this skill's embedded data or from memory — always read DocVault for current values.**

**Update rule:** When any infrastructure value changes, update the DocVault page via `/vault-update`. DocVault is the single source — no wiki sync needed.

---

## Standard Deploy Pattern

All projects follow the same workflow. Code lives in git, Portainer deploys from git.

```
1. Code changes in worktree branch
2. Commit → push (or merge PR) to tracked branch (dev or main)
3. Portainer GitOps polls every 5 minutes → detects change → pulls → rebuilds → restarts
4. Verify via Portainer API or web UI
```

**HARD BLOCK — Container and Stack Manipulation:**

```
NEVER do any of the following via the Portainer API or Docker API:
- DELETE a container  (/api/endpoints/{id}/docker/containers/{id})
- CREATE a container  (/api/endpoints/{id}/docker/containers/create)
- STOP or START a container directly
- Trigger /api/stacks/{id}/git/redeploy

These actions bypass GitOps and can wipe services that exist only on dev (not yet on main).
Docker Compose --remove-orphans will delete any container not in the pulled compose file.

The ONLY correct deploy workflow is:
  1. Commit the change to the stack's tracked git branch
  2. Push to origin
  3. Wait for Portainer GitOps to poll (every 5 min) and self-deploy
  4. Verify via Portainer API read-only calls (GET only)

If the user explicitly asks to force an immediate redeploy, confirm the stack's
GitConfig.ReferenceName matches the branch you just pushed to BEFORE calling git/redeploy.
If ReferenceName is "" or "refs/heads/main" and the change is on dev, DO NOT redeploy —
ask the user to fix the branch in the Portainer web UI first.
```

---

## Portainer API

| Property     | Value                                                              |
| ------------ | ------------------------------------------------------------------ |
| Web UI       | `https://192.168.1.81:9443`                                        |
| API endpoint | `https://192.168.1.81:9443/api`                                    |
| API key      | `PORTAINER_TOKEN` in Infisical lbruton.cc project, dev environment |
| Access       | Portainer REST API, web UI, or SSH as `lbruton` (docker group)     |
| OS           | Ubuntu (Docker via snap)                                           |

```bash
# Health check (no auth needed)
curl -sk https://192.168.1.81:9443/api/system/status

# List stacks
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/stacks"

# List containers on endpoint 3
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json?all=true"

# Container logs
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/logs?stdout=true&stderr=true&tail=50"

# Restart a container
curl -sk -X POST -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/restart"

# Stop a container
curl -sk -X POST -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/stop"
```

**Note:** `-sk` flags: `-s` silent, `-k` skip TLS verification (self-signed cert).

### Docker exec via Portainer API

Use this to run commands inside a running container (e.g. clear lock files, inspect state).
**IMPORTANT:** Capture the full exec ID — truncation causes "No such exec instance" errors.

```bash
TOKEN="<from-infisical lbruton.cc: PORTAINER_TOKEN>"
CONTAINER="<container-id or name>"
ENDPOINT=3
CMD='["your","command","here"]'   # JSON array, e.g. '["rm","-f","/tmp/retail-poller.lock"]'

# Step 1: Create exec instance — pipe through python3 to capture FULL Id (never truncate)
EXEC_ID=$(curl -sk -X POST \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"AttachStdout\":true,\"AttachStderr\":true,\"Cmd\":$CMD}" \
  "https://192.168.1.81:9443/api/endpoints/$ENDPOINT/docker/containers/$CONTAINER/exec" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['Id'])")

# Step 2: Start exec instance
curl -sk -X POST \
  -H "X-API-Key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"Detach":false}' \
  "https://192.168.1.81:9443/api/endpoints/$ENDPOINT/docker/exec/$EXEC_ID/start"
```

### Docker Socket Fix (snap quirk)

Snap-installed Docker resets socket group ownership on restart. A systemd oneshot service
(`docker-socket-fix.service`) persists the fix. If containers can't start after a VM reboot,
check via Proxmox console on VM 101.

---

## StakTrakr Home Poller

| Property  | Value                                           |
| --------- | ----------------------------------------------- |
| Container | `staktrakr-home-poller`                         |
| Stack ID  | 7 (verify in DocVault Stack Registry)           |
| Dashboard | `http://192.168.1.81:3010`                      |
| Metrics   | `http://192.168.1.81:9100/metrics` (Prometheus) |
| Endpoint  | 3                                               |

### Health verification

```bash
# Quick check — all three supervisord services must be 1
curl -s http://192.168.1.81:9100/metrics | grep poller_service_up

# Poller run stats
curl -s http://192.168.1.81:9100/metrics | grep -E "poller_run_(captured|failures|capture_rate)"
```

Expected healthy state: `cron=1`, `dashboard=1`, `metrics-exporter=1`, `turso_up=1`.
All pollers (`api`, `fly-spot`, `home`, `home-spot`) should have `capture_rate=1.0000`.

### Stale lock recovery

If retail scraper logs `Previous run still active, skipping` after a restart:

```bash
# Lock file is /tmp/retail-poller.lock inside the container
# Clear it via Portainer exec API (see Docker exec section above)
# Cmd: ["rm", "-f", "/tmp/retail-poller.lock"]
```

### Home-Poller Env Vars (for manual redeploy)

The home-poller stack (ID 7) requires env vars on manual redeploy. Fetch from Infisical:

```json
[
  { "name": "TURSO_DATABASE_URL", "value": "<from-infisical>" },
  { "name": "TURSO_AUTH_TOKEN", "value": "<from-infisical>" },
  { "name": "METAL_PRICE_API_KEY", "value": "<from-infisical>" },
  { "name": "GEMINI_API_KEY", "value": "<from-infisical>" },
  { "name": "FIRECRAWL_BASE_URL", "value": "http://firecrawl-api:3002" },
  { "name": "FLYIO_TAILSCALE_IP", "value": "100.90.171.110" },
  { "name": "FLYIO_HTTP_URL", "value": "https://api2.staktrakr.com/data/retail/providers.json" }
]
```

---

## Stack Registry

**Read from DocVault:** `Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Stack Registry.md`

Do not use embedded stack IDs or ports from this skill — read the vault page for current values.

---

## Named Volumes

**Read from DocVault:** `Read /Volumes/DATA/GitHub/DocVault/Infrastructure/Named Volumes.md`

**Never** run `docker volume rm` or `docker system prune --volumes` without reading the vault page first.

---

## Centralized Backup System (db-backup, Stack 13)

A `docker:27-cli` container with Docker socket access that dumps all project databases.

| Property   | Value                                             |
| ---------- | ------------------------------------------------- |
| Schedule   | Every 6 hours (`0 */6 * * *`) + on startup        |
| Backup dir | `/home/infrastructure/backups/` (host filesystem) |
| Retention  | 7 days (auto-cleanup)                             |

Backups write to host filesystem — survives Docker crashes, prune, snap reinstalls.
Proxmox nightly VM backup captures this directory automatically.

---

## NPM — Reverse Proxy and SSL

| Property | Value                    |
| -------- | ------------------------ |
| Host     | LXC 109 on pve2          |
| IP       | 192.168.1.40             |
| Web UI   | `http://192.168.1.40:81` |

**Traffic flow:** Browser → NPM (443, SSL termination) → Portainer VM (app port, HTTP) → container

---

## Networking

| Access method                                    | Use when                       |
| ------------------------------------------------ | ------------------------------ |
| LAN direct (`https://192.168.1.81:9443`)         | At desk, Portainer UI          |
| NPM (`https://project.lbruton.cc`)               | App access from any LAN device |
| Tailscale (`https://<ts-ip>:9443`)               | Remote access away from home   |
| Cloudflare tunnel (`https://project.lbruton.cc`) | Public internet access         |

MCP server configs that need to reach Portainer VM: use the **Tailscale IP** so they work
from both office and den.

---

## Portainer VM Directory Layout

```
/home/
├── infrastructure/          ← Global infrastructure data (bind-mounted by stacks)
│   ├── backups/             ← db-backup stack mounts here
│   └── loki/                ← logging stack mounts here
├── lbruton/                 ← User login (SSH)
└── portainer/               ← Service account (retained for UID compat)
```

**Snap Docker bind-mount restriction:** Docker installed via snap can only bind-mount
from `/home/`. All bind-mount targets must live under `/home/`.

---

## Troubleshooting

| Problem                              | Cause                                | Fix                                               |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------- |
| Portainer API returns 401            | Bad or expired API key               | Re-fetch `PORTAINER_TOKEN` from Infisical         |
| Portainer UI unreachable             | VM down or container stopped         | Check VM 101 in Proxmox (see `proxmox` skill)     |
| Container exits immediately          | Missing env vars                     | Check logs via Portainer API                      |
| Port conflict                        | Another container on same host port  | List containers via API                           |
| Stale containers after redeploy      | Old containers not removed           | Redeploy with `"prune": true`                     |
| Socket permission reset              | Snap Docker quirk                    | `docker-socket-fix.service` handles automatically |
| GitOps not picking up changes        | Wrong branch configured              | Check stack config in Portainer UI                |
| Env vars lost after manual redeploy  | Portainer replaces, doesn't merge    | Always pass full env array                        |
| Retail scraper stuck / skipping runs | Stale lock file from mid-run restart | Clear `/tmp/retail-poller.lock` via exec API      |

---

## Related Skills

- `proxmox` — Proxmox cluster management, corosync, TrueNAS, NFS
- `cloud-infrastructure` — Fly.io, GitHub Pages, Cloudflare Pages/DNS
- `api-infrastructure` — StakTrakr API feed architecture, dual-poller, sqld
- `secrets` — Fetch API keys and tokens from Infisical
