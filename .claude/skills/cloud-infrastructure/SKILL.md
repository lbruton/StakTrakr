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
| Resources | 1024MB RAM, 1 shared CPU (raised from 512 in STRK-277 — `fly.toml` is authoritative)                                            |
| Config    | `StakTrakr/devops/pollers/remote-poller/fly.toml` + `Dockerfile`                                                                |
| Runs      | Spot cron, publish cron, serve.js. Retail/goldback disabled (`RETAIL_ENABLED=0`, `GOLDBACK_ENABLED=0`) — handled by home poller |
| Logs      | `fly logs --app staktrakr`                                                                                                      |
| SSH       | `fly ssh console --app staktrakr`                                                                                               |

> **STAK-478 (2026-03-19):** Fly.io was slimmed from a fat all-in-one container to a thin publisher. Retail and goldback scraping moved to the home poller. The active image is the slim build (`node:20-slim` + `supervisord-slim.conf`) — Firecrawl, Playwright browsers, Redis, RabbitMQ, and PostgreSQL are **not** in it, so never troubleshoot them on Fly.

### Deploy Workflow

**The golden rule:** All poller code lives in `StakTrakr/devops/pollers/`. Deploy from there.
Never deploy uncommitted code. Never deploy from StakTrakrApi repo (legacy — code migrated).

#### Safety Gates (mandatory before ANY deploy)

1. **Correct repo:** `cd /Volumes/DATA/GitHub/StakTrakr && git rev-parse --show-toplevel` must return StakTrakr
2. **HEAD is exactly the reviewed, pushed `dev`:** `git fetch origin dev && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/dev)"` must succeed. Equality rules out BOTH failure modes — an unmerged feature branch based on `dev` and local commits that were never pushed (a behind-only check like `git rev-list HEAD..origin/dev` passes on both).
3. **No uncommitted changes:** `git status --short -- devops/pollers/` must be empty
4. **Change is present:** `git log --oneline -5 -- devops/pollers/` must show your change
5. **Deploy window:** the current minute is between `:08:30` and `:23:00` — the only stretch per hour with no spot (`:00/:30`) or publish (`:08/:23/:38/:53`) cron. A deploy restarts the container and silently kills whichever cycle is running. Re-check the crons in `.context/infrastructure.md` if they may have changed.

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

| Mistake                               | Prevention                                   |
| ------------------------------------- | -------------------------------------------- |
| Deploy an unmerged or unpushed branch | Gate 2: HEAD must equal `origin/dev`         |
| Deploy from StakTrakrApi repo         | Gate 1: must be in StakTrakr (code migrated) |
| Deploy uncommitted changes            | Gate 3: no uncommitted devops changes        |
| Deploy mid-cycle                      | Gate 5: `:08:30`–`:23:00` window only        |
| Forget to update home-poller          | Post-deploy step 4                           |
| Skip health check                     | Post-deploy step 2                           |

---

## GitHub Pages — API Serving

| Property | Value                                      |
| -------- | ------------------------------------------ |
| Repo     | `lbruton/StakTrakrApi`                     |
| Branch   | `api`                                      |
| Domain   | `api.staktrakr.com`                        |
| Content  | Static JSON feeds (market, spot, goldback) |

GitHub Pages serves the `api` branch directly. Its **sole writer** is `run-publish.sh` on
Fly.io, which force-pushes `HEAD:api` each publish cycle — there is no `main` merge step and
no other concurrent writer. A stale feed means a failed publish on Fly, not a stuck workflow.

### GHA Workflows

| Workflow                | Status                      | Note                                                               |
| ----------------------- | --------------------------- | ------------------------------------------------------------------ |
| `Merge Poller Branches` | **RETIRED** (manual-only)   | Never an operational control surface — do not wait on or re-run it |
| `spot-poller.yml`       | **RETIRED** (dispatch only) | Was Python→MetalPriceAPI; now Fly.io                               |

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
