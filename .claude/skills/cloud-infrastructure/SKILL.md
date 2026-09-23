---
name: cloud-infrastructure
description: >
  Cloud-hosted infrastructure — Fly.io container deploys, GitHub Pages API serving,
  Cloudflare Pages frontend deploys, Cloudflare DNS. Use when deploying to Fly.io,
  checking cloud health, managing Cloudflare settings, or debugging GitHub Pages serving.
  Triggers on: "fly deploy", "fly.io", "cloudflare pages", "github pages",
  "api.staktrakr.com", "cloud deploy", "remote poller"
user-invocable: true
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent
---

# Cloud Infrastructure

This skill provides **executable workflows and safety gates** for cloud-hosted services. Reference data lives in the in-repo **`.context/`** docs (Cloudflare in DocVault) — read them before acting.

## Mandatory Context Read — HARD GATE

**Before ANY cloud action (deploy, debug, config change), read the relevant in-repo `.context/` doc(s):**

```text
# Fly.io app config, resources, deployment, secrets, CI/CD
Read .context/infrastructure.md

# GitHub Pages API serving, GHA workflows, cron, thresholds
Read .context/data-pipelines.md

# DNS, tunnels, Cloudflare Pages (cross-project — lives in DocVault)
Read /Volumes/DATA/GitHub/DocVault/KnowledgeBase/Infrastructure/Cloudflare.md
```

**Do NOT cite app names, resource limits, regions, or domains from memory — always read the docs above for current values.** Source code wins on conflict: `devops/pollers/remote-poller/fly.toml` is authoritative for Fly.io config.

**Update rule:** When any cloud config changes (resource limits, env vars, domains, workflows), fix the matching `.context/` doc in the same PR and run `/context-drift`. Cloudflare changes go to DocVault via `/vault-update`.

Everything hosted outside the home network.

---

## Fly.io — StakTrakr Thin Publisher

| Property  | Value                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| App       | `staktrakr`                                                                                                                     |
| Region    | `dfw` (fly.toml)                                                                                                                |
| Resources | 512MB RAM, 1 shared CPU                                                                                                         |
| Config    | `StakTrakr/devops/pollers/remote-poller/fly.toml` + `Dockerfile`                                                                |
| Runs      | Spot cron, publish cron, serve.js. Retail/goldback disabled (`RETAIL_ENABLED=0`, `GOLDBACK_ENABLED=0`) — handled by home poller |
| Logs      | `fly logs --app staktrakr`                                                                                                      |
| SSH       | `fly ssh console --app staktrakr`                                                                                               |

> **STAK-478 (2026-03-19):** Fly.io was slimmed from a fat all-in-one container to a thin publisher. Retail and goldback scraping moved to the home poller. Firecrawl/Playwright/Redis/RabbitMQ/PostgreSQL are still in the image but idle.

### Deploy Workflow

**The golden rule:** All poller code lives in `StakTrakr/devops/pollers/`. Deploy from there.
Never deploy uncommitted code. Never deploy from StakTrakrApi repo (legacy — code migrated).

#### Safety Gates (mandatory before ANY deploy)

1. **Correct repo:** `cd /Volumes/DATA/GitHub/StakTrakr && git rev-parse --show-toplevel` must return StakTrakr
2. **On dev or merged branch:** Changes must be on `dev` or a merged branch
3. **Synced with remote:** `git fetch origin dev && git rev-list HEAD..origin/dev --count` must return `0`
4. **No uncommitted changes:** `git status --short -- devops/pollers/` must be empty
5. **Change is present:** `git log --oneline -5 -- devops/pollers/` must show your change

All 5 gates must pass before proceeding.

#### Pre-Deploy Validation

```bash
# Compare env vars (code expects vs Fly has)
Use `Grep` tool: `pattern="process\\.env\\.(\w+)"`, `path="devops/pollers/"`, `output_mode="content"` — then deduplicate the captured group values.
fly secrets list --app staktrakr
```

#### Deploy

