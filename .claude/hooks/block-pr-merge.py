#!/usr/bin/env python3
# library-version: 88accb389051
"""PreToolUse hook: force human approval for any PR merge.

Merging a PR is a human-gated activity. Green CI is NOT authorization.
This hook does not block merges outright — that would also stop merges the
user explicitly directs. Instead it returns permissionDecision="ask", which
forces Claude Code to surface a confirmation prompt to the human before the
merge executes. The user denies it when they did not authorize a merge, and
approves it when they did ("merge it" / "ship it" / "release").

Covers:
  - Bash:  `gh pr merge ...` (including `--auto`, `--admin`, `--squash`, etc.)
  - Bash:  GitHub REST merge endpoint  (PUT .../pulls/<n>/merge)
  - MCP:   mcp__github__merge_pull_request

DEVS-135: deployed per code repo by skills-deploy (master: Devops/skill-library/hooks).
"""
import json
import re
import sys


def ask(reason: str) -> None:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never block on a parse failure

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {}) or {}

    reason = (
        "Merging a PR is human-gated. Green CI is not authorization. "
        "Leave the PR ready-to-merge and confirm the user explicitly asked "
        "to merge in this turn before approving."
    )

    # MCP merge tool — always require approval.
    if tool == "mcp__github__merge_pull_request":
        ask(reason)

    # Bash — inspect the command for merge invocations.
    if tool == "Bash":
        command = tool_input.get("command", "") or ""
        # `gh pr merge ...`  (allow arbitrary whitespace between tokens)
        gh_merge = re.search(r"\bgh\s+pr\s+merge\b", command)
        # REST API merge endpoint: .../pulls/<n>/merge  via gh api / curl
        api_merge = re.search(r"/pulls/\d+/merge\b", command)
        if gh_merge or api_merge:
            ask(reason)

    sys.exit(0)


if __name__ == "__main__":
    main()
