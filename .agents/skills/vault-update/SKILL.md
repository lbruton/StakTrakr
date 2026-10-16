---
name: vault-update
description: >
  Update DocVault documentation after a change: the project's in-repo vault
  (<repo>/DocVault/, rides the current branch and PR) or the shared cross-project vault
  (Devops/DocVault/, commits directly to Devops main). Use when infrastructure changes,
  architecture decisions are made, or project docs need updating. Triggers on: "update vault",
  "vault update", "docvault", "update docs", "add to vault", "vault"
user-invocable: true
library-version: 7715fae9935f
---

# Vault Update

Since DEVS-78 (2026-09-28), docs are split across three vaults. There is no central repo to commit to anymore. The old `lbruton/DocVault` is a frozen archive.

## Vault locations

Resolve paths with `vault-path` (installed at `~/.local/bin/vault-path`, source `Devops/scripts/vault-path.sh`):

| Vault | Path | Holds | How edits land |
| --- | --- | --- | --- |
| **Project** | `PROJECT_VAULT=$(vault-path project)`, i.e. `<repo>/DocVault/` | Overview, `specs/`, Research, Runbooks, curated pages for this project | Edit inside the **current worktree**. The change rides the feature branch and PR. No separate commit or push. |
| **Shared** | `SHARED_VAULT=$(vault-path shared)`, usually `/Volumes/DATA/GitHub/Devops/DocVault/` | KnowledgeBase (Infrastructure, Architecture, Skill/Agent Matrix), Runbooks, cross-project Research, Clippings, Reports | Commit **directly to Devops `main`**, paths under `DocVault/` only. |
| **Private companion** | `$(vault-path private)`, i.e. `$SHARED_VAULT/Projects/<name>/` | Anything from a **public** repo that can't be public: LAN IPs, internal hostnames, security reviews, dated audit/sweep/drift reports | Same as shared. |

`vault-path project` exits 2 when the repo has no `DocVault/` yet. Scaffold it from `$SHARED_VAULT/Templates/project-vault/README.md`.

## Which vault?

1. **Infrastructure, homelab, or anything cross-project** → shared (`KnowledgeBase/Infrastructure/` for hosts, stacks, IPs).
2. **Project page with no sensitive detail** → project vault.
3. **Project page that mentions LAN IPs, internal hosts, credentials locations or security findings, and the repo is public** → private companion. Link to it from the public page by path; never copy it.

Check visibility when unsure: `gh repo view --json visibility -q .visibility`. Private repos (HomeNetwork, Devops) can take everything in their project vault.

## How to update

### Step 1: Find the page

Grep the right vault (`output_mode="files_with_matches"`), e.g. `path="$SHARED_VAULT/KnowledgeBase/Infrastructure/"` or `path="$PROJECT_VAULT"`. For semantic search: `mcp__claude-context__search_code(path="<vault path>", query="<topic>")`.

### Step 2: Edit

- Update `updated:` in the frontmatter (quoted date).
- Link within the same vault with `[[wikilinks]]`. Link to another vault with a markdown link to the absolute path.
- Keep notes atomic: one system or concept per note.

New notes follow this pattern:

```markdown
---
tags: [relevant-tag]
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
---

# Title

Content with [[wikilinks]] to related notes.
```

### Step 3: Update the folder index

Every folder has a `FolderName.md` index (e.g. `KnowledgeBase/Infrastructure/Infrastructure.md`). Add or update the entry with a one-line summary, keeping entries sorted. A new top-level folder also goes in the vault's root index (`INDEX.md` in the shared vault, `Overview.md` in a project vault).

### Step 4: Land it

**Project vault:** nothing extra. Stage it with the rest of the branch's changes (`git add DocVault/...`). It merges with the PR. Never edit the project vault on a main checkout that has a branch policy; use the worktree.

**Shared vault / private companion:**

```bash
D="$(dirname "$(vault-path shared)")"        # Devops repo root
git -C "$D" pull --rebase --autostash origin main
git -C "$D" add DocVault/
git -C "$D" commit -m "docs: <what changed>" -- DocVault/
git -C "$D" push origin main
```

Only paths under `DocVault/` go direct to `main`. Any other Devops change needs a worktree and PR.

## Rules

- **Never delete vault content without asking.** Other notes may link to it.
- **Keep secrets out.** Reference Infisical, and never paste tokens or passwords.
- **Public repos are public.** When in doubt, use the private companion.
- Agent-facing foundation docs (architecture, coding standards, infrastructure facts about the code) go in `.context/`, not the vault.
- The frozen archive (`vault-path archive`) is read-only. Never write to it.
