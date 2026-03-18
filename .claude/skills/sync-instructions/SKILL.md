---
name: sync-instructions
description: Synchronize instruction files and skills across Claude Code, Codex, and Gemini after codebase changes. Use when new JS files are added, globals change, patterns evolve, version info updates, skills are modified, or MCP servers are added/removed.
user-invocable: true
---

# Sync Instructions & Skills

Keep instruction files and tracked skills aligned across Claude Code, Codex, and Gemini.

## Project Detection

```bash
gh repo view --json name,owner --jq '{owner: .owner.login, repo: .name}'
git rev-parse --show-toplevel
```

Use `REPO` and `PROJECT_PATH` where project-specific names appear below.

## When to Run

- After adding or removing JS files
- After adding new global functions or variables
- After adding new localStorage keys
- After changing critical patterns (DOM access, persistence, security)
- After major feature additions
- After changing the script loading order in `index.html`
- As part of a release workflow (post version bump)

## File Roles

| File | Audience | Git-tracked | Focus |
|------|----------|-------------|-------|
| `CLAUDE.md` | Claude Code (local Mac) | No | Full context + MCP servers + local skills/commands |
| `AGENTS.md` | Codex, Claude Code web, GitHub Actions, Jules | Yes | Full codebase context + MCP guide + handoff protocol |
| `GEMINI.md` | Gemini CLI | Yes | Codebase context + MCP guide + Gemini-specific conventions |
| `.github/copilot-instructions.md` | GitHub Copilot PR reviews | Yes | PR review rules, globals list, ESLint/PMD, patterns to enforce |

## Sync Process

### Phase 1: Detect Changes

1. **Script count**: `grep -c 'src="js/' index.html` — compare against the script count claim in all three files
2. **New JS files**: `ls js/*.js | wc -l` — compare against file listings
3. **New globals**: Search for new top-level `const`/`let`/`function` declarations in recently modified files
4. **New localStorage keys**: Check `ALLOWED_STORAGE_KEYS` in `constants.js` for entries not mentioned in docs
5. **Version**: Check `APP_VERSION` in `constants.js` against version references in instruction files

### Phase 2: Identify Gaps

| Change Type | CLAUDE.md | AGENTS.md | GEMINI.md | copilot-instructions.md |
|-------------|-----------|-----------|-----------|------------------------|
| New JS file | Add to file listing + load order | Add to file listing + load order | Add to Project Structure | Add globals if exported |
| New global | Add to relevant section | Add to globals table | Mention if significant | Add to globals list (critical) |
| New localStorage key | Mention if significant | Mention if significant | Not needed | Not needed |
| New pattern/convention | Add to Critical Patterns | Add to Critical Patterns | Add to Core Mandates | Add to Patterns to Enforce |
| Script order change | Update load order block | Update load order block | Update js/ description | Mention if relevant |
| New feature module | Add to Feature Modules | Add to Feature Modules | Add to Project Structure | Add globals + review focus |
| New MCP server | Add to `.mcp.json` + CLAUDE.md | Add to MCP table + usage block | Add to MCP Server Usage | Not needed |

### Phase 3: Apply Updates

For each file that needs changes:

