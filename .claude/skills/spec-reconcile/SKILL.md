---
name: spec-reconcile
description: "Spec process step — classify /spec-review marks for one phase, apply them with human approval, archive the originals. ISSUE PHASE first."
user-invocable: true
allowed-tools: >-
  Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion,
  mcp__claude-context__search_code
library-version: c1f149d0652e
---

# /spec-reconcile ISSUE PHASE

Bridge between `/spec-review` markup and a clean phase file the next phase can build on. Reads reviewer marks, classifies them, applies the accepted ones with explicit human approval, and archives the originals verbatim.

## Invocation

```
/spec-reconcile <ISSUE-ID> <phase>
```

`<phase>` is **required**: `requirements | discovery | approach | tasks`. Missing either arg → print usage and exit.

## Read first — shared conventions

Read **`.claude/skills/spec/references/conventions.md`** for folder resolution and the reviewer-mark grammar (the `> AGENT:` / `## {AGENT} Review` / `## {AGENT} — Unverified Assumptions` patterns and the `## Review Archive` exclusion).

## Steps

1. **Resolve the spec folder**; open `{phase}.md`. Collect every **unreconciled** artifact (per the grammar in conventions.md): inline `> {AGENT}:` blocks, `## {AGENT} Review` sections, `## {AGENT} — Unverified Assumptions` subsections. Anything under `## Review Archive` is already done — ignore. If none found: "no reviewer comments found in {phase}.md — nothing to reconcile" and exit. Do not invent work.

2. **Classify** each distinct finding by **cluster** — Consensus (2+ agents, match by intent not string) / Single-source / Divergent (agents disagree) — and **disposition**:
   - **Accept** — correct + mechanical fix. Apply without asking.
   - **Reject** — out of scope / already handled / factually wrong. **Verify code-existence claims against the live repo before rejecting** (reviewers are fallible; an unchecked reject inherits their assumption). One-sentence reason required.
   - **Needs-your-call** — judgment, divergent cases, scope/tradeoff decisions.

3. **Inline Q&A — do NOT batch.** Hit a *needs-your-call* item → ask the moment you reach it (AskUserQuestion for clean choices, plain text otherwise), integrate the answer, continue. Batching turns each question into a re-orientation tax.

4. **Print the reconcile plan** — ACCEPT (n) / REJECT (n, with reasons) / YOUR-CALL resolved (n) / NET CHANGES to `{phase}.md` / ARCHIVE note. Then **wait for an explicit approval signal** ("approve", "go", "do it"). Generic "looks good" or silence is not approval. Adjust + re-print if asked.

5. **Edit pass (post-approval):**
   - Apply each Accept + Your-call resolution to the relevant section. Mechanical edits in place; structural edits preserve numbering (renumber dependents).
   - Strip every inline `> {AGENT}:` mark from the body.
   - Move all `## {AGENT} Review` / `## {AGENT} — Unverified Assumptions` sections into a single `## Review Archive — {phase} ({date})` block, **verbatim** (the audit trail is the point), with a `### Resolution Summary` (accepted/rejected/your-input counts).
   - Save `{phase}.md`.

## Output

```
Reconciled {phase}.md. {n} accepted, {n} rejected, {n} resolved with your input.
Next: /spec-<next-phase> {ISSUE-ID}
  requirements → discovery → approach → tasks → (stamp approved:, then /spec run|workflow|dispatch)
```

## Do NOT

- Edit any file other than `{phase}.md`.
- Stamp `approved:` (separate human action on `tasks.md`).
- Auto-invoke the next phase (print the hint; the human runs it).
- Rewrite reviewer text in the archive — verbatim by design.
- Reject a code-existence claim without grepping the repo first.
