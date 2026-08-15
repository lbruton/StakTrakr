---
paths:
  - "**"
---

# Worktree Sessions — Bash cwd Is Not Trustworthy

The shell's working directory does **not** reliably persist across Bash calls.
Background tasks (`run_in_background`) execute in detached shells, and the
foreground shell is recycled around them and around long-running commands
(multi-minute test suites). A recycled shell re-initializes to the **main
checkout root**, not to wherever the last `cd` left it — and because the main
checkout and the worktree are near-identical trees, every command still
succeeds. It just runs against the wrong code.

This is a consequence of the repo's `EnterWorktree` denial (it cannot express
an `origin/dev` base): the harness-level cwd pinning is unavailable, so cwd is
ephemeral shell state. The denial is correct — a `main`-based worktree silently
drops every commit on `dev` — this rule covers the cost it leaves behind.

## Rules

- **Never rely on a `cd` from an earlier Bash call.** Every gate, test, git,
  or script command targeting the worktree must carry its own anchoring in the
  same compound command: `cd /path/to/.worktrees/<name> && <command>`, or
  `git -C /path/to/.worktrees/<name> <subcommand>`, or absolute file paths
  throughout.
- **Re-anchor after any background task or long-running command.** Those are
  the known recycle points. A bare `pwd &&` prefix is cheap verification.
- **A green test run proves nothing until the count matches.** The wrong-tree
  failure mode is a passing run with a _different test count_ — e.g. 663 vs
  684 unit, 599 vs 601 core, exactly the delta of tests that exist only in the
  worktree. Compare the count against the session's known inventory before
  trusting any green. An odd count is a wrong-tree signal, not noise.
- **Scripts that resolve paths relative to themselves** (e.g.
  `update-spot-bundle.py`) must be invoked from the **worktree's own copy**, or
  they write into the main checkout regardless of cwd.

Precedent: bit twice in the STRK-342 session (2026-08-15) — one full gate run
(unit + core Playwright) silently executed against the main checkout and
reported green; the count delta was the only tell. Earlier precedent: the
STRK-327/328 era false green documented in the same-named mem0 lesson.

If this rule proves insufficient, the escalation path is a PreToolUse hook
comparing `pwd` against an expected-worktree marker — discuss before building.
