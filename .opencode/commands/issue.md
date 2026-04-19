---
description: "Vault-based issue management — create, read, update, list issues in DocVault. Usage: /issue create 'title' or /issue STAK-123"
---

Manage vault-based issues in DocVault.

## Detect project

```bash
cat .claude/project.json 2>/dev/null
```

Extract `issuePrefix` and `issueTag`.

## Operations

### Create: `/issue create "title"`

1. Read counter from `DocVault/Projects/{project}/Issues/_counter.md`
2. Write issue file with full YAML frontmatter (id, title, project, type, scope, status, priority, tags)
3. Increment counter
4. CRITICAL: `id` and dates MUST be quoted in YAML (`id: "STAK-544"` not `id: STAK-544`)
5. Tags MUST include `issue` as first tag

### Read: `/issue STAK-123`

Read from `DocVault/Projects/{project}/Issues/{ID}.md` (check Closed/ if not found)

### Update: `/issue STAK-123 status=done`

Edit frontmatter, update `updated` date. If done/canceled, move to Closed/

### List: `/issue list`

```bash
grep -rl 'status:.*\(backlog\|todo\|in-progress\)' DocVault/Projects/{project}/Issues/ | grep -v _Index | head -20
```

## Request

$ARGUMENTS
