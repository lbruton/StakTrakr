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

Before discussing architecture, infra, or UI design, read the corresponding Foundation doc (e.g., `design-philosophy.md` for UI). Run the `vault-drift` skill after architectural changes to ensure DocVault is in sync.

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

## SessionFlow — Cross-Harness History Search

SessionFlow provides semantic search over historical conversation history across all agents and harnesses (`claude_code_cli`, `codex`, `opencode`, `antigravity_desktop`, `antigravity_cli`).

- **Search All Sessions:** Use `search_all_sessions` to search globally.
  - Useful for finding past PR audits, research summaries, or system setups.
  - Can be filtered by `provider` (e.g. `codex`, `claude_code_cli`), `git_branch`, or `project_root` (use `*` for cross-repo results).
- **Search Current Session:** Use `search_session` to query the current session history (results are boosted by recency). Pass `session_id` using the current session environment.
- **Retrieve Context:** After finding a match, use `get_turns` with the `session_id` and `turn_index` to fetch preceding/succeeding turns (defaults to 2 turns surrounding the hit) to understand the context of a decision.

## Skills — StakTrakr Quick Reference

Skills are invoked via natural language in Antigravity 2.0 (see global `GEMINI.md` for the full progressive disclosure model). Below are the most common StakTrakr workflows and how to trigger them:

| Workflow          | How to invoke                                | What it does                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------- |
| **Sketch**        | "sketch requirements for STRK-88"            | Middle-tier spec: 4 phased markdown artifacts in DocVault |
| **Sketch review** | "review the requirements phase for STRK-88"  | Peer review of a sketch phase                             |
| **Discover**      | "discover STRK-88" / "research this issue"   | Phase 1 structured brainstorm, produces Discovery Brief   |
| **Release**       | "release patch" / "run the release workflow" | Version lock → worktree → bump → commit → PR              |
| **Retro**         | "run a retro" / "session retrospective"      | End-of-session prescriptive lessons → mem0                |
| **Health check**  | "health check" / "project health"            | Code quality + security + instruction file scan           |
| **Dogfood**       | "dogfood the app" / "QA StakTrakr"           | Exploratory testing with screenshots and repro steps      |
| **Vault drift**   | "check for vault drift"                      | Detect DocVault ↔ source code divergence                  |

**Phase-by-phase sketch invocation** (most common multi-step workflow):

1. "sketch new STRK-88 fp-price-artifact" → scaffold
2. "sketch requirements for STRK-88" → phase 1
3. "review requirements for STRK-88" → peer review
4. "sketch discovery for STRK-88" → phase 2
5. ... continue through approach → tasks → apply

**Tip:** For multi-step skills, always name the skill and the subcommand explicitly. The agent needs both to route correctly.
