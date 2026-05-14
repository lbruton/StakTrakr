# StakTrakr — Gemini Instructions

Precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence. Zero build step.

These are the Gemini-specific instructions for the StakTrakr project. They inherit from `~/.gemini/GEMINI.md` and StakTrakr's `AGENTS.md` / `CLAUDE.md`.

## Your Primary Roles in StakTrakr

1. **UI/UX & Mockups:** StakTrakr has a very specific brand personality ("Sharp. Capable. Empowering. Precision tool, not generic fintech"). Ensure all UI designs, mockups, and reviews adhere to the three themes (light, dark, sepia) and prioritize information density over simplicity.
2. **Playwright Testing:** You are responsible for reviewing, troubleshooting, and occasionally writing Playwright E2E tests (`npm test`, `npm run test:offline`).
3. **SpecFlow Reviews:** When reviewing sketch artifacts (`DocVault/Projects/StakTrakr/sketches/`), focus on user-facing constraints, cross-view consistency, and accessibility.

## Commands

No application build step is required.

- `python3 -m http.server 8000` — local server
- `npm test` — Playwright E2E tests (requires Browserbase)
- `npm run test:offline` — Playwright tests, skip network-dependent
- `npm run lint` — ESLint

## Documentation & Knowledge Base

Foundation docs: `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/`

Before discussing architecture, infra, or UI design, read the corresponding Foundation doc (e.g., `design-philosophy.md` for UI). Use `activate_skill` with `vault-drift` after architectural changes to ensure DocVault is in sync.

## Dual Config Store — CRITICAL

StakTrakr uses two separate localStorage stores. **Confusing them causes silent data loss.**

- **Spot providers:** `metalApiConfig` (Read via `loadApiConfig()`, Write via `saveApiConfig()`)
- **Catalog providers:** `catalog_api_config` (Read via `catalogConfig.getNumistaConfig()`, Write via `catalogConfig.setNumistaConfig()`) — always read/write catalog keys through the `catalogConfig` helpers, never `loadApiConfig()`.

## Testing Guardrails (TDD)

**RED FLAG: NEVER modify a TDD test to make it pass.**
Tests define correct behavior. If a test fails, the implementation is wrong. If the test itself is flawed, the spec was wrong — STOP implementation and restart the spec from Phase 1. Do not coach around the `block-tdd-test-modification` hook.

## Release & Git Workflow

- **Branch model:** `feature/* → dev → main`. All commits go through worktree branch → PR → dev.
- **Worktrees:** Required for every code change. Ensure you are working in the `.worktrees/` directory before editing files.
- **Version Lock:** Claim a version in `devops/version.lock` before starting work.
- **Pre-commit Hooks:** `check-release-sync` ensures `constants.js` and other version files match. `stamp-sw-cache` updates `sw.js` automatically.

If you are asked to review a PR or a set of changes before a release, verify that the 5 core version files (`js/constants.js`, `package.json`, `version.json`, `CHANGELOG.md`, `js/about.js`) have been updated in sync.
