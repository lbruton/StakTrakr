---
type: guide
project: devops
status: active
source: hand-authored
tags: [spec, workflow, spec-lite, multi-model]
created: 2026-05-07
---

# Spec — Human-Readable Guide

`/spec` is the phased workflow for anything bigger than a quick fix (15-minute freeform changes). Use it whenever work needs structure. It was named `/sketch` until DEVS-73 (2026-09-27). The older dashboard-driven SpecFlow MCP `/spec` was retired in DEVS-68; high-risk work now runs through `/spec` with a cross-model review on every phase.

> **TL;DR** — Four markdown files (requirements, discovery, approach, tasks), phased so you can hand each phase to a different model. The hard gate is "all four files exist + tasks.md has an `approved:` date." Then implementation runs.

## When to reach for /spec

| Situation | Tier |
|-----------|------|
| "Can you tighten this CSS selector and push?" | Quick fix |
| "Add a new column to the homepage card grid that shows last-updated time, also wire it through the API response." | **`/spec`** |
| "Refactor the auth middleware and add SAML support." | **`/spec`** + `/spec-review` by another model on every phase |

The middle one — touches 3-15 files, has acceptance criteria worth writing down — is the sweet spot. The last one is high-risk (security surface), so it gets the same phases plus mandatory per-phase cross-model review.

## The big picture

```
issue (DEVS-7)
   │
   ▼
/spec new   ──────────► creates DocVault/specs/DEVS-7-rate-limiter/
                          with 4 empty templates
   │
   ▼
/spec requirements ───► fills requirements.md  (PM voice)
   │
   ▼
/spec-review … requirements ─► prints prompts; dispatch to Codex/Gemini/Opus/OTHER;
                                 reviewers verify against live codebase, leave inline
                                 comments
   │
   ▼
/spec reconcile … requirements ► classify findings; ask you about ambiguous items
                                   inline; print plan; on your approval, edit the file
                                   and archive marks under `## Review Archive`
   │
   ▼
/spec discovery   ────► fills discovery.md     (Researcher voice)
                          PRE-CHECK refuses to run if prior phase has unresolved marks
   │
   ▼
/spec-review … discovery ────► dispatch
   ▼
/spec reconcile … discovery ─► reconcile
   │
   ▼
/spec approach    ────► fills approach.md      (Architect voice)
   ▼
/spec-review … approach  ────► dispatch
   ▼
/spec reconcile … approach ──► reconcile
   │
   ▼
/spec tasks       ────► fills tasks.md         (Tech lead voice)
   ▼
/spec-review … tasks  ───────► dispatch
   ▼
/spec reconcile … tasks ─────► reconcile
   │
   ▼  (you stamp `approved: 2026-05-12` in tasks.md frontmatter)
   │
/spec apply       ────► HARD GATE — verifies files + approval, then worktree + impl
   │
   ▼
/spec archive     ────► moves to archive/, milestone memory, closes issue
```

> **Per-phase review is the design.** A previous version of the workflow ran a single
> whole-spec review at the end. That sounded efficient but was structurally weak:
> reviewers saw a finished pyramid and tended to skim its base, so flaws in
> `requirements.md` propagated up through discovery, approach, and tasks before anyone
> caught them. The current flow inserts a review seam after every phase so flaws are
> caught while they are still cheap to fix.

## Command reference

All subcommands take the form `/spec <verb> <ISSUE-ID> [args]`. `ISSUE-ID` is the
Plane readable identifier (e.g. `STRK-69`, `DEVS-12`). Phase is one of `requirements`,
`discovery`, `approach`, `tasks`.

| Subcommand | Phase argument | Purpose |
|------------|----------------|---------|
| `new <ID> "<slug>"` | — | Scaffold spec folder + 4 templates |
| `requirements <ID>` | — | Phase 1 — draft requirements.md |
| `discovery <ID>` | — | Phase 2 — draft discovery.md |
| `approach <ID>` | — | Phase 3 — draft approach.md |
| `tasks <ID>` | — | Phase 4 — draft tasks.md |
| `reconcile <ID> <phase>` | **required** | Classify reviewer findings, edit file on approval, archive marks |
| `apply <ID>` | — | Hard gate → worktree + implementation |
| `archive <ID>` | — | Move to archive/, milestone memory, close issue |

The canonical order through a spec is:

```
new
  → requirements → /spec-review requirements → reconcile requirements
  → discovery    → /spec-review discovery    → reconcile discovery
  → approach     → /spec-review approach     → reconcile approach
  → tasks        → /spec-review tasks        → reconcile tasks
  → (stamp `approved:` in tasks.md)
  → apply
  → (PR merges)
  → archive
