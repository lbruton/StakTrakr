---
name: pr-resolve
description: PR resolve — work through open PR review threads and Codacy issues to get a PR approved and merged.
library-version: 04dbfc6b5d14
---

# PR Resolve

Review, reply to, and resolve all PR review comments and CI check failures.

**Orchestration model:** Dispatch `pr-discover` agent for data gathering (returns clustered findings), triage clusters in main context with user approval, dispatch one `pr-thread-resolver` agent per cluster in parallel.

<HARD-GATE>
**Execute through to mergeable state.** Do NOT stop after triage. After user approves classifications, immediately proceed to Phase 3 — fix code, push commits, reply to threads, resolve them. Only stop if the user explicitly says "stop" or "pause".
</HARD-GATE>

<HARD-GATE>
**Green checks are not enough.** A PR is not resolved until unresolved review threads are
at `0`. If checks pass but GitHub reports `mergeStateStatus: BLOCKED`, immediately query
`reviewThreads` and continue the reply/resolve loop before reporting completion. If threads
are also `0` but `reviewDecision` is still `CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED`,
the blocker is a **CodeRabbit pre-merge check** (docstring coverage, title) hidden in a
`coderabbitai[bot]` issue comment — see Phase 4 Step 4. Never report "ready for merge" until
`reviewDecision` is `APPROVED` or `null`.
</HARD-GATE>

<HARD-GATE>
**Owner verification — lbruton only.** Before any PR operations, verify the `origin` remote points to `github.com/lbruton/`. If owner is NOT `lbruton`, STOP immediately and report: "Remote points to {owner}/{repo} — not lbruton. Aborting." Never operate on upstream repos, forks owned by others, or any non-lbruton remote. This gate fires before Phase 0.
</HARD-GATE>

## Arguments

- `<PR number>` — resolve comments on a specific PR (e.g., `/pr-resolve 136`)
- No argument — auto-detect the open PR for the current branch

## Phase 0+1: Discover (delegated to agent)

### Step 1: Identify PR and verify owner

Get owner/repo from the git remote, then **verify owner is `lbruton`** before proceeding:

```bash
# Get owner and repo from git remote
git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/' | awk -F/ '{print "owner="$1, "repo="$2}'
git rev-parse --show-toplevel
cat .claude/project.json 2>/dev/null || echo '{}'
```

**HARD GATE:** If `owner` is anything other than `lbruton`, STOP immediately. Output:

> **Aborted:** Remote `origin` points to `{owner}/{repo}` — not `lbruton`. PR operations only run against `github.com/lbruton/*` repos. Check your remote with `git remote -v`.

Do NOT proceed to Phase 0 Step 2 or any subsequent phase.

Then call `mcp__github__list_pull_requests` with the detected owner/repo to find the open PR for the current branch, or `mcp__github__get_pull_request` if the PR number is known from arguments.

### Step 2: Dispatch pr-discover agent

Use the Agent tool to dispatch `pr-discover` with:

```
Discover all findings for PR #<number>.
- prNumber: <number>
- owner: <owner>
- repo: <repo>
- baseBranch: <base>
- workingDir: <path>

Return the structured discovery report with thread clusters, thread IDs, and comment IDs.
```

### Step 3: Present the discovery report to user

Display the agent's structured findings table, including the Thread Clusters section.

## Phase 1.5: Check Related Issues

If the discovery report identified related issues, note which ones may be unblocked by this PR. Update their descriptions after merge.

## Phase 2: Triage (in main context — needs user interaction)

For each finding (review threads + Codacy + pre-analysis), classify:

| Label | Meaning | Action |
|-------|---------|--------|
| **Resolved** | Already fixed in a subsequent commit | Reply with SHA, resolve |
| **Fix now** | Valid concern, fix immediately | Code fix, commit, reply, resolve |
| **Deferred** | Valid but out of scope | Reply noting deferral + issue, resolve |
| **False positive** | Not applicable or incorrect | Reply with rationale, resolve |
| **Acknowledged** | Valid, addressed differently | Reply explaining alternative, resolve |
| **Won't fix** | Disagree with suggestion | Reply with justification, resolve |
| **Pre-existing** | Codacy flagged untouched code | Note in summary, skip |
| **Skill required** | Fix requires a project skill invocation (e.g., `/update-spot-bundle`, `/release`) | Dispatch to subagent with skill name — subagent invokes via Skill tool, stages output, replies |

### Codacy-specific rules

- **Complexity**: Fix if modified in PR, else Pre-existing
- **Duplication**: Fix if introduced in PR, else Pre-existing
- **Security**: Always Fix now regardless of origin
- **Code style**: Fix if trivial (< 5 min), defer if substantial

