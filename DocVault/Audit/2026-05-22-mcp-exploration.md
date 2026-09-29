# MCP Exploration — StakTrakr Development Context

> **Historical snapshot.** CGC (code-graph-context) was retired 2026-07-27 and must not be re-added; the CGC sections (1 and 7) are kept as record only. Current code search order: `claude-context` semantic search, then Grep/Glob for identifiers — script-tag globals have no import graph, so Grep is authoritative for references.

**Date:** 2026-05-22  
**Scope:** Full MCP stack evaluation (SessionFlow, Mem0, Git, Claude-Context, CGC) against the last 3 days of StakTrakr development. Instruction file audit (AGENTS.md, CLAUDE.md). Skill inventory gap analysis. SessionFlow improvement recommendations.

---

## 1. MCP Power & Limits

| MCP                | Power                                                                                                                                                                                   | Limit                                                                                                                                                                                                                                                                       |     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| **SessionFlow**    | Cross-harness visibility across 5 providers, 19,100 indexed turns. Date/provider/project filters work. Turn-level retrieval with `get_turns`. Full sketch lifecycle visible end-to-end. | No "list recent sessions" without a query. `antigravity_desktop` shows `project: unknown`. Semantic search has recency bias — older hits rank above newer ones without `date_from`. No issue-ID-aware search. Backfill gap (SESF-17): new sessions take up to 1hr to index. |     |
| **Mem0**           | Good for curated episodic decisions and retro learnings. `metadata.project` filtering works.                                                                                            | Semantic search buries wrap summaries below position 10 (confirmed in retro learning `f49f119e`). Should be fallback, not primary — SessionFlow outperforms it for session-start context.                                                                                   |     |
| **Git**            | Authoritative truth. 7 commits from May 20–22 tell the full story: `v3.34.76`→`v3.34.78`.                                                                                               | Stale local branches from squash merges aren't detected by `pr-cleanup` (no `[gone]` ref). Worktree state visibility requires explicit `git worktree list`.                                                                                                                 |     |
| **Claude-Context** | Semantic code search found the dedup merge at `retail.js:941` and publisher pipeline at `api-export.js:590` with relevant queries.                                                      | Index is a week stale (May 19). Cross-domain queries (e.g. "sketch workflow") return irrelevant code. Needs re-indexing before heavy use. `106 files, 2980 chunks`.                                                                                                         |     |
| **CGC**            | Should provide structural analysis (callers, dead code, complexity).                                                                                                                    | **Not functional as of May 22.** `get_repository_stats` errored. `find_callers` on `syncSpotPricesFromApi` returned 0 results. `find_dead_code` returned empty. StakTrakr code graph appears unindexed or disconnected.                                                     |     |

### MCP Retrieval Tier (proven today)

| Tier | MCP | Use case |
|---|---|---|
| Primary | **SessionFlow** | Session-start context, cross-harness history, "what happened today" |
| Secondary | **Git** | What actually changed on disk, commit history, branch state |
| Fallback | **Mem0** | Curated decisions, retro learnings, cross-session patterns |
| Code search | **Claude-Context** | Semantic codebase queries (when indexed) |
| Structural | **CGC** | Call chains, dead code, complexity (when functional) |

---

## 2. Instruction File Gaps

### AGENTS.md — Missing

- **No `/sketch` workflow documented.** The "Spec → Tasks → Draft PR Flow" section (line 118) only describes the full `/spec` lifecycle. STRK-92 shipped entirely through `/sketch` — which isn't mentioned anywhere in AGENTS.md.
- **No SessionFlow.** Agents that do cross-harness work (Codex, OpenCode, Antigravity) don't know SessionFlow exists or how to query it for prior context.
- **No multi-harness peer review guidance.** DEEPSEEK and ANTIGRAVITY ran sketch reviews all day, but AGENTS.md doesn't tell them which phases to review or how to dispatch.
- **The `$spec` not `/spec` handoff note** in CLAUDE.md:62 is outdated — the active workflow uses `/sketch`.

### CLAUDE.md — Missing

- **Skills table (line 66) omits sketch workflow skills.** No `/sketch`, `/sketch-review`, `/sketch reconcile` entries. These were the most-used skills today across 4 harnesses.
- **No SessionFlow in MCP Notes.** The primary session-start context source is undocumented. No guidance on provider filters, `date_from`, or `project_root: "*"` for cross-project queries.
- **`/start` and `/prime` are Claude-only.** Pass 0 reaches into `~/.claude/projects/` for JSONL files — it doesn't reach into Codex rollout dirs or OpenCode storage. The skills know SessionFlow exists (Pass 1), but their filesystem-first approach is Claude-centric.
- **No cross-harness handoff protocol.** When Claude finishes a sketch phase and dispatches review to DEEPSEEK, there's no documented pattern for how the results flow back.

### CLAUDE.md — Needs Update (specific lines)

