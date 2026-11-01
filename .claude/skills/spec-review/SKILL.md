---
name: spec-review
description: "Reviewer-side /spec peer review. Reviews one phase of an active spec against the codebase."
library-version: 2f9730d23fa3
---

# /spec-review

> **Vault paths (DEVS-78):** resolve once per session with `vault-path` (`~/.local/bin/vault-path`).
> `PROJECT_VAULT=$(vault-path project)` is `<repo>/DocVault/`, and edits ride the current branch and PR.
> `SHARED_VAULT=$(vault-path shared)` is usually `/Volumes/DATA/GitHub/Devops/DocVault/`, and edits commit
> directly to Devops `main` (`DocVault/**` only). Sensitive pages from public repos go in `$(vault-path private)`.

You are the peer reviewer for a single phase of an active `/spec`. This is the reviewer-side skill; the originating agent invoked `/spec review <ISSUE-ID> <phase> <your-name>` and handed you a pointer to this skill instead of pasting a long prompt.

## Invocation

```
/spec-review <ISSUE-ID> <phase> [REVIEWER-TAG]
```

- `<ISSUE-ID>` — the issue prefix and number, e.g. `STRK-123`, `STAK-457`.
- `<phase>` — one of `requirements`, `discovery`, `approach`, `tasks`.
- `[REVIEWER-TAG]` — optional. The uppercase tag used to prefix your comments (e.g. `OPUS`, `GEMINI`, `DEEPSEEK`, `KIMI`, `CODEX`). If omitted, you will be prompted.

If `ISSUE-ID` or `phase` is missing, print:

```
Usage: /spec-review <ISSUE-ID> <phase> [REVIEWER-TAG]
       phase ∈ requirements | discovery | approach | tasks
       REVIEWER-TAG — uppercase label for your review blocks (e.g. OPUS, GEMINI, KIMI)
```

…and exit. Do not guess.

## Hard gates (run in order; fail fast)