### StakTrakr — Known false positives

**Always document the reason, not just the pattern.** If the reasoning no longer applies, treat it as a real finding.

| Tool | Rule / Pattern | Classification | Reply |
|------|---------------|----------------|-------|
| Codacy | `localStorage.getItem/setItem` → "use loadData()/saveData()" | False positive (scalar string preferences) | "False positive — loadData() is async and JSON-serializes values — incorrect for a plain scalar string preference." |
| CodeQL | `js/clear-text-storage-of-sensitive-data` on `apiKey`/`access_token` in localStorage | False positive (user-owned credentials, single-user local app, no server secrets) | "False positive — StakTrakr stores user-entered credentials on the user's own device. No server secrets. Accepted risk per project security model." |
| CodeQL / GH Security | Format string injection on `console.error(\`...\`, err)` | False positive (JS console doesn't do printf substitution) | "False positive — Node.js console.error does not perform %s/%d format substitution. Template literal produces a plain string argument, no injection surface." |
| Codacy | Duplication delta on `js/diff-modal.js` type-dispatch renderers | Deferred | "Deferred to STAK-458 — structural byproduct of type-dispatch renderer pattern. Tracked for refactor." |
| Copilot | `document.getElementById` in `about.js` / `init.js` | False positive | "False positive — startup code in about.js/init.js operates on elements guaranteed to exist at DOM-ready. safeGetElement() exception documented in copilot-instructions.md." |
| Copilot | "undefined variable" for any global | False positive | "False positive — vanilla JS global scope across 67 files, no module bundler. See copilot-instructions.md Section 3." |

### Present classification table (cluster-aware)

Present classifications grouped by cluster so the user can approve per-cluster:

```
Cluster cluster-1 — sw.js (bot, 2 threads)
  T1 — sw.js:163 (copilot) → Resolved — Fixed in 1b95511
  T2 — sw.js:157 (copilot) → Fix now — networkFirst needs error return

Cluster cluster-2 — events.js (bot, 0 threads + 1 Codacy)
  C1 — events.js:245 (Codacy/complexity) → Pre-existing

Cluster cluster-3 — utils.js (human, 1 thread)
  T3 — utils.js:89 (@reviewer) → Fix now — unchecked null

Skill-required (orchestrator, after clusters):
  T4 — general (copilot) → Skill required — /update-spot-bundle

Approve all? [Go / Adjust #N / Skip cluster-N]
```

Wait for user confirmation. **After approval, immediately proceed to Phase 3.**

## Phase 2.5: Jules Suppression Gate (Jules PRs Only)

Fires when PR author is `app/jules-app` or title has Jules prefix.

For any "Won't fix" / "False positive" / "Acknowledged" item:
1. Read `.github/jules-suppressions.json`
2. Add suppression entry with pattern, reason, date
3. Generate prompt exclusion clause
4. Commit the suppression update
5. Close the Jules PR with structured comment

## Phase 3: Execute (cluster-parallel dispatch)

<HARD-GATE>
**Never fix inline.** All clusters with "Fix now" items MUST be dispatched as `pr-thread-resolver` subagents — never executed directly in the main context. Independent clusters (different files) run in parallel; the subagent handles sequential ordering within its cluster.
</HARD-GATE>

### Dispatch rules

1. **Identify independent clusters.** Two clusters are independent if they share no files. Independent clusters dispatch in parallel.
2. **Identify dependent clusters.** If two clusters modify the same file (rare — discovery groups by file), they must run sequentially.
3. **Reply-only clusters.** Clusters with no "Fix now" items (all false-positive, resolved, deferred, etc.) still dispatch as subagents for the GraphQL re-fetch safety, but can run in parallel with everything since they don't edit files.
4. **Skill-required threads dispatch normally.** Subagents have access to all tools including the Skill tool. Include the skill name and any prerequisites in the dispatch prompt. The subagent invokes the skill, stages output files, and reports back like any other fix.

### Dispatch each cluster

For each cluster, dispatch a `pr-thread-resolver` agent with:

```
Resolve cluster <clusterId> for PR #<prNumber>.
- owner: <owner>
- repo: <repo>
- prNumber: <prNumber>
- clusterId: <clusterId>
- clusterFiles: [<file1>, <file2>]

Threads in this cluster:
1. Thread T1:
   - threadId: <graphql_thread_id>
   - commentId: <rest_comment_id>
   - file: <path>
   - line: <line>
   - author: <author>
   - body: <comment body>
   - classification: <Fix now | False positive | Resolved | ...>
   - proposedReply: <reply text from triage>

2. Thread T2:
   ...

Codacy findings on these files:
- C1: <file>:<line> — <category> — classification: <X> — reply: <Y>

Pre-analysis findings on these files:
- A1: <file>:<line> — <category> — classification: <X>

For any "Skill required" threads: invoke the named skill via the Skill tool.
Example: Skill({ skill: "update-spot-bundle" }). Stage the output files after the skill completes.

Previously resolved (path:line) pairs from this session (populate for Phase 4 dispatches; empty for Phase 3 initial dispatch):
- (none — Phase 3 initial dispatch)

IMPORTANT: Re-fetch all thread IDs via GraphQL before acting (Phase 0 in your instructions).
Match threads by (path, line, author, body_prefix) — not by stale IDs.
Use the previously-resolved list above for duplicate detection: if a re-fetched thread's (path, line) appears in that list and the author is an automated bot (`codacy-production[bot]`, `copilot[bot]`, `github-advanced-security[bot]`), classify it as a Duplicate and resolve inline — do not treat as a new finding requiring a code fix.
```

### After all clusters resolve

1. **Check for stale threads.** If any subagent reported `STALE — thread not found`, investigate whether a rebase occurred and re-triage if needed.

2. **Record resolved (path:line) pairs.** Collect every `(file, line)` pair from all cluster reports. Keep this as your session-level resolved-pairs set — you will pass it to any Phase 4 subagents dispatched for net-new threads, and use it yourself for Phase 4 inline duplicate detection.

3. **Commit all fixes:**

```bash
# Stage only files actually touched by the resolution clusters — NEVER `git add -A`
# (broad-add risks committing .env, untracked agent scratch, or unrelated edits).
# Enumerate the file set from the cluster reports and pass them explicitly:
git add path/to/file1 path/to/file2 ...
git commit -m "fix: resolve PR review findings (PR #XX)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin <branch>
```

4. **Post replies and resolve threads.** For each cluster's resolution report, post the reply and resolve the thread:

```bash
# Reply to thread
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments/COMMENT_ID/replies \
  -f body="REPLY_TEXT"

# Resolve thread
gh api graphql -f query='
  mutation {
    resolveReviewThread(input: {threadId: "THREAD_NODE_ID"}) {
      thread { isResolved }
    }
  }'
```

Reply formats:
- **Resolved:** `**Resolved in** \`<SHA>\` — <what changed>`
- **Fixed:** `**Fixed in** \`<SHA>\` — <what changed>`
- **Deferred:** `**Deferred to future patch** — <acknowledgment>. Tracked as [ISSUE](link).`
- **False positive:** `**False positive — no change needed** — <explanation>`
- **Acknowledged:** `**Acknowledged — <alternative>** — <explanation>`
- **Won't fix:** `**Won't fix** — <justification>`

### Codacy summary comment

If Codacy issues were fixed, leave a single summary comment on the PR.

## Phase 4: Verify

<HARD-GATE>
**Inline-first for bot duplicates.** When Phase 4 finds unresolved threads after a push, classify every thread before deciding on dispatch:
- **Duplicate** = author is `codacy-production[bot]`, `copilot[bot]`, or `github-advanced-security[bot]` AND `(path, line)` matches a thread already resolved in Phase 3 or an earlier Phase 4 cycle. → Resolve inline via bash for-loop. No subagent. No new push.
- **Net-new** = different `path:line`, or human reviewer, or substantially different body. → Phase 2 triage → subagent dispatch (pass resolved-pairs list in prompt).
Never dispatch a `pr-thread-resolver` subagent for a cluster that is 100% bot-duplicate threads — subagent dispatch triggers an extra push which re-triggers Codacy, creating a resolution loop.
</HARD-GATE>

### Step 1: Wait for automated re-review

After pushing fixes, Codacy static analysis and CI re-run. Copilot re-reviews only when a repo
ruleset requests it or when you re-request it (`gh pr edit <number> --add-reviewer "@copilot"`).
Re-request Copilot only when the user asks. Wait for the checks before checking thread state.

Use `gh pr checks --watch` (preferred) or a `Bash` `run_in_background` + Monitor loop — **never a `sleep` chain**. The global Action Gates forbid `sleep N` polling in skill bash.

```bash
# Stream check status until all complete; exits non-zero on failure.
gh pr checks <PR_NUMBER> --watch --interval 15
```

When the watch returns, query `mcp__github__get_pull_request_status` (owner, repo, pull_number) once for the final state. If `mergeStateStatus` is `BLOCKED`, do not assume branch protection or review approval is the only blocker — query unresolved review threads next.

### Step 2: Check for new threads

```bash
# Get all unresolved threads with file path and line info
gh api graphql -f query='
{
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes { path line body author { login } }
          }
        }
      }
    }
  }
}'
```

### Step 3: Auto-resolve duplicate threads

When automated reviewers (Codacy, or a re-requested Copilot) re-run after a push, they often regenerate threads on the same file+line that were already resolved. Resolve these inline — **never via subagent dispatch**, as that triggers an extra push and another Codacy re-scan, perpetuating the loop.

**Immediately classify every unresolved thread before taking any action:**

**Duplicate** — ALL of:
1. Author is `codacy-production[bot]`, `copilot[bot]`, or `github-advanced-security[bot]`
2. `(path, line)` matches a thread already resolved in Phase 3 or an earlier Phase 4 cycle
3. Comment body is substantially similar to the previously resolved thread

**Net-new** — any of:
- Different `path:line` from all resolved pairs
- Human reviewer author
- Substantially different comment body (new concern, not a re-post)

**For each duplicate — resolve inline (no subagent, no new push):**
1. Reply: `**Duplicate — already resolved in this review cycle.** See earlier thread on same file/line.`
2. Batch-resolve via bash for-loop:

```bash
for thread in <threadId1> <threadId2> ...; do
  result=$(gh api graphql -f query="mutation { resolveReviewThread(input: {threadId: \"$thread\"}) { thread { isResolved } } }" --jq '.data.resolveReviewThread.thread.isResolved')
  echo "$thread → $result"
