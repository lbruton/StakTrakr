---
sketch: "STRK-57-quiet-playwright-logs"
phase: requirements
created: 2026-05-11
revised: 2026-05-11
supersedes: discussion/requirements.v1.md
---

# STRK-57 — Requirements

> **Source Issue:** [STRK-57](https://plane.lbruton.cc/lbruton/browse/STRK-57/)
>
> **Title:** Quiet Playwright web server asset logging
>
> **Description:** Follow-up from STRK-54 verification: full Playwright runs are hard to scan because the local test web server logs every static asset request. Use a quieter local server configuration in the Playwright `webServer` block while preserving useful failure signal. Test-harness change only.

## Overview

Suppress per-request access logging emitted by `python3 -m http.server` during Playwright runs so test output is scannable and real failures surface immediately. The fix is confined to `playwright.config.js`'s `webServer` block. No test behavior, runtime code, or deployment config changes.

## User Stories

- **US-1:** As a developer running Playwright tests, I want static-asset access logs suppressed during test runs, so test output is scannable and real test failures are easy to spot.
- **US-2:** As a developer debugging a test failure, I want missing assets and server-start failures to remain visibly diagnosable, so I can root-cause problems without re-enabling noisy request logging.

## Acceptance Criteria

### AC-1 — Request log suppression (maps to US-1)
- **Given** a Playwright test run is executing via `npm test` or `npx playwright test`
- **When** the Playwright `webServer` process starts the local Python HTTP server
- **Then** zero `[WebServer]` HTTP access log lines (e.g., `[WebServer] ::1 - - [...] "GET /css/styles.css HTTP/1.1" 200 -`) appear in the test output

### AC-2 — Failure signal preserved (maps to US-2)
- **Given** the `webServer` configuration suppresses access logs
- **When** an asset is missing or the server fails to start
- **Then** the failure is still visible — missing assets surface as Playwright test-level failures (assertion / page-error / function-not-found), and a server that fails to bind surfaces as a Playwright `webServer` health-check timeout reported by Playwright itself
- **Note:** This sketch explicitly does NOT require Python's own stderr 404 log lines to remain visible. They are redundant with Playwright test failures, and the chosen suppression mechanism necessarily removes them.

### AC-3 — No regressions in test suite
- **Given** the `webServer` configuration has been modified
- **When** the full Playwright test suite is run (`npm test`)
- **Then** all existing tests pass with zero new failures relative to the pre-change baseline (currently 599 tests in 53 files, as reported by `npx playwright test --list` on 2026-05-11)

## Non-Goals

- Not modifying any test file or test behavior — harness-only change
- Not changing the production server, deployment config, or runtime code
- Not suppressing Playwright's own reporter output, debug output, or test failure output
- Not adding a build step or Node-based dev server — preserve the zero-build guarantee
- Not changing `reuseExistingServer`, `workers`, or any other test architecture knob
- **Not solving the `reuseExistingServer` bypass for local dev.** When a developer already has a server on port 3000 (e.g., from a prior aborted test run or an intentionally launched local server), Playwright reuses it and this fix has no effect. This is an intentional limitation — the AC targets the CI path and the common local case where port 3000 is free. Developers seeing residual noise should kill the stray server.

## Open Questions

_None — all questions resolved during discovery._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-57`.
