---
name: spec-discovery
description: "Spec Phase 2 — research the codebase + prior art into discovery.md. Standalone, ISSUE-first. Uses a read-only Workflow fan-out for the research sweep."
user-invocable: true
library-version: 5834a2dcd445
---

# /spec-discovery ISSUE

Phase 2: research what already exists and what's unknown, into `discovery.md`. One artifact, then STOP.

## Invocation

```
/spec-discovery <ISSUE-ID>
```

Missing `<ISSUE-ID>` → print `Usage: /spec-discovery <ISSUE-ID>` and exit.

## Read first — shared conventions

Read **`.agents/skills/spec/references/conventions.md`** and the project's **`.context/spec-conventions.md`** if present. They define folder resolution, phase-boundary discipline, and the unreconciled-marks pre-check used below.

## Steps

1. **Resolve the spec folder** per conventions.md. Read `requirements.md` first — it's the input.
2. **Unreconciled-marks PRE-CHECK** (per conventions.md): scan `requirements.md` for reviewer marks outside `## Review Archive`. If any exist, STOP: "requirements has not been reconciled — run `/spec-reconcile {ISSUE-ID} requirements` first." Do not research on top of un-reconciled review.
3. **Research sweep — four read-only angles.**
   Default to inline research. If the user explicitly asks for parallel agents, use read-only `explorer` subagents for independent angles. Subagents never edit files.
   - **Structural** — Grep/Glob for affected modules, callers, dependencies. Grep each candidate identifier repo-wide and read the hits; that is the exhaustive path to a call list.
   - **Semantic** — claude-context `search_code` for the feature domain, reusable patterns, integration points.
   - **Prior decisions** — mem0 (and sessionflow if useful) for past choices on this area. Record exact query strings.
   - **External** — context7 / Brave for libraries, RFCs, platform docs — only if the work involves them.

   Synthesize the returned findings yourself; do not let an agent write `discovery.md`. For a narrow spec where one or two angles obviously suffice, skip the Workflow and run those searches inline — match the fan-out to the surface area.
4. **Draft `discovery.md`** per the template:
   - Existing code/files relevant to the work (with `path:line`).
   - Prior decisions (mem0/sessionflow) — cite the query strings used.
   - External references (libraries, RFCs, docs) with links.
   - **Open questions** that block `approach.md`.
5. **Save `discovery.md`.** Touch no other file.

## Output

One-paragraph summary (or, if open questions block progress, list them and stop), then:

```
next: /spec-review {ISSUE-ID} discovery [AGENT]
then: /spec-reconcile {ISSUE-ID} discovery
then: /spec-approach {ISSUE-ID}
```

## Do NOT

- Propose solutions — that's the `approach` phase.
- Let a subagent write `discovery.md` — agents return findings; you synthesize.
- Touch any file other than `discovery.md`.
- Advance to approach (phase-boundary discipline). Stamp `approved:` (human-only).