done
```

**For net-new threads** (different file/line, or from a human reviewer): loop back to Phase 2 for user triage. When dispatching a subagent for net-new threads, include the full resolved-pairs set in the dispatch prompt (replace the `(none — Phase 3 initial dispatch)` placeholder with the actual list).

```bash
# Check final unresolved count
gh api graphql -f query='
{
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 50) {
        nodes { isResolved }
      }
    }
  }
}' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'

# Check Codacy
gh pr checks PR_NUMBER --json name,state --jq '.[] | select(.name | test("codacy|Codacy"; "i"))'
```

### Step 4: Check CodeRabbit pre-merge checks (invisible blocker)

A PR can have **0 unresolved threads and every status check green** yet still sit at
`reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED`. CodeRabbit pre-merge
checks (75% docstring coverage, title checks, etc.) live in a `coderabbitai[bot]` issue
comment — invisible to `statusCheckRollup`, the status API, and the `reviewThreads` query.
This is the only blocker class Steps 1–3 cannot see.

```bash
# When threads == 0 but the PR still won't merge, read the merge signals:
gh pr view PR_NUMBER --json reviewDecision,mergeStateStatus --jq '{reviewDecision, mergeStateStatus}'

# If CHANGES_REQUESTED / BLOCKED with 0 threads + green checks, read CodeRabbit's panel:
gh api repos/OWNER/REPO/issues/PR_NUMBER/comments \
  --jq 'map(select(.user.login == "coderabbitai[bot]")) | last | .body' \
  | rg -i 'pre-merge|docstring|coverage|❌|⚠️|title'
