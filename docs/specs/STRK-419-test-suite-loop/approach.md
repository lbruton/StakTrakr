---
spec: "STRK-419-test-suite-loop"
phase: approach
created: 2026-10-22
---

# STRK-419 — Approach

## High-Level Architecture

One coverage pipeline feeds three consumers. A shared Playwright base fixture collects V8 JS
coverage per test when `COVERAGE=1` and writes one raw record per test. A merge script turns
the raw records into three outputs: an lcov report for Codacy (AC-1), a test map that lists the
`js/` functions each test executed (AC-2), and the input to the redundancy report (AC-21). The
unit suite produces its own lcov through a harness change that makes Node attribute evaluated
source to its file (AC-4).

CI runs that pipeline on every PR to `dev` and every push to `dev`. A new `Tests` workflow
shards the core suite across runners, merges the Playwright blob reports and the raw coverage
in a final job, uploads lcov to Codacy, and publishes the test map as an artifact. The final
job is the single required check. `test:changed` reads the test map (built locally or
downloaded from the latest `dev` run), diffs the working tree against the commit the map was
built from, and runs only the selected Playwright tests and unit files.

Consolidation then works domain by domain with two measuring tools in place: the redundancy
report proposes candidates, and the Codacy gate proves each PR keeps coverage. The archive,
`coverage-map.csv` and their rules are removed, and the global tasks template changes so new
specs extend existing tests instead of adding one per acceptance criterion.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
| --- | --- | --- | --- |
| D-1 | Split the shared fixture: `helpers/app-test.js` (boot wait from PR 1621, coverage hook) is the base; `mocks/extended-test.js` extends it with network mocks. | The three raw `@playwright/test` specs need the boot wait and coverage but must keep their own network handling. | One more fixture layer; every spec imports one of two files. |
| D-2 | Collect coverage with `page.coverage.startJSCoverage({ resetOnNavigation: false })` in the base fixture, keep only `js/` URLs and ranges with `count > 0`, and write one JSON file per test under `coverage/raw/`. | Per-test records are what AC-2 and AC-21 need; filtering keeps files small. | Chromium only (already the only project). A navigation drops the earlier document's scripts from the next read even with `resetOnNavigation: false`, so the fixture takes coverage before every `page.goto` and `page.reload` (amended 2026-10-23). A navigation the app starts itself (`location.reload()`) can still lose what ran before it. |
| D-3 | Use `monocart-coverage-reports` (dev dependency) to merge raw V8 data and write lcov. | It handles V8-to-lcov, cross-process merge and file filters, and documents a Codacy setup. | Adds a dev dependency; the app itself loads nothing new. |
| D-4 | The test map stores, per test, its location (`file:line`) and the executed functions as `{file, name, startLine, endLine}`, plus the commit SHA it was built from. Block ranges go to a separate file for the redundancy report. | Selection needs functions and a stable test location; redundancy needs finer blocks. | Two outputs to keep in step; both come from the same raw records. |
| D-5 | The test map is not committed. CI publishes it as an artifact on every `dev` push; `npm run test:map` builds it locally into `.cache/test-map.json`; `test:changed --fetch` downloads the latest `dev` artifact with `gh run download`. | A committed map conflicts on every PR and goes stale between merges. | First local use needs a full coverage run or a `gh` download. |
| D-6 | `test:changed` diffs against the map's own commit (`git diff <mapSha>` plus untracked files), not against the merge base. | Line numbers in the diff then match the map; changes others merged since the map only add tests, never hide them. | When the map is old, the selection grows. AC-18 warns when `mapSha` is not an ancestor of the merge base. |
| D-7 | A changed line inside a mapped function selects every test that executed it. A changed line outside every function (top-level code) runs the full core suite and names the file. | Top-level code runs during every boot, so every test "covers" it; a full run is the honest answer. | Edits to top-level constants run the full suite. |
| D-8 | Playwright tests run by location (`npx playwright test file:line ...`). A changed spec file runs whole (AC-14). | Locations are exact and need no title escaping. | A location from the map is wrong once its spec changes, which AC-14 already covers by running the whole file. |
| D-9 | Unit selection scans each unit file for the `js/<name>.js` paths it reads, plus any changed unit file (AC-15). | Unit files read source by path; a text scan finds every dependency. | A unit file that builds a path dynamically is missed; none does today. |
| D-10 | Unit coverage: the harness in `tests/unit/helpers/source-extract.js` and `load-sw-router.js` evaluates source with `vm.Script` and `filename` (plus `lineOffset` for slices) instead of `new Function`. Node's `--experimental-test-coverage --test-reporter=lcov` then credits the `js/` file. | A spike showed whole-file evaluation credited to `js/lib.js`; Node's lcov credits none of the 97 files today. | Slice attribution did not record its branch in the spike; the first task proves it or falls back to whole-file attribution only. |
| D-11 | New workflow `.github/workflows/tests.yml`: jobs `unit`, `core` (matrix of 4 shards, `COVERAGE=1`, blob reporter, raw coverage artifact) and `report` (merge reports and coverage, Codacy upload, map artifact). `report` needs the others and is the required check, named `Tests`. | One aggregate check is simpler to require than a matrix; sharding keeps wall time within AC-11. | Four runners per run; free for a public repo. Shard count may change after the first CI timing. |
| D-12 | The Codacy upload step runs only when `CODACY_PROJECT_TOKEN` is set; otherwise it writes a notice to the job summary. Fork PRs take the same path. | AC-10, and secrets are not exposed to fork PRs. | A PR from a fork gets no coverage gate. |
| D-13 | CI keeps `retries: 1` and the `report` job lists flaky tests in the job summary. | A retry stops a rare flake from blocking a merge. | A flaky test can pass the gate; the summary keeps it visible. |
| D-14 | Consolidation moves pure-logic checks to unit tests (through the D-10 harness) when the function needs no app state, and to one table-driven `page.evaluate` test per domain when it needs app globals. Issue-prefixed specs merge into their domain spec. | One boot per table instead of one per case is where the time goes. | Fewer, larger tests; each table row carries a message naming its case. Measured 2026-10-23 on Collections: a fresh test's seed and boot costs 0.55 to 1.1 s under 4 workers, a reset and reload in one page 0.36 s, so a merged case saves about 0.4 s. Table-driving pays only for logic-only groups that share a seed; UI tests spend their time in interactions and stay separate. |
| D-15 | `test:offline` is removed. | No spec carries `@network`, so it equals a full run across all tiers. | One fewer command in the docs. |
| D-16 | The template change edits the master in `Devops/skill-library`, deploys with `skills-deploy`, and lands the StakTrakr copies in a chore PR. | The decision was global (2026-10-22). | Every project's next spec follows the new rule. |
| D-17 | Ruleset, Codacy gate and secret changes are user steps, listed in the PR that adds the workflow. | They live outside the repo and need the owner's permissions. | The gate is not live until the user makes them. |
| D-18 | (Amended 2026-10-23, supersedes D-11 for PRs.) The PR check runs the `test:changed` plan: a `select` job downloads the latest `dev` test map, writes the plan as JSON, and the unit and core jobs run only the selection; core shards scale with its size, and an empty selection starts no browser. Pushes to `dev` run the full sharded suite with coverage, publish the map and upload to Codacy. `test:changed` treats docs and config paths as test-free and any other path it cannot map as a full-suite trigger. | A PR must not wait on the full suite; the full run after merge catches what a selection misses and keeps the map fresh. | A regression outside the selection surfaces after merge, on the `dev` run, not on the PR. No PR coverage gate (AC-9 retired). |
| D-19 | (Amended 2026-10-23, user-approved, refines D-7.) The test map gains a line index built from the same segments as the block file: per `js/` file, runs of lines with the set of tests whose covered segments overlap each line (`lines`), with the sets stored once (`sets`). A changed line inside a function selects the tests in its line's set. An inserted line belongs to the innermost function that holds both of its neighbours and uses the line after it, plus the line before when the line after is blank or starts with `}`; an insertion just before a function's first line or after its last belongs to the scope around it. Top-level lines and insertions keep the D-7 full-suite rule; a map without `lines` falls back to function selection. | Function selection picks every test that entered a function, even through an early return: a line after the guard in `refreshDetailsModalIfOpen` is run by 12 map entries, the function by 380. Selection by line is what AC-20 needs. | A larger map. A line change that only alters which branch runs can affect a test that never ran the line before; the `dev` push run still runs the full suite. |
| D-20 | (Amended 2026-10-23, user-approved.) The `page` fixture in `tests/playwright/helpers/mocks/extended-test.js` serves the app's static scripts and stylesheets (`js/`, `css/`, `vendor/`, `data/` `.js` and `.css`) from worker memory through `page.route`. Each worker reads a file from disk once. Routes a spec registers later still win (LIFO). `index.html`, images and the network mocks keep their current paths. | Startup dominates test time. Profiled 2026-10-23 at 5 workers (medians of 40 boots): a test takes about 1.0 s, of which the 107 deferred scripts take about 400 ms against 96 ms at 1 worker, because the workers queue on the single `python3 -m http.server`. Served from memory, scripts finish at 339 ms instead of 474 ms and a test takes 884 ms instead of 1,012 ms. | Tests no longer exercise the static file server. Service-worker and offline tests in `extended/` keep the server path. A file edited during a run is not re-read until the worker restarts. |
| D-21 | (Amended 2026-10-23, user-approved.) The fixed 200 ms delay before the Phase 14 listener setup in `js/init.js` goes to 0 in its own patch release (STRK-466), outside this spec's PRs. | The delay is idle time on every page load and every test: in the same profile, ready moves from 768 ms to 627 ms with the delay at 0. | A runtime change. A test that raced boot and passed only because of the delay fails and needs a real wait. |
| D-22 | (Amended 2026-10-23, user-approved.) AC-23 is 4 minutes, not 3. Consolidation runs after D-20 and D-21 land, by measured cost. | Full core with both D-20 and D-21 simulated ran in 239 s at 5 workers and 253 s at 4 (toast fix included); without them, 263 to 278 s. Each merged test saves about 0.4 s (D-14), so 3 minutes would need about 375 fewer boots or a shared page per worker. | A slower target. A shared-page design is out of scope. |