| Line(s) | Issue | Suggested fix |
|---|---|---|
| 62 | `Codex handoff prompts use $spec not /spec` | Update to `/sketch` — `$spec` is the old full-spec workflow |
| 66-81 | Skills table missing sketch skills | Add `/sketch`, `/sketch-review`, `/sketch reconcile` rows |
| 51-63 | MCP Notes: no SessionFlow | Add SessionFlow section with provider names, filter guide, and note that it's the primary session-start source |
| 35-49 | Git Topology: no sketch branch naming | Add sketch branch convention or note that `/sketch orchestrate` generates `sketch/` branches that need `patch/` conversion for StakTrakr |

---

## 3. Skill Gaps

| # | Gap | Why it matters |
|---|---|---|
| 1 | **No `/sketch` in the StakTrakr skills table** | It's the middle-tier workflow used for STRK-92, STRK-85, STRK-74, STRK-91. CLAUDE.md should list it alongside `/sketch-review` and `/sketch reconcile`. |
| 2 | **No "cross-harness context aggregate"** | `/start` and `/prime` should query all providers by default, not just `claude_code_cli`. A single `search_all_sessions(project_root: "*", date_from: today)` across all providers + dedup + sort by recency would give a complete picture. |
| 3 | **No "issue timeline" skill** | "What did all harnesses do on STRK-92?" requires 3–4 separate SessionFlow queries. A single tool or skill that searches by issue ID across all providers and returns a chronological timeline. |
| 4 | **`/start` Pass 0 is Claude-only** | Reads `~/.claude/projects/` files for the prior session ID. Misses Codex, OpenCode, and Antigravity sessions between Claude sessions. Should fall through to SessionFlow earlier. |
| 5 | **No `/sketch-review` dispatch documentation** | The workflow works but it's tribal knowledge. CLAUDE.md should document: `/sketch review <ID> <phase>` dispatches to all configured reviewer harnesses, each running the shared `/sketch-review` skill from `~/.agents/skills/sketch-review/SKILL.md`. |

---

## 4. SessionFlow Improvement Recommendations

### For the index engine