1. Read the current file
2. Make targeted edits (don't rewrite the whole file)
3. Verify the file still parses correctly as markdown

### Phase 4: Report

```
Sync Instructions — Summary
=============================

Changes detected:
  - [list changes found]

Files updated:
  - CLAUDE.md: [what changed]
  - AGENTS.md: [what changed]
  - GEMINI.md: [what changed]
  - copilot-instructions.md: [what changed]

No changes needed: [list any files that were already current]
```

## Rules

- **Never strip local-only Mac tooling from CLAUDE.md** — local paths, local Claude skills invocations, and Mac-specific commands belong there only
- **AGENTS.md may include MCP, mem0, and Linear info** — Codex needs these; what it must NOT have is Mac-local paths, Claude skill invocations (like `/release`), or Mac keychain commands
- **GEMINI.md** — same scope as AGENTS.md but with Gemini-specific conventions (hooks, `/memory`, rewind). Keep in sync with AGENTS.md for shared sections
- **Never remove the MCP or handoff protocol sections from AGENTS.md or GEMINI.md** — those are agent-managed
- **copilot-instructions.md is the most detailed for globals** — Copilot needs explicit "do not flag" lists to avoid false positives
- **Keep the script load order block identical** across CLAUDE.md and AGENTS.md (GEMINI.md may abbreviate)
- **Update script count** whenever files are added/removed
- **Codacy instructions** are managed separately by Codacy — do not modify

## Phase 5: Skills Sync

Skills live in three tiers:

| Tier | Location | Audience | Invocation |
|------|----------|----------|------------|
| Claude Code user-level | `~/.claude/skills/` | Claude Code (all projects) | `/skillname` |
| Claude Code project-level | `.claude/skills/` | Claude Code (this repo) | `/skillname` |
| Codex user-level | `~/.codex/skills/` | Codex (all projects) | `@skillname` |
| Codex project-level | `.agents/skills/` | Codex (this repo) | `@skillname` |
| Gemini user-level | `~/.gemini/skills/` | Gemini (all projects) | by name/description |
| Gemini project-level | `.gemini/skills/` | Gemini (this repo) | by name/description |

Some skills exist across tiers (independent copies, adapted per agent). Each agent may tune its copy.

**Cross-agent skill adaptation expectations:**
- Claude skills use `Agent` tool dispatch, MCP tool names prefixed `mcp__*`, and `/skillname` invocation
- Codex skills use sequential shell + MCP calls, `@plugin` format, and handle no parallel-agent dispatch
- Gemini skills are similar to Codex but note: no `chrome-devtools`, use `/rewind`, `1M context window`

### Step 1: Inventory all skill copies

```bash
# Claude Code user-level
ls ~/.claude/skills/

# Claude Code project-level
ls .claude/skills/ 2>/dev/null

# Codex user-level
ls ~/.codex/skills/

# Codex project-level
ls .agents/skills/ 2>/dev/null

# Gemini user-level
ls ~/.gemini/skills/

# Gemini project-level
ls .gemini/skills/ 2>/dev/null
```

### Step 2: Compare skill copies for drift

For each skill that exists in multiple tiers, compare:

```bash
diff ~/.claude/skills/<name>/SKILL.md ~/.codex/skills/<name>/SKILL.md
diff ~/.claude/skills/<name>/SKILL.md ~/.gemini/skills/<name>/SKILL.md
diff ~/.codex/skills/<name>/SKILL.md ~/.gemini/skills/<name>/SKILL.md
```

### Step 3: Report drift

```text
Skill: prime
  ~/.claude/skills/:  310 lines, modified 2026-03-09
  ~/.codex/skills/:   200 lines, modified 2026-03-09  [adapted — no Agent dispatch]
  ~/.gemini/skills/:  210 lines, modified 2026-03-09  [adapted — adds /rewind]
  Drift: intentional adaptation (expected)

Skill: linear
  ~/.claude/skills/:  N/A
  ~/.codex/skills/:   150 lines, modified 2026-02-18
  ~/.gemini/skills/:  N/A
  Status: Codex-only — consider creating Gemini version
```

### Step 4: Reconcile

For each skill with unintended drift, present diffs and ask:

1. **Claude Code → Codex/Gemini**: Update adapted copies with new logic
2. **Codex/Gemini → Claude Code**: Update user-level copy with improvements
3. **Manual merge**: Show side-by-side for complex changes
4. **Skip**: Intentional divergence (note why)

**Expected divergences** (do not flag):
- `Agent` tool dispatch → sequential MCP calls (Claude → Codex/Gemini)
- `/skillname` → `@skillname` (Claude → Codex)
- Path references (`~/.claude/skills/` vs `~/.codex/skills/` etc.)
- Gemini-specific sections (`/rewind`, `/memory reload`, hooks)
- Codex-specific sections (`codex resume <ID>`, `config.toml`)

### Step 5: Verify utility scripts

If any skill has utility scripts (e.g., seed-sync `update-today.py`), check all copies are identical.

## Phase 5.5: MCP Server Sync (when `.mcp.json` changes)

When a new MCP server is added or removed, sync the change to all agent config files.
All three config files live **outside the repo** (never in git) — they contain real secrets.

### Config file locations

| File | Agent | Format | Location |
|------|-------|--------|----------|
| `.mcp.json` | Claude Code | JSON + keychain | `/path/to/StakTrakr/.mcp.json` (gitignored) |
| `settings.json` | Gemini CLI | JSON + keychain | `~/.gemini/settings.json` |
| `config.toml` | Codex CLI | TOML + keychain | `~/.codex/config.toml` |

All three use macOS keychain (`security find-generic-password -s HexTrackr -a KEY -w`) for secrets.
Servers without real secrets (e.g., `firecrawl-local`) use literal values directly.

### Rules

- **All three configs stay in sync** — if a server is in `.mcp.json`, it should be in the other two.
- **Keychain pattern** is consistent across all three: `bash -c "KEY=$(security ...) npx ..."`
- **Local-only servers**: Include with a comment noting the Docker prerequisite.
- **Claude-specific servers**: `chrome-devtools` and `code-graph-context` are fine in Codex/Gemini
  too if the user wants them; otherwise skip.
- **GEMINI.md MCP section**: Add a usage block when adding a new server (tools, when, prerequisites).
- **AGENTS.md MCP table**: Add a row to the "MCP Servers Available" table.
- **Back up all three** in the secrets tier after any change (see Phase 6 Tier 2).

### When a server is added — checklist

- [ ] `StakTrakr/.mcp.json` — Claude Code config (gitignored)
- [ ] `~/.gemini/settings.json` — Gemini CLI config
- [ ] `~/.codex/config.toml` — Codex CLI config
- [ ] `GEMINI.md` (project) — add MCP usage block under `## MCP Server Usage`
- [ ] `~/.gemini/GEMINI.md` (global) — update MCP server table
- [ ] `AGENTS.md` (project) — add row to MCP server table
- [ ] `~/.codex/AGENTS.md` (global) — update MCP server table
- [ ] Refresh secrets backup: `zip -j ~/.claude/backups/staktrakr-secrets-$(date +%Y-%m-%d).zip StakTrakr/.mcp.json ~/.gemini/settings.json ~/.codex/config.toml`

## Phase 6: Backup — Two Tiers, Two Destinations

Backups split by sensitivity. Run both after any sync.

### Tier 1 — Non-secret config → `devops/claude-backup/` (tracked in git, syncs to GitHub)

Contains: CLAUDE.md + local-only skills. No secrets, safe to commit.

```bash
zip -r devops/claude-backup/claude-local-$(date +%Y-%m-%d).zip \
  CLAUDE.md \
  .claude/skills/bb-test/ \
  .claude/skills/smoke-test/ \
  .claude/skills/ui-mockup/
git add devops/claude-backup/
```

Include in the sync commit. `.gitignore` has a `!devops/claude-backup/` exception so this folder
is tracked in GitHub despite `devops/*` being ignored. Old dated zips can be kept or pruned.

### Tier 2 — Secrets → `~/.claude/backups/` (local only, never in git)

Contains: `.mcp.json` (API keys, tokens). Never commit this anywhere.

```bash
zip -j ~/.claude/backups/staktrakr-secrets-$(date +%Y-%m-%d).zip \
  /path/to/StakTrakr/.mcp.json
```

(`-j` strips the path so only the filename is stored in the zip.)

`~/.claude/backups/` lives outside the repo — git never sees it. Back it up via Time Machine or
your own encrypted offsite method. Do NOT put `.mcp.json` in `devops/claude-backup/`.