## File Map

### New

- `tests/playwright/helpers/app-test.js` — base fixture: boot wait and the coverage hook.
- `tests/playwright/helpers/coverage.js` — start, stop, filter and write per-test raw coverage.
- `devops/testing/coverage-merge.mjs` — merge raw records into lcov, the test map and the block file.
- `devops/testing/test-changed.mjs` — diff, select, print the plan, run Playwright and unit tests.
- `devops/testing/test-redundancy.mjs` — unique coverage and subset report, JSON and Markdown.
- `.github/workflows/tests.yml` — unit, sharded core with coverage, report and Codacy upload.
- `tests/unit/coverage-merge.test.js` — `coverage.js` helpers and `coverage-merge.mjs` outputs, inline fixtures.
- `tests/unit/source-extract-coverage.test.js` — Node lcov credits `js/` files loaded through the harness.
- `tests/unit/test-changed.test.js` — selection, fallback, staleness and plan output of `test-changed.mjs`.
- `tests/unit/test-redundancy.test.js` — unique coverage, subsets and report text of `test-redundancy.mjs`.

### Modified

- `tests/playwright/helpers/mocks/extended-test.js` — extend `app-test.js`; boot-wait code moves there; serve static scripts and stylesheets from worker memory (D-20).
- `tests/playwright/core/collections.spec.js`, `tests/playwright/core/inventory-crud.spec.js`, `tests/playwright/extended/service-worker.spec.js` — import from `app-test.js`.
- `playwright.config.js` — blob reporter on CI; merge step hook when `COVERAGE=1`.
- `package.json` — scripts `test:map`, `test:changed`, `test:coverage`, `test:redundancy`; remove `test:legacy`, `test:offline`; add `monocart-coverage-reports`.
- `package-lock.json` — the new dev dependency.
- `.gitignore` — `coverage/`, `.cache/`.
- `tests/unit/helpers/source-extract.js`, `tests/unit/helpers/load-sw-router.js` — `vm.Script` with `filename`.
- `tests/playwright/core/*.spec.js` — consolidation, domain by domain; the eight issue-prefixed specs merge into domain specs.
- `tests/unit/*.test.js` — new unit tests that receive logic-only checks.
- `tests/playwright/core/retail-market.spec.js` — drop the coverage-map comment (and consolidation).
- `.context/testing.md` — tiers, "extend before add", `test:changed`, the coverage gate; remove the coverage-map and archive rules.
- `.context/review-and-ci.md` — the `Tests` required check and the Codacy coverage gate.
- `.context/coding-standards.md`, `.context/deep-dives/playwright-suite-rationalization.md` — remove archive and coverage-map references.
- `AGENTS.md`, `CLAUDE.md` — command lists and coverage-map rule; correct the `dev` required-check claim.
- `.github/skills/code-review/SKILL.md` — replace the coverage-map rule with the coverage gate.
- `.codacy/codacy.config.json` — regenerate after the archive goes.
- `Devops/skill-library/skills/spec/references/templates/tasks-template.md` (master, Devops repo) — "extend before add" in B.1, a fold-in closing task.
- `.claude/skills/spec/references/templates/tasks-template.md`, `.agents/skills/spec/references/templates/tasks-template.md` — deployed copies.

