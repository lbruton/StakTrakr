# GEMINI.md

**For Gemini CLI (Interactive Agent)** — Full peer agent in the specflow stack.
Specializes in: documentation, research, security, and full-lifecycle spec implementation.

> See `~/.gemini/GEMINI.md` for global workflow rules, mandatory gates, and shared peer stack protocols.

---

## Peer Stack Context

| Agent | Focus in StakTrakr |
|-------|--------------------|
| Claude Code | Architecture, feature implementation, Browserbase testing |
| Codex | Adversarial review, localStorage data modeling, security |
| Gemini | Specflow orchestration, DocVault truth, API infrastructure, audits |

## Project Context

**StakTrakr** is a vanilla JS inventory system. Zero build step, zero dependencies.
**Key mandate:** All DOM access must use `safeGetElement(id)` from `js/utils.js`.

## Specflow Lifecycle

Specs live in `.spec-workflow/specs/`. Use the following tools:

- `spec-workflow.spec-status` — Check task progress
- `spec-workflow.log-implementation` — Mandatory after every task
- `code-graph-context` — Map script load order and function calls

## Security & Audit

- **Storage**: Inventory data lives in `localStorage`. Validate encryption/decryption logic in `js/vault.js`.
- **API**: Fly.io pollers populate the market/spot feeds. Verify stale thresholds during audits.
- **Secrets**: Use Infisical for test keys and API credentials.

## Issue Tracking

DocVault Prefix: `STAK-`. All code changes require a DocVault issue.
