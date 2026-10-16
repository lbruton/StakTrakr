---
spec: "{{ISSUE-ID}}-{{SLUG}}"
phase: discovery
created: {{DATE}}
---

# {{ISSUE-ID}} — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

| Path | Role | Notes |
|------|------|-------|
| `path/to/file.ts:42` | What it does | Why it's relevant |
| `path/to/other.py` | … | … |

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- {{DATE}} — _description of the prior decision_ (mem0 memory id or commit sha)
- _none found — first time touching this surface_

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- [Title](https://link) — what we'd take from it
- [Title](https://link) — …

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- Constraint 1: …
- Constraint 2: …

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

- [ ] Question 1
- [ ] Question 2

## Discovery Summary

_2–3 sentences: where the work will land, what looks tricky, what's already easy._

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/spec-approach {{ISSUE-ID}}`.