```

---

### `new <ID> "<slug>"`

**Run when:** the Plane issue exists and you've decided spec is the right tier (more than a quick fix; structure helps).

```
/spec new DEVS-12 "rate-limiter"
```

Creates `{specs-root}/{ID}-{slug}/` (default `DocVault/specs/`; see conventions.md) with empty
`requirements.md`, `discovery.md`, `approach.md`, `tasks.md`. The Plane issue's
title and description get pasted into a "Source Issue" block at the top of
`requirements.md`. Slug is short kebab-case — describe the work, not the issue
number.

**Won't:** start drafting any phase. That's the next step.

---

### `requirements <ID>` — Phase 1 (PM voice)

**Run when:** the spec is scaffolded and you have a clear-enough issue to extract user stories.

```
/spec requirements DEVS-12
```

Fills `requirements.md`: user stories ("As a … I want … so that …"), acceptance
criteria (Given / When / Then), explicit non-goals. Scope discipline is the
whole point — specs don't carry risk registers or NFR matrices.

**Won't:** advance to discovery, even if it looks trivial. Stop after one file.

**Next:** `/spec-review DEVS-12 requirements`.

---

### `discovery <ID>` — Phase 2 (Researcher voice)

**Run when:** requirements is drafted, reviewed, and reconciled.

```
/spec discovery DEVS-12
```

Fills `discovery.md`: existing relevant code (paths cited), prior decisions from
SessionFlow memory and transcripts, external references, open questions blocking approach.

**Pre-check:** refuses to run if `requirements.md` still has unresolved
`> AGENT:` marks or `## AGENT Review` sections outside `## Review Archive`. Run
`/spec reconcile DEVS-12 requirements` first.

**Won't:** propose solutions. That's the next phase.

**Next:** `/spec-review DEVS-12 discovery`.

---

### `approach <ID>` — Phase 3 (Architect voice)

**Run when:** discovery is drafted, reviewed, and reconciled.

```
/spec approach DEVS-12
```

Fills `approach.md`: high-level architecture (1-3 paragraphs), key decisions
with one-line rationale + tradeoff, file/module map (new / modified / deleted),
out-of-scope items pushed to follow-up issues.

**Pre-check:** refuses to run if `requirements.md` or `discovery.md` has
unresolved review marks.

**Won't:** write code, draft tests, or decide implementation order.

**Next:** `/spec-review DEVS-12 approach`.

---

### `tasks <ID>` — Phase 4 (Tech-lead voice)

**Run when:** approach is drafted, reviewed, and reconciled.

```
/spec tasks DEVS-12
```

Fills `tasks.md`: sprint cohorts, each task with file paths and acceptance
checks, `[P]` markers on tasks that can run in parallel. Cohort 0 is the
worktree-setup task. Standard Closing Tasks block goes at the end verbatim
(`/release patch`, `/vault-update`, `codacy-analysis-cli`, `/pr-resolve`,
`/spec archive`) — no paraphrasing.

**Pre-check:** refuses to run if any of the three prior files has unresolved
review marks.

**Built-in validations** (printed after drafting):
- Parallelization sanity check — every `[P]` proven not to collide on shared files/symbols
- File-map cross-check — every task's file path appears in approach.md's File Map (and vice-versa)
- Skill-name discipline — no paraphrased closing tasks

**Won't:** mark tasks complete, set `approved:`, or run any task.

**Next:** `/spec-review DEVS-12 tasks`.

---

### `review` — now a standalone skill

Per-phase peer review has been extracted to the `/spec-review` skill. Run `/spec-review <ID> <phase>` after each phase, then `/spec reconcile <ID> <phase>` to process the findings. See the `/spec-review` skill for full documentation.

---

