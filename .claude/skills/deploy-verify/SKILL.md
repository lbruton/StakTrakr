---
name: deploy-verify
description: >
  Post-deploy verification for both Portainer (home) and Fly.io (cloud) environments.
  Runs environment-appropriate health checks, log inspection, env var verification,
  cron validation, and endpoint smoke tests. Covers the gap between "deploy succeeded"
  and "deploy actually works." Triggers on: "deploy verify", "post-deploy", "verify deploy",
  "smoke test deploy", "did the deploy work", "check the deploy", "/deploy-verify"
user-invocable: true
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# Deploy Verify

Post-deploy verification skill for both deployment environments. Bridges the gap between
"container started" and "service actually works" — the source of multiple past regressions
(Docker entrypoint overwrites, missing crons, poisoned data, env var drift).

## When to Run

- After any Portainer GitOps deploy completes (push → wait 5 min → verify)
- After any `fly deploy` command
- After any manual container restart or redeploy
- When something "feels off" after a deploy

## Step 1 — Identify the Environment

Ask the user (or infer from context):

| Question              | Portainer (Home)                                  | Fly.io (Cloud)            |
| --------------------- | ------------------------------------------------- | ------------------------- |
| Where did you deploy? | Portainer stack on 192.168.1.81                   | `fly deploy --app <name>` |
| Which project?        | Any (see Stack Registry in `home-infrastructure`) | StakTrakr pollers         |
| How was it deployed?  | GitOps auto-pull or manual redeploy               | Manual `fly deploy` CLI   |

## Step 2 — Run the Shared Checklist

These checks apply to BOTH environments. Run them in order.

### 2a. Container is Running

**Portainer:**

```bash
# Get Portainer token from Infisical first
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/json?all=true" | \
  jq '.[] | select(.Names[] | contains("<stack-name>")) | {name: .Names[0], state: .State, status: .Status}'
```

**Fly.io:**

```bash
fly status --app staktrakr
```

Expected: container state is "running", not "restarting" or "exited".

### 2b. Logs Show No Errors

**Portainer:**

```bash
# Get container ID from step 2a, then:
curl -sk -H "X-API-Key: $PORTAINER_TOKEN" \
  "https://192.168.1.81:9443/api/endpoints/3/docker/containers/<id>/logs?stdout=true&stderr=true&tail=50" | \
  strings
```

**Fly.io:**

```bash
fly logs --app staktrakr | tail -50
```

Look for:

- Startup errors, crash loops, missing module errors
- `ECONNREFUSED` or `ENOTFOUND` (broken service dependencies)
- `Error:` or `FATAL:` lines
- Missing environment variable warnings

### 2c. Environment Variables Match Infisical

Both environments pull secrets from Infisical. Verify no drift.

**Portainer:** Check the stack's env vars via Portainer API or compose file:

```bash
# What the code expects:
grep -rh 'process\.env\.' <project-path>/**/*.js 2>/dev/null | \
  grep -oP 'process\.env\.(\w+)' | sort -u

# What the container has — check stack config or docker inspect
```

**Fly.io:**

```bash
# What the code expects:
grep -rh 'process\.env\.' /Volumes/DATA/GitHub/StakTrakr/devops/pollers/shared/*.js /Volumes/DATA/GitHub/StakTrakr/devops/pollers/remote-poller/*.sh 2>/dev/null | \
  grep -oP 'process\.env\.(\w+)' | sort -u

# What Fly has:
fly secrets list --app staktrakr
```

Flag any variable the code references that isn't set in the environment.

### 2d. Cron Jobs Present (if applicable)

Past regression: Docker entrypoint overwrote Dockerfile cron entries.

**Portainer:**

```bash
# SSH into Portainer VM, exec into container:
ssh lbruton@192.168.1.81 "docker exec <container-name> crontab -l"
```

**Fly.io:**

```bash
fly ssh console --app staktrakr -C "crontab -l"
```

Compare against the expected crons in the Dockerfile or entrypoint script.

### 2e. Endpoint Smoke Test

Hit the actual production endpoint and verify a real response.

**Portainer apps:**