**IMPORTANT: Build context must be `devops/pollers/` (parent dir), NOT `remote-poller/`.**
The Dockerfile references `shared/` and `remote-poller/` as sibling directories.
The `context = ".."` in `fly.toml` does NOT resolve correctly with Depot or Docker Desktop
— always deploy from the parent directory with explicit flags:

```bash
cd /Volumes/DATA/GitHub/StakTrakr/devops/pollers
fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile --app staktrakr
```

> **Known issue:** Running `fly deploy` from `remote-poller/` sends 0 bytes of Docker context
> (both Depot and local Docker). Always run from the `pollers/` parent directory.

#### Post-Deploy

1. Wait 30 seconds for container to stabilize
2. Run the health check from `api-infrastructure` skill
3. Check container logs: `fly logs --app staktrakr | tail -30`
4. Home-poller picks up shared code changes via Portainer GitOps (5 min poll) — or trigger manual redeploy via Portainer web UI

#### Rollback

```bash
fly releases --app staktrakr
fly deploy --image registry.fly.io/staktrakr:deployment-PREVIOUS_ID --app staktrakr
```

After rollback: verify health, diagnose from logs, fix in new PR, re-deploy.
**Never hot-patch the container directly.**

### Common Deploy Mistakes

| Mistake                                 | Prevention                                   |
| --------------------------------------- | -------------------------------------------- |
| Deploy from an unmerged worktree branch | Gate 2: must be on `dev` or a merged branch  |
| Deploy from StakTrakrApi repo           | Gate 1: must be in StakTrakr (code migrated) |
| Deploy uncommitted changes              | Gate 4: no uncommitted devops changes        |
| Forget to update home-poller            | Post-deploy step 4                           |
| Skip health check                       | Post-deploy step 2                           |

---

## GitHub Pages — API Serving

| Property | Value                                      |
| -------- | ------------------------------------------ |
| Repo     | `lbruton/StakTrakrApi`                     |
| Branch   | `api`                                      |
| Domain   | `api.staktrakr.com`                        |
| Content  | Static JSON feeds (market, spot, goldback) |

The `api` branch is a write-only output channel for the pollers. Multiple agents push to it
concurrently (Fly.io container, GHA merge-poller workflow).

### GHA Workflows

| Workflow                | Schedule                    | Purpose                                          |
| ----------------------- | --------------------------- | ------------------------------------------------ |
| `Merge Poller Branches` | `*/15 min`                  | Merges `api` → `main` → triggers GH Pages deploy |
| `spot-poller.yml`       | **RETIRED** (dispatch only) | Was Python→MetalPriceAPI; now Fly.io             |

---

## Cloudflare Pages — StakTrakr Frontend

StakTrakr frontend auto-deploys via Cloudflare Pages on push to `dev`.

| Property | Value                                     |
| -------- | ----------------------------------------- |
| Branch   | `dev`                                     |
| Domain   | `beta.staktrakr.com` (preview)            |
| Deploy   | Automatic on push — no manual step needed |

---

## Cloudflare DNS

| Property    | Value                                                 |
| ----------- | ----------------------------------------------------- |
| Domain      | `lbruton.cc`                                          |
| Tier        | Free                                                  |
| Nameservers | `dell.ns.cloudflare.com`, `john.ns.cloudflare.com`    |
| Records     | `A @ → 192.168.1.40`, `A * → 192.168.1.40` (DNS only) |

Used for all `*.lbruton.cc` subdomains routed through NPM (see `home-infrastructure`).
Cloudflare API token for Let's Encrypt DNS challenge: `CLOUDFLARE_TOKEN` in Infisical.

---

## Related Skills

- `home-infrastructure` — NPM, networking, stack registry, backups, VM-level
- `portainer` — Portainer REST API, container/stack ops, GitOps deploy, exec
- `api-infrastructure` — Feed architecture, dual-poller, health checks, sqld
- Secrets — `mcp__infisical__get-secret` with the StakTrakr project UUID (see CLAUDE.md Pre-flight); `fly secrets list --app staktrakr` for what Fly has