| # | Issue | Recommendation |
|---|---|---|
| SF-1 | `project: unknown` for antigravity_desktop sessions | Add project-root resolver in the ingestion pipeline — map working directories to known project paths |
| SF-2 | No "list recent" endpoint | Add `list_recent_sessions(limit, project_root)` — returns most recent N sessions regardless of query. Would let `/start` skip filesystem pass entirely. |
| SF-3 | Recency-blind ranking | Hybrid score: `0.7 × recency + 0.3 × semantic`. Or add `boost_recent` boolean flag to `search_all_sessions`. |
| SF-4 | No issue-ID-aware search | Extract referenced issue IDs (STRK-###, SESF-###, etc.) during ingestion and tag turns. Add `issue_id` filter to search. |
| SF-5 | SESF-17 backfill gap | Install hourly backfill LaunchAgent by default, or fix incremental watcher so new sessions appear in near-real-time. |

### For the search tool schema

| # | Feature | API shape |
|---|---|---|
| SF-6 | `issue_id` filter | `search_all_sessions(issue_id: "STRK-92")` — filters across all providers |
| SF-7 | `sort_by` parameter | `search_all_sessions(sort_by: "recency" \| "relevance" \| "hybrid")` — default hybrid |
| SF-8 | `timeline` endpoint | `timeline(issue_id: "STRK-92", date_from, date_to)` — chronological feed across all harnesses, deduplicated |

---

## 5. Today's Development — Full Picture (via SessionFlow)

### Commits (May 20–22)

```
v3.34.78 — STRK-92: Fill 90-day Market History with per-vendor data
v3.34.77 — STRK-93: Fix header Spot button 4× API sync
v3.34.76 — STRK-89: Add gold-api.com as first-class spot provider
```

### Sketch Workflow Activity

| Issue | Phase | Author | Reviewer(s) | Status |
|---|---|---|---|---|
| STRK-92 | Full lifecycle | Claude | DEEPSEEK (discovery, approach, tasks) | Shipped v3.34.78 |
| STRK-74 | Requirements → Discovery reconciled | Claude | DEEPSEEK (requirements) | In progress |
| STRK-85 | Requirements | Claude | DEEPSEEK (requirements) | In progress |
| STRK-91 | Requirements → Discovery scaffolded | Claude | ANTIGRAVITY (requirements), DEEPSEEK (requirements) | In progress |
| STRK-88 | Archived | Claude | — | Shipped (prior) |

### Harness Involvement

| Harness | Role | Sessions today |
|---|---|---|
| **Claude Code CLI** | Authoring, orchestration, implementation | 10+ sessions |
| **Codex** | SessionFlow testing, bug analysis (STRK-93), start/wrap cycles | 3 sessions |
| **DEEPSEEK (OpenCode)** | Per-phase code-verification peer review | 7 sessions |
| **Antigravity Desktop (Gemini)** | UX/accessibility review, instruction file maintenance, sketch orchestration | 5 sessions |
| **Antigravity CLI** | Idle — last used May 20 | 0 sessions |

### Cross-Harness Review Topology

```
Claude authors sketch phase
   → /sketch review dispatches to configured reviewers
      → DEEPSEEK (via OpenCode): code verification, path existence, API shape accuracy
      → ANTIGRAVITY (via Desktop): UX, accessibility, touch targets, ARIA, data shapes
   → Claude runs /sketch reconcile to process review comments
   → Advance to next phase
```

---

## 6. Provider Coverage Growth (SessionFlow Index)

| Provider | Earlier Today | Now | Delta |
|---|---|---|---|
| opencode | 203 turns | 1,895 turns | +1,692 (backfill unblocked) |
| codex | 6,285 | 9,045 | +2,760 |
| antigravity_desktop | 144 | 447 | +303 |
| claude_code_cli | 7,605 | 7,660 | +55 |
| antigravity_cli | 53 | 53 | 0 (idle) |
| **Total** | **14,290** | **19,100** | **+4,810** |

---

*Generated via SessionFlow + Mem0 + Git + Claude-Context exploration. See sessionflow for turn-level detail on any finding above.*

---

## 7. CGC Re-test — Before vs. After (2026-05-22, second run)

### Context

First run had CGC effectively broken — `get_repository_stats` threw `MCP error -32000`, dead code and caller queries returned empty. Second run (same session, later) shows a fully indexed graph across 15 repositories. Root cause was likely CGC not yet connected/indexed on first attempt, not a persistent failure.

### Before vs. After Table

| Query | First Run | Second Run |
|---|---|---|
| `list_indexed_repositories` | Not attempted | 15 repos (StakTrakr, HexTrackr, SessionFlow, Devops, etc.) |
| `get_repository_stats` | ❌ `MCP error -32000` | **508 files, 9,075 functions, 50 classes, 58 modules** |
| `find_callers` (`syncSpotPricesFromApi`) | ❌ 0 results | 0 results (confirmed limitation, not bug — see below) |
| `find_dead_code` | ❌ Empty | **48 potentially unused** (devops Python, legacy prettify.js, poller dashboard helpers) |
| `find_most_complex_functions` | Not attempted | Top 10: `main()` 15, `backfill_recent_hours` 12, `build_bundle` 11, `poll_once` 10 |
| `find_callees` (`addHistory`) | Not attempted | Correctly found `historyEntries.push({...})` at `retail.js:899` |
| `find_code` (`syncSpotPricesFromApi`) | Not attempted | Found in `api.js:1982` + content matches in `settings-listeners.js:42` and `events.js:3329` |
| `module_deps` (`js/retail.js`) | Not attempted | 0 importers, 0 imports (correct for vanilla JS) |
| `calculate_cyclomatic_complexity` (`handleRequest`) | Not attempted | Complexity 1 (likely undercount — AST parser struggles with Node.js HTTP handler pattern) |
| `call_chain` (`syncRetailPrices->renderRetailMarket`) | Not attempted | 0 chains (expected — no import graph between files) |

### Confirmed: Vanilla JS Global Scope Breaks Call Tracing

CLAUDIE.md:63 already documents this: *"the project uses script-tag globals, so when claude-context returns thin results for a global, fall back to CGC structural query before Grep."*

The second run confirms this is a fundamental limitation, not a temporary failure. `find_callers` returns 0 for `syncSpotPricesFromApi` even with 9,075 indexed functions, because CGC's call graph relies on import/module relationships that don't exist in a `<script>`-tag codebase. But:

- **`find_code` content matching fills the gap.** It found 7 references to `syncSpotPricesFromApi` including the STRK-93 fix in `settings-listeners.js:42` and the per-metal icon loop in `events.js:3329` — purely by the function name appearing in source text.
- **Intra-file tracing works.** `find_callees` on `addHistory` correctly identified `historyEntries.push(...)` as its callee, because both live in `retail.js`.
- **For this codebase, `find_code` (keyword + content search) is more useful than `find_callers`.** It's the effective "find references" tool for vanilla JS globals.

### Effective CGC Usage Pattern for StakTrakr

| Use case | Best CGC tool | Notes |
|---|---|---|
| Find where a global is called | `find_code` (content match) | Not `find_callers` — no import graph |
| Trace logic within one file | `find_callees`, `call_chain` | Works when caller/callee share a file |
| Find dead/unused code | `find_dead_code` | Filter out devops/Python noise |
| Identify complexity hotspots | `find_most_complex_functions` | Complexity values may be undercounted |
| Discover module structure | `get_repository_stats`, `module_deps` | Confirms zero-build vanilla JS topology |
| Explore cross-module relationships | Raw Cypher via `execute_cypher_query` | Fallback for custom queries |

### CGC → CLAUDE.md Recommendation

The CLAUDE.md:63 guidance is correct but incomplete. It should say:

> StakTrakr uses script-tag globals with no import graph, so `find_callers` will always return empty for cross-file calls. **Use `find_code` with content matching as the "find references" replacement.** `find_callees` and `call_chain` work within a single file. For cross-file impact analysis, combine `find_code` (to locate all references) with `claude-context` semantic search (to understand the calling context).
