# STRK-389 — Implementation and verification

Version: 3.36.37. Draft PR: [#1553](https://github.com/lbruton/StakTrakr/pull/1553)

[Cloudflare preview](https://patch-3-36-37.stacktrackr.pages.dev)

Approved layout A is implemented with adjacent native up/down buttons, a separate
Add Slot after action, and 44px mobile targets. The editor retains row nodes and
image chooser state during moves. Existing Slot ids are reserved before new ids
are minted. Definition order drives Album and Ledger; Reverse remains view-only.

## Verification — 2026-10-04

- Full core Playwright gate: 808/808 passed (5.3 minutes, four workers).
- Full unit suite: 1,028/1,028 passed.
- Collections browser suite: 90/90 passed; final focused check: 2/2 passed.
- ESLint and all signing, secret, release-sync, formatting and Markdown hooks passed.
- Local CodeRabbit: zero findings. Codacy Cloud: passed, zero new issues.
- Local Codacy ESLint, Lizard and Semgrep completed with zero issues; Stylelint
  crashed in its Node runtime, including a retry. Cloud analysis remains the
  authoritative remote gate. Agentlinter scored 85/100 with instruction advisories.
- Spot Bundle refreshed through 2026-10-03 with 20 additional day×metal values.

Browser tests cover insertion, duplicate labels, stable primary Items and Spares,
pending image association, saved and reversed Album/Ledger order, reload/reopen,
new/cloned Collections, keyboard focus, disabled boundaries, Cancel and close,
375px geometry, and all four themes. The duplicate-label unit regression failed
against the original implementation and passed after the fix, including normalized
JSON and merge round-trips.

## Screenshots

- `editor-desktop.jpg`: actual editor at desktop width.
- `editor-mobile.jpg`: interleaved Antiqued Slot at 375px.
- `editor-dark.png`, `editor-light.png`, `editor-slate.png`, `editor-sepia.png`:
  mobile editor from the automated four-theme workflow.
- `cloudflare-preview.jpg`: deployed v3.36.37 editor, insertion verified in-browser.

Project instruction paths and both tracked patch-start skill copies are corrected.
Remaining authored shared-skill follow-ups are recorded in
`docs/research/STRK-389-slot-controls.md`.
