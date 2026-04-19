---
description: "End-of-session retrospective — extracts prescriptive lessons and saves to mem0. Run before /wrap."
---

Conduct a structured retrospective on the current session.

## The Core Distinction

- **digest/wrap** → descriptive: "Today we did X, worked on Y"
- **retro** → prescriptive: "Next time, do X before Y" / "Never edit A without checking B"

## Step 1: Detect project

```bash
basename $(git rev-parse --show-toplevel)
```

## Step 2: Reflect on the conversation

Scan the full conversation for:

1. **Errors** — things that went wrong, wasted time, or needed correction
2. **Warnings** — near-misses, fragile assumptions, things that almost broke
3. **Patterns** — reusable approaches that worked well
4. **Improvements** — process changes that would save time next session
5. **Preferences** — user corrections about how they want things done

## Step 3: Format lessons

Each lesson follows this format:

```
- [category] Brief actionable statement — context explaining why this matters
```

Categories: `[error]`, `[warning]`, `[pattern]`, `[improvement]`, `[preference]`

## Step 4: Save to mem0

Call `add_memory` for each lesson with metadata:

- tags: project tag, "retro-learning", date
- Format: prescriptive statement with context

## Rules

- Extract 3-7 lessons per session (quality over quantity)
- Focus on SURPRISING or NON-OBVIOUS lessons — skip things already in CLAUDE.md
- Each lesson must be actionable in future sessions
- Present lessons to user before saving — they may want to edit

$ARGUMENTS