### Deleted

- `tests/playwright/archive/` — 58 archived specs.
- `tests/playwright/coverage-map.csv` — replaced by the generated test map.
- `tests/playwright/consolidation-audit.md` — closeout record of the archive; git keeps it.

## Data / Schema Changes

None. No app data, storage key or persisted format changes. The test map and the block file
are build outputs, not committed. The map gains `lines` and `sets` (D-19); a consumer that
finds no `lines` uses the function data.

## Tradeoffs Surfaced for Review

- D-7 runs the full suite for top-level edits. If that proves common, a later change can map
  top-level statements to the tests that read the names they define.
- D-13 keeps one retry in CI. If flaky counts stay above zero, set retries to 0 and fix the
  flakes instead.
- D-10 depends on slice attribution; if the first task cannot make it work, AC-4 covers
  whole-file evaluation only and `requirements.md` needs an amendment before tasks proceed.

## UI Contract

N/A — no UI surface.

## Out of Scope (follow-up issues)

- STRK-461: reduced-motion CSS makes computed-style reads stale (filed 2026-10-22).
- App boot cost (request count, lazy loading of `jspdf`, `forge`, chart libraries): a runtime
  issue to file if boot time becomes the next limit.
- A `/test-sweep` skill and ledger (requirements Non-Goals).

## Risk Notes

- Risk: coverage collection slows each test enough to break AC-11 in CI → mitigation: measure
  in the first coverage task; raise the shard count before reducing collection.
- Risk: the CI runner is slower than the reference machine and shows new timing races →
  mitigation: run the sharded job on the PR that adds it and fix races at the cause, as in
  STRK-460.
- Risk: consolidation removes an assertion that coverage does not measure (same lines, other
  expectation) → mitigation: each consolidation PR lists the old tests and the assertion that
  replaces each one.
- Risk: the template change reaches other projects mid-spec → mitigation: the new closing
  task applies only to specs whose `tasks.md` is written after the deploy.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete.
> Then advance: `/spec-tasks STRK-419`.