```bash
# Use the NPM domain (e.g., hextrackr.lbruton.cc, mymelo.lbruton.cc)
curl -s -o /dev/null -w "%{http_code}" https://<app>.lbruton.cc/
# Or hit the direct port:
curl -s -o /dev/null -w "%{http_code}" http://192.168.1.81:<port>/
```

**Fly.io (StakTrakr API):**

```bash
# Health/manifest endpoint
curl -s https://api.staktrakr.com/data/manifest.json | jq '.feeds | length'

# Spot price freshness
curl -s https://api.staktrakr.com/data/spot/latest.json | jq '.timestamp'

# Retail providers
curl -s https://api.staktrakr.com/data/retail/providers.json | jq 'length'
```

Expected: HTTP 200, valid JSON, recent timestamps (not stale/poisoned data).

### 2f. Data Integrity Check

Past regression: MetalPriceAPI format change poisoned spot data.

- Compare a sample of current data against known-good baseline
- Check timestamps are recent (within expected cycle time)
- Verify data format hasn't changed (field names, structure)

## Step 3 — Environment-Specific Checks

### Portainer Only

| Check                       | How                                                                       |
| --------------------------- | ------------------------------------------------------------------------- |
| GitOps branch matches       | Verify stack's `GitConfig.ReferenceName` matches the branch you pushed to |
| Volume mounts intact        | `docker inspect <container>` — check Mounts match expected volumes        |
| No orphaned containers      | Compare running containers against Stack Registry                         |
| Backup system still running | Check db-backup container (Stack 13) last run time                        |

### Fly.io Only

| Check                     | How                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| Correct release deployed  | `fly releases --app staktrakr` — latest matches your deploy                                   |
| Resource limits unchanged | `fly scale show --app staktrakr` — 512MB RAM, 1 shared CPU (thin publisher since STAK-478)    |
| Tailscale mesh connected  | Home-poller can reach Fly.io via `100.90.171.110`                                             |
| Home-poller synced        | Portainer home-poller picks up shared code via GitOps (5 min poll) — verify it redeployed too |

## Step 4 — Report

Output a summary:

```text
Deploy Verification — <project> on <environment>
──────────────────────────────────────────────────
Container running:     ✓ / ✗
Logs clean:            ✓ / ✗ (note any warnings)
Env vars match:        ✓ / ✗ (list missing)
Cron jobs present:     ✓ / ✗ / N/A
Endpoint responds:     ✓ / ✗ (HTTP status)
Data integrity:        ✓ / ✗ (freshness)
Environment-specific:  ✓ / ✗ (details)
──────────────────────────────────────────────────
Overall: PASS / FAIL
```

If any check fails, provide the specific remediation step before moving on.

## How the Environments Compare

| Dimension         | Portainer (Home)                            | Fly.io (Cloud)                        |
| ----------------- | ------------------------------------------- | ------------------------------------- |
| Deploy trigger    | GitOps auto-pull (5 min) or manual redeploy | Manual `fly deploy` CLI               |
| Container runtime | Docker via snap on Ubuntu VM                | Fly.io Machines (Firecracker)         |
| Secrets source    | Infisical → stack env vars or compose       | Infisical → `fly secrets set`         |
| Logs              | Portainer API or `docker logs`              | `fly logs`                            |
| SSH access        | `ssh lbruton@192.168.1.81` + `docker exec`  | `fly ssh console`                     |
| Rollback          | Portainer re-pulls previous commit          | `fly deploy --image <previous>`       |
| Networking        | NPM reverse proxy → container port          | Fly.io edge → internal port           |
| Volumes           | Named Docker volumes (see inventory)        | Fly.io volumes (ephemeral by default) |
| Monitoring        | Dozzle, Grafana, Homepage                   | `fly logs`, Grafana (InfluxDB)        |

**What's the same:**

- Both use Docker containers with similar Dockerfile patterns
- Both pull secrets from Infisical as source of truth
- Both need env var verification against what the code expects
- Both need log inspection and endpoint smoke testing
- Both have rollback procedures (git revert + redeploy, or image rollback)
- Both should never be hot-patched directly in the container

## Related Skills

- `home-infrastructure` — Portainer API, stack registry, NPM proxy
- `cloud-infrastructure` — Fly.io deploy workflow, safety gates, rollback
- `secrets` — Infisical API keys and env var management