```

Surface every `❌ Error` row as a finding and fix it — this is code/metadata work, not a reply:

- **Docstring Coverage < 75%** → add JSDoc to new or modified JS functions and a `#` doc
  comment line directly above new or modified shell functions, then commit and push.
- **Title / description checks** → fix the PR title or body via `gh pr edit`.

CodeRabbit's `request_changes_workflow: true` means the standing `CHANGES_REQUESTED` clears
only after a clean **re-review**, which is throttled (~4–8/hr, 5–10 min lag). After pushing
the docstring fix, poll with `gh pr checks PR_NUMBER --watch` and re-read `reviewDecision` —
do not report "ready for merge" until it flips to `APPROVED` (or `null`).

### Final report

```
PR #XX — Resolution Summary
=============================
Clusters dispatched: N (N parallel, N sequential)
Review Threads: Fixed X, Resolved Y, False positive Z, Deferred W
  Stale (re-fetch invalidated): S
Codacy Quality Gate: PASS / PENDING / FAIL
CodeRabbit pre-merge checks: PASS / FAIL (list ❌ rows) / none posted
Commits pushed: [SHAs]
Unresolved threads: 0
reviewDecision: APPROVED / null

Ready for merge.
```

## Important Notes

- **Never resolve without replying.** Every thread needs a reply.
- **Batch fixes into logical commits.** All cluster fixes go into one commit.
- **Don't force-resolve human disagreements.** Flag for user.
- **Security findings are never "pre-existing."** Always fix.
- **Verify Codex PR base branches.** Retarget to dev if targeting main.
- **Stale thread IDs are expected.** The re-fetch in each subagent handles rebases between discovery and execution. If >50% of threads go stale, suspect a force-push and re-run discovery.
