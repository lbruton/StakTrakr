---
tags: []
doc_type: overview
project: StakTrakr
source: manual
created: "2026-04-26"
updated: "2026-06-05"
---

# StakTrakr

Precious metals inventory tracker — vanilla-JS PWA with offline-first localStorage, real-time spot prices, retail dealer monitoring, and encrypted Dropbox sync. Frontend on Cloudflare Pages; thin publisher API on Fly.io; price/scraping pollers on home Docker + Fly.io.

## At a Glance

| Field | Value |
|-------|-------|
| Repo | [lbruton/StakTrakr](https://github.com/lbruton/StakTrakr) |
| Language | Vanilla JS (ES modules) — no framework |
| Branches | `dev` (PR target), `main` (release) |
| Version Lock | `devops/version.lock` |
| npm `version` | `3.35.6` (private) |
| Issue Tracker | [Plane STRK](https://plane.lbruton.cc/lbruton/) (migrated 2026-04-26 — was `STAK-` historically) |
| PR Target | `dev` (signed commits + PR + status checks required) |

## Architecture

PWA frontend on Cloudflare Pages consuming three feeds:

1. **Spot prices** — MetalPriceAPI → home poller + Fly.io poller → sqld → JSON manifests
2. **Retail prices** — home poller scrapes vendor sites (3-phase CF bypass) → sqld → manifests
3. **Goldback prices** — 56 per-state slugs scraped on home poller

Data flows through a thin publisher API on Fly.io (`api.staktrakr.com`) and GitHub Pages JSON. Cloud sync via Dropbox OAuth + AES-256-GCM with atomic rollback.

## Foundation

Canonical foundation docs at `Projects/StakTrakr/Foundation/` — start here for any work.

| Doc | What's there |
|-----|-------------|
| Architecture (archived) | System design, frontend/API/data model, sqld schema |
| Cloud Sync (archived) | Dropbox OAuth, AES-256-GCM, atomic rollback, multi-tab |
| Coding Standards (archived) | DOM patterns, localStorage rules, service worker, release workflow |
| Data Pipelines (archived) | Spot / retail / goldback / image — cron, thresholds, failure modes |
| Design Philosophy (archived) | Brand, color palette, typography, component patterns |
| Infrastructure (archived) | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds |
| Reusable Patterns (archived) | Vendor normalization, providers.json, retail modal, chart abstractions |

Drift audit: `/vault-drift StakTrakr`.

## Deep Dives

Detailed reference docs live in `Foundation/Deep Dives/` — linked from the Foundation summaries above.

| Doc | What's there |
|-----|-------------|
| API Reference (archived) | REST endpoint schemas and response formats |
| Data Model (archived) | Inventory item schema, storage keys, localStorage structure |
| DOM Patterns (archived) | DOM utility API reference and edge cases |
| Health Checks (archived) | Stale thresholds, diagnostic scripts, incident log |
| Home Poller (archived) | Docker stacks, dashboard, CF bypass sidecar |
| Image Pipeline (archived) | Client-side image system |
| Provider Database (archived) | Provider CRUD API and dashboard |
| Remote Poller (archived) | Fly.io container, supervisord, tiered recovery |
| Retail Modal (archived) | Modal lifecycle and data flow |
| Secret Keys (archived) | Secret rotation procedures |
| Vendor Quirks (archived) | Per-vendor scraping notes and workarounds |

## Workflow

- Worktree + PR mandatory; PRs target `dev`.
- `dev → main` merges only on explicit "release" / "ready to ship" signal.
- Version bumps via `/release patch|minor|major`.
- Pre-Plane issues archived at [[../../Archive/Issues-Pre-Plane/StakTrakr/StakTrakr|Archive/Issues-Pre-Plane/StakTrakr]].
