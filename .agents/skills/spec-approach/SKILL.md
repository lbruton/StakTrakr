---
name: spec-approach
description: "Spec Phase 3 — architecture, key decisions, file map (+ UI Contract) into approach.md. Standalone, ISSUE-first. Reads universal + per-project conventions."
user-invocable: true
library-version: 6f84ff770f80
---

# /spec-approach ISSUE

Phase 3: decide *how* we'll build it, into `approach.md`. One artifact, then STOP.

## Invocation

```
/spec-approach <ISSUE-ID>
```

Missing `<ISSUE-ID>` → print `Usage: /spec-approach <ISSUE-ID>` and exit.

## Read first — shared conventions

Read **`.agents/skills/spec/references/conventions.md`** and the project's **`.context/spec-conventions.md`** if present.

## Steps

1. **Resolve the spec folder**; read `requirements.md` + `discovery.md` (both inputs).
2. **Unreconciled-marks PRE-CHECK** (per conventions.md) on **both** prior files. If any unreconciled marks exist, STOP: "{file} has not been reconciled — run `/spec-reconcile {ISSUE-ID} {phase}` first."
3. **Draft `approach.md`** per the template:
   - High-level architecture (1–3 paragraphs).
   - Key technical decisions — each with a one-line rationale + the tradeoff it accepts (a decision with no loser is not a real decision).
   - **File/module map** — files to be Created / Modified / Deleted. This map is the contract the `tasks` phase cross-checks against.
   - **UI Contract** (MANDATORY if `requirements.md` or `discovery.md` references *any* mockup, playground file, screenshot, or prototype): mockup artifact paths, named states/screens, component/token requirements, interaction contract. If purely backend/data/config, write `N/A — no UI surface.`
   - Out-of-scope items pushed to follow-up issues.
4. **Save `approach.md`.** Touch no other file.

## Output

One-paragraph summary, then:

```
next: /spec-review {ISSUE-ID} approach [AGENT]
then: /spec-reconcile {ISSUE-ID} approach
then: /spec-tasks {ISSUE-ID}
```

## Do NOT

- Write code, draft tests, or decide implementation order — that's the `tasks` phase.
- Add files the discovery findings don't justify, or contradict `requirements.md` silently (surface conflicts and stop).
- Touch any file other than `approach.md`. Advance phases. Stamp `approved:`.
