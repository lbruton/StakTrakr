---
name: spec-requirements
description: "Spec Phase 1 — grill the issue, then draft requirements.md in EARS. Standalone, ISSUE-first. Reads universal conventions + per-project overrides."
user-invocable: true
allowed-tools: >-
  Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Skill,
  mcp__plane__workitem
library-version: 04dbfc6b5d14
---

# /spec-requirements ISSUE

Phase 1 of the spec lifecycle: interrogate the issue with `/grill`, then write `requirements.md` in EARS syntax. One artifact, then STOP.

## Invocation

```
/spec-requirements <ISSUE-ID>
```

If `<ISSUE-ID>` is missing, print `Usage: /spec-requirements <ISSUE-ID>` and exit. Do not guess.

## Read first — shared conventions

Read **`.claude/skills/spec/references/conventions.md`** (universal mechanics: folder resolution, phase-boundary discipline, unreconciled-marks pre-check, the `approved:` rule) and the active project's **`.context/spec-conventions.md`** if present. Single source of truth; this skill does not restate them.

## Steps

1. **Resolve the spec folder** per conventions.md. If none exists, STOP: "no spec found for {ISSUE-ID} — run `/spec new {ISSUE-ID} \"<slug>\"` first." Confirm `requirements.md` is the (scaffolded, near-empty) target; if it already has substantial body, surface that and ask before overwriting.

2. **Grill the issue — proportional to how well-specified it already is.**
   - Inspect the issue body / "Source Issue" block for an existing **`## Discovery`** brief (from `/discover`).
   - **No discovery brief, or thin issue** → invoke the **`/grill {ISSUE-ID}`** skill and conduct the full interrogation. Do NOT reimplement interrogation inline — grill owns that domain (it reads `.context/GLOSSARY.md`, challenges terminology, cross-references the live codebase, walks decision dependencies, and emits a Grill Brief).
   - **Discovery brief already present** → grill is largely done; run a **light** pass only on items the brief left open. Don't re-interrogate resolved questions.
   - Carry grill's **Grill Brief** (Decisions / Terms / Open Questions) forward as the raw material for the requirements.

3. **Draft `requirements.md`** from the brief, per the template:
   - **User stories** (context — the *who/why*): `As a … I want … so that …`
   - **Acceptance criteria in EARS** (the testable normative statements — replaces loose Given/When/Then). Pick the right pattern per requirement:
     | Pattern | Template |
     |---------|----------|
     | Ubiquitous | The `<system>` **SHALL** `<response>` |
     | Event-driven | **WHEN** `<trigger>`, the `<system>` **SHALL** `<response>` |
     | State-driven | **WHILE** `<state>`, the `<system>` **SHALL** `<response>` |
     | Unwanted | **IF** `<condition>`, **THEN** the `<system>` **SHALL** `<response>` |
     | Optional | **WHERE** `<feature>`, the `<system>` **SHALL** `<response>` |
     Each EARS line must be individually testable — it becomes a TDD Cohort B assertion downstream.
   - Explicit **non-goals**.
   - Keep scope tight — specs carry no NFR matrix, stakeholder analysis, or risk register. If the work needs that depth, surface it and stop.

4. **Save `requirements.md`.** Touch no other file. (Grill may have updated `.context/GLOSSARY.md` — that's expected and good.)

## Output

One-paragraph summary, then:

```
next: /spec-review {ISSUE-ID} requirements [AGENT]   (peer review)
then: /spec-reconcile {ISSUE-ID} requirements        (apply findings)
then: /spec-discovery {ISSUE-ID}                      (phase 2)
```

## Do NOT

- Touch any file other than `requirements.md` (the glossary is grill's to edit, not yours).
- Grill about implementation details (library, pattern) — out of grill's scope by design; that belongs to approach/tasks.
- Speculate beyond the issue + brief, or add a risk register / test matrix.
- Advance to discovery — the human invokes the next phase (phase-boundary discipline).
- Stamp `approved:` — human-only, lives in `tasks.md`.