1. **Resolve the spec directory.** It lives at `{specs-root}/{ISSUE-ID}-{slug}/`, in-repo (the worktree's copy when run from a worktree). Resolve `{specs-root}` per `.claude/skills/spec/references/conventions.md` → Folder resolution (`specs.path` in `.claude/project.json`, default `DocVault/specs`). Glob for `{specs-root}/{ISSUE-ID}-*` (ignore `archive/`) — there should be exactly one match. If zero or multiple, STOP and print the candidates.
2. **Locate the target file.** `{SPEC_DIR}/{phase}.md`. If absent, STOP: "Phase `{phase}` has not been drafted yet for {ISSUE-ID}." Read the phase files it depends on too (discovery → requirements; approach → requirements + discovery; tasks → all four), plus `AGENTS.md` and `.context/GLOSSARY.md` if present.
3. **Establish your reviewer tag (`{{COMMENT_PREFIX}}`).** Do NOT auto-detect or guess based on model name — models misidentify themselves across harnesses.
   - If a `REVIEWER-TAG` argument was supplied on invocation, use it as-is (uppercase).
   - Otherwise, ask the user: "What tag should I use for this review? (e.g. OPUS, GEMINI, DEEPSEEK, KIMI, CODEX)" — wait for their answer before continuing.
   - This tag appears in every `> {{COMMENT_PREFIX}}:` comment and the `## {{COMMENT_PREFIX}} Review` section header.
4. **Detect existing peer reviews without blocking new reviewers.** Scan the target file for inline `> {prefix}:` blocks or `## {prefix} Review` sections NOT nested under `## Review Archive`.
   - If unreconciled review from other reviewers is present, keep going. Preserve those comments exactly and add your own `{{COMMENT_PREFIX}}` comments alongside them. Multiple peer reviewers are expected to update the same phase file before reconciliation.
   - If unreconciled review from your own `{{COMMENT_PREFIX}}` is already present, STOP: "Review from {{COMMENT_PREFIX}} is already present in {phase}. Ask the human whether to rerun this reviewer or reconcile first."
   - Do not tell the human to run `/spec reconcile` just because OPUS, DEEPSEEK, GEMINI, KIMI, CODEX, or another peer reviewer has already left comments. Reconciliation happens once, after all requested peer reviews have updated the file.

## The review

VERIFY AGAINST THE LIVE CODEBASE — do not review the prose in isolation.

- For every claim about current behavior, existing code paths, data shapes, or "what users do today" — open the repo and confirm or refute. Cite file paths and line numbers in your comments.
- For every named symbol, file, route, table, or library — confirm it actually exists at the claimed location (or note explicitly that it is to be created).
- When the phase asserts something is impossible / expensive / already-handled — verify before accepting that framing.

CHALLENGE ASSUMPTIONS — make the implicit explicit.

- List every unstated assumption you can detect under a `## {{COMMENT_PREFIX}} — Unverified Assumptions` subsection at the bottom of the target file.
- Flag any assumption that looks load-bearing but is not backed by code, docs, or a prior decision.
- Where the phase narrows to a single solution shape, ask: are there 2–3 alternatives the author should have weighed? Name them.

## Phase-specific focus

| Phase | Focus |
|-------|-------|
| `requirements` | scope creep, missing edge cases, acceptance criteria that are not testable, non-goals that contradict the user stories |
| `discovery` | completeness of prior-art sweep, missed adjacent files, over-stated novelty, stale references |
| `approach` | architectural smells, hidden coupling, premature optimization, file-map drift from the discovery findings, tradeoffs claimed without a real loser |
| `tasks` | `[P]` markers that collide on shared files or shared symbols, file paths that do not appear in approach.md's File Map, missing or paraphrased Standard Closing Tasks, acceptance lines that cannot be verified mechanically |

## Output format

**Each reviewer edits `{phase}.md` in place — all reviewers write their blocks before reconciliation happens.**

- Add inline comments as `> {{COMMENT_PREFIX}}: ...` blocks beneath the line they apply to. Do not remove or modify blocks left by prior reviewers.
- At the bottom of the file (after any existing reviewer sections), add a `## {{COMMENT_PREFIX}} Review ({YYYY-MM-DD})` section containing:
  - **Verified** — what you checked against code, with paths/lines.
  - **Top concerns** — your 3 most load-bearing findings.
  - **Unverified assumptions** — the list from above.
- When done, print a one-paragraph chat summary: what you verified, your top 3 concerns, any assumption still unresolved.

**Reconciliation is a separate, human-triggered step** (`/spec reconcile`) that runs after all dispatched reviewers have written to the file. Do not wait for reconciliation before writing your own review.

## Hard prohibitions

- Edit any file other than `{phase}.md`.
- Rewrite user stories, acceptance criteria, file maps, or task items in place — propose edits in `> {{COMMENT_PREFIX}}:` comments and let the human reconcile.
- Block your review because another reviewer already updated the file. Peer review is additive; reconciliation is the later consolidation pass.
- Reconcile, resolve, archive, or delete another reviewer's comments.
- Stamp `approved:` — that field is human-only and lives in `tasks.md` only.
- Advance to a later phase. Later phases may not exist yet; that is by design.
- Run tests, builds, or any side-effecting commands. Review is read-only against the codebase.
- Invent findings. If the phase is clean, say so and leave only the review section.

## After completion

Print exactly:

```
Review complete. Phase: {phase}. Reviewer: {{COMMENT_PREFIX}}. File updated: {SPEC_DIR}/{phase}.md
If all reviewers have finished: /spec reconcile {ISSUE-ID} {phase}
If other reviewers are still running: wait for them, then reconcile once when all are done.
```

Do not invoke `/spec reconcile` yourself — reconciliation is the originating agent's job, with human approval, after **all** peer reviewers have written their blocks. Your job ends at the chat summary.

## Why this skill exists separately from `/spec review`

`/spec review <ISSUE-ID> <phase> <model>` is the **dispatcher** side — it runs in the originating agent and prints a copy-paste prompt for the reviewer.

`/spec-review <ISSUE-ID> <phase>` (this skill) is the **reviewer** side — it runs in whichever harness received the dispatch. By making it a standalone skill rather than embedded prompt text:

- The reviewer agent's behavior is versioned in one place.
- All three harnesses (Claude/Codex/Gemini) execute the same review contract.
- The dispatcher prompt collapses to one line: "run `/spec-review {ISSUE-ID} {phase}`".

See [Workflow Tiers]($SHARED_VAULT/KnowledgeBase/Development Patterns/Workflow Tiers.md) for how this fits into the broader spec lifecycle.