### `reconcile <ID> <phase>` — apply review findings, archive the marks

**Run when:** the reviewers have returned their comments (one is enough; more is better) and the phase file is marked up with `> AGENT:` blocks and per-agent review sections.

```
/spec reconcile DEVS-12 requirements
```

What it does:

1. Reads all reviewer marks in `{phase}.md` (inline + per-agent sections + unverified-assumptions blocks).
2. Classifies each finding:
   - **Cluster** — consensus (2+ agents agree), single-source, or divergent (agents disagree).
   - **Disposition** — accept (mechanical fix), reject (out of scope / wrong — but verifies against the live repo before rejecting an existence claim), or needs-your-call.
3. **Asks you about ambiguous items inline as it works** — not batched at the end. Context for each question is fresh, you answer once, reconcile moves on.
4. Prints a structured plan: ACCEPT n, REJECT n (with reasons), YOUR-CALL resolved, NET CHANGES.
5. **Waits for an explicit approval signal** — "approve", "go", "do it", "ship it". Generic "looks good" or silence does not count.
6. On approval: edits the file to apply accepted edits, strips inline `> AGENT:` marks from the body, and moves all original per-agent review sections verbatim into a single `## Review Archive — {phase} ({date})` section at the bottom.

**Won't:**
- Edit the file before getting explicit approval
- Stamp `approved:` (that's still human-only on tasks.md)
- Auto-invoke the next phase command
- Paraphrase reviewer text in the archive — the archive is verbatim, by design

**Next:**

| After reconcile of | Next command |
|--------------------|--------------|
| `requirements` | `/spec discovery DEVS-12` |
| `discovery` | `/spec approach DEVS-12` |
| `approach` | `/spec tasks DEVS-12` |
| `tasks` | stamp `approved:` in tasks.md frontmatter → `/spec apply DEVS-12` |

---

### `apply <ID>` — hard gate + implementation

**Run when:** all four files are reconciled and `tasks.md` frontmatter has `approved: YYYY-MM-DD`.

```
/spec apply DEVS-12
```

Gate checks (all must pass — refuses to proceed otherwise):

- All four phase files exist, ≥10 lines of body content each
- `tasks.md` frontmatter has `approved:` matching `YYYY-MM-DD`
- Approved date is ≤14 days from today

Then:

1. Creates worktree `../{project}-spec-{ID}` on branch `spec/{ID}-{slug}`
2. Marks the Plane issue In Progress
3. Executes `tasks.md` task-by-task. For each task: do the work → verify acceptance → **edit tasks.md to mark `[x]` BEFORE starting the next task** (the marks are the audit trail and recovery point — never batched)
4. Runs Standard Closing Tasks in order (verify, scan, ship)
5. Opens PR referencing the spec path

**Won't:** run if any gate check fails, or if any prior phase has unresolved review marks (the phase-prompt PRE-CHECK still applies in spirit — verify-then-apply).

---

### `archive <ID>` — clean shutdown

**Run when:** the PR has merged (or the spec is being abandoned).

```
/spec archive DEVS-12
```

Moves the spec folder to `specs/archive/YYYY-MM-DD-{ID}-{slug}/`, saves a
milestone memory in SessionFlow, marks the Plane issue Done.

---

---

## A worked example

Let's walk through `DEVS-12 — add per-IP rate limiting to the API`. (Hypothetical.)

### 1. Scaffold

```
> /spec new DEVS-12 "rate-limiter"
```

This creates `Devops/DocVault/specs/DEVS-12-rate-limiter/` with four empty template files. The Plane issue title and body get pasted into a "Source Issue" block at the top of requirements.md.

### 2. Requirements (Claude or any reasoning-strong model)

```
> /spec requirements DEVS-12
```

The skill prints the phase prompt. Claude reads the source issue, fills in user stories and acceptance criteria, lists non-goals (like "not implementing global rate limit, just per-IP"), and stops.

You read what was written, edit anything wrong, save.

### 3. Discovery (large-context model — Gemini or Kimi shine here)

You hand off via OpenCode:

```
> opencode --model kimi-k2
> /spec discovery DEVS-12
```

Kimi reads requirements.md, scans the API repo for existing middleware patterns, searches SessionFlow memory for prior rate-limit decisions, and writes discovery.md. Notes that there's already a `RateLimitToken` class in `lib/middleware/quota.ts` worth building on.

Or you stay in Claude Code and run the phase yourself. The skill works the same.

### 4. Approach (reasoning model again)

```
> /spec approach DEVS-12
```

Claude (or your model of choice) reads requirements + discovery, proposes:
- Reuse `RateLimitToken`, add Redis backend
- Decision: in-memory fallback when Redis unavailable (with logged warning)
- File map: 2 new files, 3 modified, 0 deleted

Tradeoff surfaced: "in-memory fallback means rate limits don't survive restart — acceptable for v1?"

You decide yes, that's fine, and edit the file to reflect the decision.

### 5. Tasks (Claude is good at sprint breakdowns)

```
> /spec tasks DEVS-12
```

Tasks.md gets sprint cohorts:

```markdown
## Sprint Cohort A — Foundation (parallel-safe)

- [ ] **A.1 [P]** Add Redis client wrapper
  - File(s): `lib/redis/client.ts`
  - Acceptance: connects, retries 3x, logs failure
  - Maps to: AC-2

- [ ] **A.2 [P]** Extend RateLimitToken with backend interface
  - File(s): `lib/middleware/quota.ts`
  - Acceptance: existing tests still pass; new interface is opt-in
  - Maps to: AC-1
```

A.1 and A.2 touch independent files — perfect for parallel dispatch.

### 6. Cross-model review — once per phase

Review is **not** a single step at the end. It runs after every phase:

```
> /spec-review DEVS-12 requirements    # right after step 2
> /spec-review DEVS-12 discovery       # right after step 3
> /spec-review DEVS-12 approach        # right after step 4
> /spec-review DEVS-12 tasks           # right after step 5 (this section)
```

Each invocation prints four copy-paste blocks — Codex, Gemini, Opus, OTHER. The blocks
target only the named phase file and list prior phases as read-only context. Crucially,
every block forces the reviewer to verify against the **live codebase**, not just the
spec prose.

A real Codex block for the tasks phase looks like:

```
=== Send to Codex ===

ROLE: Peer reviewer for Phase — tasks — of a spec.

TARGET (edit this file only):
  /Volumes/DATA/GitHub/Devops/DocVault/specs/DEVS-12-rate-limiter/tasks.md

PRIOR PHASES (read-only context — do not edit):
  requirements.md, discovery.md, approach.md

REPO TO VERIFY AGAINST:
  /Volumes/DATA/GitHub/Devops

VERIFY AGAINST THE LIVE CODEBASE — do not review the prose in isolation.
  • For every claim about current behavior, existing code paths, data shapes,
    or "what users do today", open the repo and confirm or refute it. Cite
    file paths and line numbers in your comments.
  ...
```

Codex reads, leaves comments like
`> CODEX: A.1 and A.2 aren't actually independent — A.2 imports the interface A.1 defines (see lib/middleware/quota.ts:42). Strip [P] from A.2 and add Depends on: A.1.`

Then you run:

```
> /spec reconcile DEVS-12 tasks
```

The reconcile step reads all reviewer marks in `tasks.md`, classifies them
(consensus vs. single-source vs. divergent → accept / reject / needs-your-call),
asks you about anything ambiguous *inline as it works* (not batched), prints a
structured plan ("ACCEPT 4, REJECT 1 (out of scope), YOUR-CALL resolved 2"),
and waits for an explicit approval signal. On "approve" / "go" / "do it", it
applies the edits, strips inline `> AGENT:` marks from the body, and archives
the original per-agent review sections under
`## Review Archive — tasks (2026-05-12)` at the bottom of the file. The audit
trail stays attached to the spec; the working body of `tasks.md` is clean
for the next reader.

The same flow happens after every phase — `requirements`, `discovery`,
`approach`, `tasks` — so reviewers are not re-litigating the requirements
while inspecting tasks. The phase commands themselves now PRE-CHECK for
unresolved marks; if you skip the reconcile step, `/spec discovery` (etc.)
will refuse to run and tell you exactly which file is dirty.

> **Why per-phase, not whole-spec.** A reviewer who sees only `requirements.md` (with
> the repo open) is forced to engage with what it claims about the world. A reviewer who
> sees all four files at once tends to skim the early ones and focus on the concrete
> task list — by then the foundation is fixed and the reviewer is just decorating it.
> The per-phase seam exists to keep every layer challengeable.

### 7. Approval

You're satisfied. Edit tasks.md frontmatter:

```yaml
---
spec: "DEVS-12-rate-limiter"
phase: tasks
created: 2026-05-07
approved: 2026-05-07
---
```

### 8. Apply

```
> /spec apply DEVS-12
```

The skill:
- Verifies all four files non-empty
- Verifies `approved:` is set and ≤14 days old
- Creates worktree `Devops-spec-DEVS-12` on branch `spec/DEVS-12-rate-limiter`
- Reads tasks.md, executes task-by-task, commits per cohort
- Runs Standard Closing Tasks (test suite, codacy-analysis-cli scan, version bump if applicable, vault-update, close issue, open PR)

### 9. Archive

After PR merges:

```
> /spec archive DEVS-12
```

Folder moves to `specs/archive/2026-05-07-DEVS-12-rate-limiter/`. SessionFlow memory gets a milestone record. Done.

## Multi-model orchestration patterns

The whole point of /spec is that **the markdown files are the only shared state**. Any model with filesystem access (or a copy-paste of the file contents) can pick up any phase.

### Pattern 1: Single-driver, multi-model phases

You drive from Claude Code. For each phase, you decide which model is best:

| Phase | Strong fit | Why |
|-------|-----------|-----|
| requirements | Claude/Codex | Careful scope discipline |
| discovery | Gemini/Kimi | Large context window for reading codebases |
| approach | Claude/Codex | Reasoning + tradeoff surfacing |
| tasks | Claude (Sonnet) | Fast structured output |
| review (each phase) | All four (Codex/Gemini/Opus/OTHER), in parallel | Coverage + verification against the live codebase |

### Pattern 2: Round-robin draft-and-review

Pass the spec through every model, each one improves what the prior one wrote:
- Kimi drafts requirements
- Claude reviews + edits
- Gemini drafts discovery
- Kimi reviews + edits
- Etc.

Keeps every model's tokens working. Good for non-time-critical specs.

### Pattern 3: Specialist routing

Use models for what they're best at:
- Codex for tasks involving language-server-aware Python/TS edits
- Gemini for vast-codebase discovery
- Kimi/GLM for routine drafting (cheaper)
- Claude for the final architect-voice pass on approach.md

Each phase happens once; you pick the best model for it.

## When a spec turns out to be high-risk

Sometimes mid-spec you realize the work is bigger than you thought — it touches schema, public API, or security. There is no longer a separate tier to promote to (the SpecFlow `promote` escape hatch was removed with the SpecFlow MCP in DEVS-68). Instead, stay in the spec and raise the review bar: from the current phase on, run `/spec-review` with at least one other model on every phase, and go back and review any phase that skipped it.

## Anti-patterns (don't do these)

- **Skipping discovery.** Discovery exists to catch "oh, we already have this" before approach.md commits to building it. Even an empty-feeling discovery section ("nothing material exists yet") is useful — it's evidence the question was asked.
- **Pre-filling `approved:`.** The approval stamp means a human read all four files and agrees. If you stamp it from inside a phase prompt, you've defeated the gate.
- **Editing requirements.md from later phases.** If discovery contradicts requirements, surface the conflict and stop. Don't silently rewrite. The phase order is forward-only by design.
- **Running security-sensitive or schema-changing work without per-phase cross-model review.** High-risk specs need a `/spec-review` from at least one other model on every phase.
- **Multiple specs for one issue.** One issue → one spec folder. If scope splits, file follow-up issues.
- **Skipping per-phase review and saving it all for the end.** The whole-spec review is the form that was retired. Run `/spec-review <ID> <phase>` after every phase so flaws are caught at the seam where they originate, before later phases inherit them.
- **Reviewing prose without opening the repo.** Every printed block tells the reviewer to verify claims against the live codebase. If a reviewer comes back with general impressions but no path:line citations, push back — the prompt was wasted.

## FAQ

**Q: Is /spec the same as Superpowers' brainstorming + writing-plans?**
A: Similar in spirit but four artifacts vs. two, scoped to your DocVault layout, and built around the Plane issue model.

**Q: Why renamed `design.md` → `approach.md`?**
A: To dodge the collision with `impeccable:shape` and the broader UI design.md convention. Spec's "approach" is technical architecture, not visual design.

**Q: Can I run /spec without a Plane issue?**
A: No. The skill requires `{ISSUE-ID}` to anchor the spec folder name and to populate the source-issue block. File the issue first (`/issue` skill).

**Q: What happens if I let the 14-day approval freshness expire?**
A: `/spec apply` refuses. Re-review the four files (the world may have moved), re-stamp `approved:` with today's date, re-run.

**Q: Do I have to use Sprint Cohorts in tasks.md?**
A: Yes — they're the structure that makes parallel dispatch obvious. Even if you have just one cohort, label it. The `[P]` markers tell future-you (or another model) which tasks are safe to run concurrently.

**Q: Where do spec files live in DocVault for cross-project work?**
A: Always under the project the work belongs to, at its specs root: `specs.path` in that project's `.claude/project.json`, or `DocVault/specs/` when unset (e.g. StakTrakr uses `docs/specs/`). The DEVS-prefixed specs you've seen in this guide live under `Devops/DocVault/specs/`.

**Q: Why is `/spec-review` per-phase now? I liked the one-shot version.**
A: The one-shot form let reviewers see the whole spec at once, which sounds thorough but is structurally weak — the finished tasks list anchors attention away from the requirements, so the base of the pyramid never gets challenged. Per-phase review forces engagement with one file at a time, with the repo open. Yes, it is more commands. The point is that each one is shorter and the reviewer cannot skim the foundation.

**Q: What if I only have time to review one phase?**
A: Review `requirements`. Everything downstream inherits its scope and acceptance criteria — a bad requirements doc poisons everything else. If you only have appetite for one review pass, run it at the top, not the bottom.

**Q: What does the OTHER block in the printed prompts mean?**
A: It's a placeholder for a fourth reviewer you choose at dispatch time — Kimi, GLM, Grok, a coworker, whoever. The block uses `{AGENT_NAME}` / `{AGENT_NAME_UPPER}` placeholders you substitute before pasting. Keeps the prompt usable across reviewer rotations without baking a model name into the skill.

**Q: Why a separate `/spec reconcile` step? Couldn't review just produce a clean file?**
A: Review's job is to surface findings; reconcile's job is to decide what to do about them. Mixing the two would force reviewers to also be editors — and they're separate agents with separate goals. Reconcile is also where *you* enter the loop: classification is mechanical for most marks, but every spec has 1-3 judgment calls only you can make, and reconcile is structured to ask about those inline rather than guess.

**Q: What happens if I run `/spec discovery` without reconciling requirements first?**
A: The discovery phase PRE-CHECKs `requirements.md` for unresolved `> AGENT:` marks or `## AGENT Review` sections outside `## Review Archive`. If it finds any, it stops and tells you to run `/spec reconcile DEVS-12 requirements` first. Same pattern for approach (checks requirements + discovery) and tasks (checks all three priors). The check is observational, not a marker-file gate — if you really need to bypass it, you can manually move marks into a Review Archive section yourself, but the friction is intentional.

**Q: Reconcile asked me a question mid-classification. Is that a bug?**
A: No — that's the design. The Q&A is interleaved, not batched, because the reviewer's argument and the surrounding phase context are fresh in reconcile's working memory at that moment. Batching ambiguous items to the end would force you to re-orient on each one. Answer, and reconcile keeps going.

**Q: What if I don't approve the reconcile plan?**
A: Say so. Reconcile re-reads its analysis, integrates your push-back, and re-prints the plan. The file is only edited after an unambiguous approval signal — "approve", "go", "do it", "ship it". Silence and "looks good" don't count.

## Pointers

- Skill: `.claude/skills/spec/SKILL.md` (master: `Devops/skill-library/skills/spec/`)
- Templates: `.claude/skills/spec/references/templates/`
- This guide: `.claude/skills/spec/references/Guide.md`
- DEVS-7 — original issue tracking the v0 build of /spec
