---
tags: [index]
updated: 2026-09-26
---

# StakTrakr Index

Overview (archived) — one-page summary of stack, data pipelines, foundation, and workflow.

## Foundation

| Doc | What's there |
|-----|-------------|
| Architecture (archived) | System design, frontend/API/data model, sqld schema |
| Cloud Sync (archived) | Dropbox OAuth, AES-256-GCM, rollback, backup/restore, multi-tab, synced Collections visibility and restore reconciliation |
| Coding Standards (archived) | DOM patterns, localStorage, service worker, release workflow, testing |
| Data Pipelines (archived) | Spot / retail / goldback / image pipelines — cron, thresholds, failure modes |
| Design Philosophy (archived) | Brand, colors, typography, component patterns |
| Infrastructure (archived) | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds |
| Reusable Patterns (archived) | Vendor normalization, providers.json, retail modal, chart abstractions |

## Subpages

Unique operational detail not covered by Foundation docs.

| Page | Summary |
|------|---------|
| API Reference (archived) | Complete endpoint reference (v1/v2), JSON schemas, confidence tiers, stale_after values, v2 manifest |
| Data Model (archived) | Item schema, Collection state and visibility preferences, ALLOWED_STORAGE_KEYS grouped by domain |
| DOM Patterns (archived) | safeGetElement dummy element interface, about.js startup exception, STAK-492 crash context |
| Health Checks (archived) | Python quick-check script, stale-threshold table, diagnose-by-symptom table, incident log |
| Home Poller (archived) | Docker stack IDs/ports, dashboard features, 3-phase CF bypass pipeline, env vars, Portainer commands |
| Image Pipeline (archived) | IDB schema (4 stores), image resolution cascade, all public methods, seed-images.js architecture |
| Playwright Suite Rationalization (archived) | Research roadmap for reducing the Playwright suite into a smaller risk-based core plus fast unit coverage |
| Provider Database (archived) | Full SQL DDL, complete provider-db.js API (22 functions), dashboard CRUD endpoints, STAK-496 migration |
| Remote Poller (archived) | supervisord services, exact cron, publish pipeline steps, deployment commands, volume seeding |
| Retail Modal (archived) | retail.js vs retail-view-modal.js separation, all key functions, intraday + 7-day trend pipelines |
| Secret Keys (archived) | Rotation procedures per credential, Infisical project ID, Home Docker env block |
| Vendor Quirks (archived) | Poller-side vendor API structures, CF bypass history, OOS rendering, anomaly detection thresholds |

## Archived (Depreciated)

Legacy docs superseded by Foundation. Retained for historical context and wikilink compatibility.

| Page | Summary |
|------|---------|
| API Consumption (archived) | Frontend-only consumer pulling three data feeds from api.staktrakr.com (GitHub Pages) |
| Architecture (archived) | System diagram: PWA frontend, Cloudflare Pages, GitHub Pages API, Fly.io thin publisher, and home poller |
| Architecture (canvas) (archived) | Canvas: full system architecture with frontend, API layer, Fly.io, home VM, sqld, Dropbox, and Cloudflare |
| Backup & Restore (archived) | Cloud storage backup/restore: encrypted Dropbox sync, vault export/import, and inventory management |
| Cloud Sync (archived) | Dropbox OAuth cloud sync with AES-256-GCM encryption, diff modal, and merge/overwrite modes |
| Frontend Overview (archived) | Frontend architecture: 71-script dependency chain, service worker, settings, charts, and module inventory |
| Goldback Pipeline (archived) | Goldback price scraping: 56 per-state slugs across 8 states and 7 denominations via home poller |
| Overview (archived) | Precious metals portfolio tracker: vanilla JS PWA with real-time spot prices, retail monitoring, and offline-first localStorage |
| Poller Parity (archived) | Historical comparison of Fly.io vs home poller capabilities (retained after thin-publisher migration) |
| Providers Config (archived) | providers.json catalog: URL patterns, weight, purity, and SKU configuration for retail dealers |
| Release Workflow (archived) | Structured patch versioning: isolated worktrees, version.lock bumps, and dev-branch PRs |
| Retail Pipeline (archived) | Retail market price pipeline: home poller scraping, 3-phase extraction, sqld storage, and manifest publishing |
| Retail Pipeline (canvas) (archived) | Canvas: end-to-end retail price flow from vendor scraping through price-extract to frontend display |
| Service Worker (archived) | Vanilla service worker for PWA: asset pre-caching, offline support, and auto-stamped CACHE_NAME |
| Spot Pipeline (archived) | Spot price polling: MetalPriceAPI integration, dual-poller schedule, sqld storage, and stale thresholds |
| Spot Pipeline (canvas) (archived) | Canvas: spot price flow from MetalPriceAPI through extraction to sqld, hourly JSON, and frontend |
| Storage Patterns (archived) | localStorage persistence rules: saveData/loadData wrappers, allowlist guard, and direct-access exceptions |
| Style Guide (archived) | Living design system: brand identity, color palette, typography, and component styling reference |
| Turso Schema (archived) | Self-hosted sqld database schema: price_snapshots, spot_prices, providers, and slugs tables |

## Security

| Page | Summary |
|------|---------|
| Security Reviews (archived) | Security architecture reviews |
