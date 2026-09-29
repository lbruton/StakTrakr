---
sketch: "STRK-170-tier1-complexity-refactor"
phase: requirements
created: 2026-06-14
---

# STRK-170 — Requirements

> **Source Issue:** [STRK-170](https://plane.lbruton.cc/lbruton/browse/STRK-170/) — _Refactor high-complexity functions (Lizard ccn>25 / nloc>150) — Tier 1_
>
> Parent epic: STRK-168 (Codacy Lizard complexity backlog). Re-scoped 2026-06-14 against live Codacy Cloud: enforced thresholds are now **ccn>25 / nloc>150** (recalibrated 2026-06-10). Live census on `dev` is **82** Lizard findings (64 ccn>25 + 18 nloc>150); file-nloc and param-count are clean (0).
>
> **In scope = Tier 1 only:** the genuine single-function god-functions (named fn, ccn ≥ 35 OR nloc ≥ 150). The **canonical target set is enumerated by discovery (AC-10)** — the count below (~29) and the named targets are indicative, not the authoritative boundary. Top targets ⭐ `inventory.js editItem` (ccn 133/204nloc), `inventory-import.js complete` (ccn 132/322nloc), `vault.js handleVaultAction` (ccn 84/285nloc), `catalog-api.js searchItems` (907nloc).
>
> **Out of scope (documented in issue):** Tier 2 closure-rollup artifacts (`Method (anonymous)` — Lizard folds event-wiring into one synthetic fn; verify shape, do not blindly refactor), Tier 3 known measurement false-positives (`diff-modal.js _esc` 1399nloc & `dialogs.js escapeDialogText` 246nloc — regex-desync artifacts, recommend FalsePositive ignore), Tier 4 borderline ccn 26–34 (low value, defer).
>
> **Hard constraint:** no behavior change, tests green, and splits must **dedup complexity in-PR** — relocating a ccn>25 fn into a new file re-flags as a NEW Codacy issue (STRK-169 lesson).

## Overview

Drive the StakTrakr Codacy/Lizard function-level complexity backlog as close to zero as practical. The **Tier 1 god-functions** (named functions exceeding ccn 25 or nloc 150 on `dev` — the canonical set is published by discovery per AC-10; ~29 indicative) are refactored below threshold — sliced **one file per PR** so all god-functions in a file are addressed together (the dedup-in-PR rule from STRK-169). The irreducible residual (Lizard measurement artifacts + accepted borderline functions) is then flagged as ignored in Codacy Cloud, so the **visible** dashboard count approaches zero and any future complexity regression stands out. This is internal code-health work with **no user-facing change**; it ships as a STRK-169-style no-bump campaign closed by a single `/release patch`.

## User Stories

- **US-1:** As a maintainer, I want the Tier-1 god-functions refactored below the Lizard ccn-25 / nloc-150 thresholds, so that the Codacy complexity number reflects genuine remaining debt and new regressions are easy to spot.
- **US-2:** As a maintainer, I want every refactor to provably preserve behavior, so that internal cleanup never ships a user-visible regression.
- **US-3:** As a maintainer, I want the irreducible residual (measurement artifacts + accepted borderline) flagged as ignored in Codacy Cloud with honest reasons, so that the visible count approaches zero and stays meaningful.

## Acceptance Criteria (EARS)

> Each line is individually testable and becomes a downstream TDD assertion or a verification step.

### AC-1 — per-file threshold, reproducibly verified (maps to US-1)

**WHEN** a Tier-1 target file's refactor PR is opened, the targeted functions in that file **SHALL** each report Lizard `ccn ≤ 25` **AND** `nloc ≤ 150`.

Local verification is reproducible via an explicit precondition (the local Codacy config is intentionally untracked/gitignored as of PR #1264, so it must be regenerated from cloud first):

```
codacy-analysis init --remote gh lbruton StakTrakr   # pulls live ccn-25 / nloc-150 thresholds into the local-only config
codacy-analysis analyze --tool Lizard --files <target-file>
```

The cloud `Codacy Static Code Analysis` check on the PR is the **authoritative** confirmation; the local command is the pre-flight.

### AC-2 — no relocated complexity / dedup-in-PR (maps to US-1)

**IF** a refactor would introduce a _new_ Codacy complexity finding (complexity moved into an extracted helper or a sibling, not reduced), **THEN** that new finding **SHALL** be resolved within the same PR — the PR is not done while the cloud `Codacy Static Code Analysis` check reports a net-new complexity issue.

### AC-3 — regression gate (maps to US-2)

The full `npm test` core Playwright suite **SHALL** pass both before and after each refactor PR.

### AC-4 — targeted characterization tests, classified in discovery (maps to US-2)

Discovery **SHALL** record, for every Tier-1 target, its existing-coverage status and a risk rating, and **SHALL** publish the explicit list of targets that require a characterization test (criteria: a target with no meaningful existing test coverage AND data-shape-heavy or state-mutating logic — e.g. import/restore/merge paths). **WHERE** a target appears on that published list, the refactor PR **SHALL** add the characterization test before the refactor. Implementation may **not** self-exempt a function by declining to classify it — the classification is a discovery deliverable, not an implementer judgment.

### AC-5 — behavior preservation (maps to US-2)

Each refactor PR **SHALL** preserve observable behavior — no change to rendered DOM output, localStorage/IndexedDB storage shape, or user-visible flow for the refactored function.

### AC-6 — per-file cohort slicing (maps to US-1)

**WHERE** the campaign is sliced into PRs, each PR **SHALL** address **all** Tier-1 god-functions in one file (one file = one cohort = one PR), so helper extraction cannot silently shift complexity onto an un-addressed sibling.

### AC-7 — no-bump campaign (maps to US-1)

**WHILE** the campaign is in progress, the intermediate file-refactor PRs **SHALL** ship to `dev` unbumped; **WHEN** all Tier-1 file PRs have merged, the campaign **SHALL** ship a single `/release patch`, preceded by one `/update-spot-bundle`.

### AC-8 — residual triage, per-alert and verified (maps to US-3)

**WHEN** all refactor PRs have merged, the residual Tier-2/3/4 Lizard findings **SHALL** be triaged in Codacy Cloud **per-alert by issue id** (not a broad filtered bulk ignore), using the installed `codacy` executable:

```
codacy issue gh lbruton StakTrakr <issueId> --ignore --ignore-reason FalsePositive|AcceptedUse --ignore-comment "<justification>"
```

Reasons: confirmed closure-rollup artifacts and regex-desync false-positives → `FalsePositive`; accepted borderline (ccn 26–34) → `AcceptedUse`. Each ignore **SHALL** carry an `--ignore-comment` justification. After the triage pass, a `codacy issues gh lbruton StakTrakr --branch dev --tools Lizard --overview` **SHALL** confirm the residual count, so no genuine complexity is hidden by an over-broad ignore.

**Deferred-file carveout (added 2026-06-14 after discovery):** findings in files explicitly deferred to a follow-up issue are **excluded** from this campaign's closing accounting — they are neither refactored nor ignored here, but tracked by the owning issue. Specifically, `js/settings-listeners.js` (findings `:656` ccn30 and `:913` ccn296/nloc942) is owned by **STRK-195**. The campaign's closing state is therefore "**~0 visible Lizard findings _except_ those owned by deferred follow-up issues**," not literal zero.

### AC-9 — promote genuine complexity (maps to US-1)

**IF** discovery finds a Tier-2 `Method (anonymous)` block is a _genuine_ single high-branch function rather than a Lizard closure-rollup of event-wiring, **THEN** it **SHALL** be promoted into Tier-1 refactor scope rather than ignored.

### AC-10 — canonical Tier-1 inventory is a discovery deliverable (maps to US-1)

Discovery **SHALL** publish the **canonical Tier-1 target inventory** before any PR slicing is planned: one row per target with Codacy issue/result id, file path, function label, line, ccn, nloc, and tier decision. That published inventory — not the indicative "~29 / top targets" prose in the Source Issue block — is the authoritative set that AC-1, AC-6, and AC-7 mean by "all Tier-1". PR slicing (AC-6) **SHALL NOT** begin until the inventory is published.

## Non-Goals

- **Not** refactoring Tier-2 closure-rollup artifacts that discovery confirms are event-wiring blocks — these are handled by a Codacy `FalsePositive` ignore (AC-8), not a code change. (Genuine functions among them are promoted per AC-9.)
- **Not** refactoring Tier-4 borderline functions (ccn 26–34) — accepted as-is and ignored `AcceptedUse`.
- **Not** "fixing" the Tier-3 regex-desync false-positives (`_esc`, `escapeDialogText`) in code — they are Lizard measurement artifacts, flagged `FalsePositive`.
- **Not** driving the Lizard count to literal zero by refactoring — the residual reaches ~0 _visible_ via justified Codacy ignores, not code.
- **Not** per-PR version bumps — a single closing `/release patch` ships the campaign.
- **Not** touching the file-nloc or parameter-count axes — both already report 0 findings (file-nloc closed by STRK-169).
- **Not** a file-splitting campaign — that was STRK-169. File-splitting may still be a valid _technique_ to reduce a single function's complexity, but reducing file size is not a goal here.

## Open Questions

_None — all resolved during grilling._

---

## Review Archive — requirements (2026-06-14)

### Resolution Summary

4 Codex marks, all **ACCEPT** (0 rejected, 0 deferred to user). Both factual claims (config untracked; executable is `codacy` not `codacy-cloud-cli`) verified true against the repo. Net edits: AC-1 rewritten with a reproducible command + config precondition; AC-4 rewritten to make coverage/risk classification a discovery deliverable; AC-8 rewritten to per-alert `codacy issue … --ignore` with a post-ignore overview; AC-10 added (canonical Tier-1 inventory as a discovery deliverable); "~29" softened to indicative in the Source Issue block + Overview.

### Original Codex marks (verbatim)

- **On the Source Issue block / Tier-1 boundary →** resolved by AC-10:

  > CODEX: The Tier-1 boundary is not yet testable. The Cloud overview confirms 82 Lizard findings on `dev`, and the named examples exist, but "~29" plus "top targets" does not define the exact issue set that AC-1/AC-6/AC-7 call "all Tier-1". Discovery should be required to publish the canonical target inventory with Codacy issue/result ids, file path, function label, line, metric values, and tier decision before any PR slicing is planned.

- **On AC-1 →** resolved by the AC-1 rewrite:

  > CODEX: The local verifier is underspecified. `codacy-analysis analyze --help` defaults to `.codacy/codacy.config.json`, but this checkout does not have that config tracked; only `.codacy.yml` and `.codacy/generated/Lizard/lizard-filelist.txt` are present. AC-1 needs an exact, reproducible command/config precondition, for example the generated config step plus `--tool Lizard --files <target>`, or downstream PRs can disagree about what "verified by codacy-analysis" means.

- **On AC-4 →** resolved by the AC-4 rewrite:

  > CODEX: This is easy to satisfy by omission: "thin on existing coverage" and "high-risk" are not defined. Require discovery to record coverage/risk status for each Tier-1 target and list which targets need characterization tests, otherwise implementation can skip tests by never classifying a risky function.

- **On AC-8 →** resolved by the AC-8 rewrite:
  > CODEX: The ignore workflow needs a safer, concrete command shape. The installed Cloud CLI is invoked as `codacy`, and help shows per-issue ignores as `codacy issue gh lbruton StakTrakr <issueId> --ignore --ignore-reason FalsePositive|AcceptedUse --ignore-comment ...`; `codacy-cloud-cli` is not an executable here. AC-8 should require per-alert ids/comments and a post-ignore Cloud overview so a broad filtered ignore cannot hide genuine complexity or leave the visible count unverified.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-170`.
