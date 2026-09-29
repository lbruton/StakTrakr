---
sketch: "STRK-167-numista-instance-dedup"
phase: requirements
created: 2026-06-07
---

# STRK-167 — Requirements

> **Source Issue:** [STRK-167](https://plane.lbruton.cc/lbruton/browse/STRK-167/)
>
> **Title:** Numista import: instance-aware de-duplication (proper fix) + restore safe merge
>
> **Summary (from issue).** Restore a **safe merge** for Numista CSV import with correct, instance-aware de-duplication. Phase-2 follow-up to the STRK-165 _interim_ gate (shipped v3.35.11), which currently makes the importer a one-time onboarding/**replace** action (no merge) because dedup was unreliable.
>
> **The identity problem.** A `numistaId` identifies a catalog _type_, not a physical _instance_. A user can own multiple distinct instances of the same `numistaId` + year (e.g. a raw 2024 ASE and a PCGS-MS70 2024 ASE) with different `grade`/`certNumber`. Numista exports each owned instance as its own CSV row (53 repeated N# observed in a real export). Keying on `numistaId` alone wrongly merges distinct graded instances and clobbers cert data.
>
> **Root cause (from STRK-165).** (1) `importNumistaCsv` pre-stamps `uuid = generateUUID()` on every row before the diff → `computeItemKey` returns that uuid first → the numista matching tier never runs. (2) Importer appends year to `name` ([inventory-import.js:761](js/inventory-import.js:761)) so API vs CSV names diverge. (3) The numista key was the volatile composite `numistaId|name|date`.
>
> **Evidence.** A 187-item inventory + 378-row precious CSV produced 554 rows pre-interim.

## Overview

Re-establish a **non-destructive merge** for Numista CSV import, replacing the STRK-165 interim "replace-only" gate. The fix re-points the **Item Identity Key**'s instance tier from the volatile `numistaId|name|date` to `numistaId|year|grade|certNumber` (normalized), stops the importer from pre-stamping fresh UUIDs _and serials_ that short-circuit matching, and restores the existing `showImportDiffReview` merge path. Two new diff-modal affordances give the user control during reconciliation: a per-row replace/sum quantity choice, and a soft "possible duplicate" flag when an incoming ungraded row collides with an already-graded instance. This matters now because the importer is currently a one-time onboarding tool — re-importing destroys grades, cert numbers, and images.

## Glossary Terms (this sketch)

- **Item Instance** — a physical copy of a catalog type; distinct when year, grade, or certNumber differ.
- **Numista ID** — a catalog _type_ identifier (spans years), not an instance.
- **Item Identity Key** — `computeItemKey()` tier ladder: `uuid → serial → numistaId|year|grade|certNumber → name|date`.

## User Stories

- **US-1:** As a collector with overlapping inventory, I want Numista CSV re-imports to **merge** instead of duplicate, so that re-importing never inflates my collection.
- **US-2:** As a collector who owns multiple identical copies, I want identical **ungraded** copies to collapse into one Item with summed quantity, so that my counts are accurate.
- **US-3:** As a collector who grades some coins, I want **graded** instances kept separate from ungraded ones, so that cert data is never clobbered.
- **US-4:** As a collector reconciling an import, I want to choose **per matched row** whether the CSV quantity replaces or adds to my existing quantity, so that I control how counts reconcile.
- **US-5:** As a collector re-importing after grading a coin, I want a **heads-up** when an incoming ungraded row might duplicate an item I've since graded, so that I don't unknowingly create duplicates.

## Acceptance Criteria (EARS)

> Each line is individually testable and becomes a TDD Cohort B assertion. `<system>` = the StakTrakr client.

### Identity key

- **AC-1** _(Ubiquitous)_ — The system **SHALL** derive the **Item Identity Key** instance tier as `numistaId|year|grade|certNumber`, where `year` is the issue year (`item.year`/issuedYear — **not** the acquisition date or the volatile name) and `grade`/`certNumber` are trimmed, lowercased, and empty/whitespace normalized to `""`. _(US-2, US-3)_
- **AC-2** _(Ubiquitous)_ — The system **SHALL** apply this identity rule identically in `computeItemKey` ([diff-engine.js:325](js/diff-engine.js:325)), its `changeLog.js` mirror ([changeLog.js:24](js/changeLog.js:24)), and `enrichItemIdentities` ([diff-engine.js:359](js/diff-engine.js:359)). _(US-1, US-3)_
- **AC-3** _(Event-driven)_ — **WHEN** keys are computed for an API-sourced Item and a Numista-CSV Item representing the same **ungraded** instance (same `numistaId`+`year`, differing `name`/acquisition-`date`), the system **SHALL** produce identical keys. _(US-1)_
- **AC-4** _(Event-driven)_ — **WHEN** two Items share a `numistaId` but differ in `year`, `grade`, or `certNumber`, the system **SHALL** produce different keys (so distinct issue years and distinct graded instances never collapse). _(US-2, US-3)_

### Import dedup & merge

- **AC-5** _(Unwanted)_ — **IF** a Numista CSV is imported, **THEN** the system **SHALL NOT** let a fresh `uuid` **or** a fresh `serial` on the incoming rows short-circuit matching before the diff/dedup (defer or strip both, or compute dedup keys from the bare instance tier), so `enrichItemIdentities` can backfill existing UUIDs and the `numistaId|year|grade|certNumber` tier participates in matching. _(US-1)_
- **AC-6** _(Event-driven)_ — **WHEN** a Numista CSV contains multiple rows with the same Item Identity Key (repeated N#, ungraded), the system **SHALL** collapse them into one incoming Item with `qty` summed across those rows. _(US-2)_
- **AC-7** _(Event-driven)_ — **WHEN** a Numista CSV is imported into a **non-empty** inventory, the system **SHALL** route through the import diff-review modal (`showImportDiffReview`) presenting add/modify/unchanged counts, not a destructive replace. _(US-1)_
- **AC-8** _(Unwanted)_ — **IF** the same Numista CSV is imported twice with no inventory changes between, **THEN** the system **SHALL** result in **zero** duplicate (`numistaId+year+grade+cert`) Items after apply. _(US-1)_
- **AC-9** _(Event-driven)_ — **WHEN** an import into an **empty** inventory occurs, the system **SHALL** present all rows as adds through the merge path (no special replace branch). _(US-1)_

### Reconciliation controls (UI)

- **AC-10** _(State-driven)_ — **WHILE** the diff-review modal shows a matched ungraded row whose CSV quantity differs from the existing Item, the system **SHALL** offer a per-row choice to **REPLACE** the existing quantity with the CSV quantity or to **SUM** them. _(US-4)_
- **AC-11** _(Event-driven)_ — **WHEN** an incoming ungraded row shares `numistaId`+year with an existing Item that has a populated `grade` or `certNumber`, the system **SHALL** flag that add row in the diff-review modal as a **possible duplicate** (advisory only — no automatic merge). _(US-5)_

### Replace-path retirement

- **AC-12** _(Ubiquitous)_ — The system **SHALL** remove the STRK-165 interim onboarding-replace dialog; merge-via-diff-review is the default and only user-facing Numista import path. _(US-1)_
- **AC-13** _(Optional)_ — **WHERE** a caller invokes `importNumistaCsv` with `override=true`, the system **SHALL** replace inventory directly without the diff-review modal (programmatic path preserved for existing callers/tests). _(US-1)_

## Non-Goals

- **Not** auto-merging graded↔ungraded instances — AC-11's flag is advisory; the system never silently combines a graded instance with an incoming ungraded row.
- **Not** adding a user-facing "replace entire inventory" button — `override` remains programmatic only (AC-13).
- **Not** changing how `grade`/`certNumber` are sourced for Numista CSV rows — Numista exports carry no grading, so CSV rows remain ungraded (`grade`/`cert` empty).
- **Not** redesigning the diff-review modal beyond the two new affordances (per-row qty choice, possible-duplicate flag).
- **Not** touching the goldback, spot, or retail pipelines — out of scope.
- **Not** a `git revert` of STRK-165 — the merge path is restored _with_ the corrected key; reverting blindly re-introduces the 554-row bug.

## Open Questions

_Non-blocking — these are design-phase decisions deferred to `/ui-mockup` + `/sketch-approach`; none changes an AC above._

- Visual treatment and **default state** of the per-row replace/sum control (AC-10) and the possible-duplicate flag (AC-11). Recommendation carried into discovery: per-row default = **replace** (idempotent re-import), sum opt-in. Final control/layout to be confirmed against a Playground mockup, since this adds two interactive elements to the diff modal (project convention: new multi-element UI → `/ui-mockup` first).

---

> **Phase complete?** Acceptance criteria are concrete, EARS-formatted, and individually testable. The single open question is a non-blocking design-phase item (UI default/visual treatment), not a requirements blocker. Then advance: `/sketch-review STRK-167 requirements [AGENT]` → `/sketch-reconcile STRK-167 requirements` → `/sketch-discovery STRK-167`.
