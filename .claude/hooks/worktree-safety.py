#!/usr/bin/env python3
# library-version: 04dbfc6b5d14
"""PreToolUse hook — warns when an Edit/Write targets a file outside the active worktree.

Catches the common mistake of editing files in the main repo checkout when
a worktree branch is active, or editing files in a different worktree.

Non-blocking: returns warnings as additionalContext (plain stdout from
PreToolUse never reaches the model) and exits 0.

Exempt (DEVS-75 audit — all false positives): version.lock (lives in the main
root by design for /release) and anything under a .claude/ directory.

DEVS-135: deployed per code repo by skills-deploy (master: Devops/skill-library/hooks).
"""

import json
import os
import subprocess
import sys

EXEMPT_BASENAMES = {"version.lock"}
warnings = []


def warn(msg):
    warnings.append(msg)


def emit_and_exit():
    if warnings:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": "\n".join(warnings),
            }
        }))
    sys.exit(0)


def get_git_toplevel():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def get_git_common_dir():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def get_branch():
    try:
        return subprocess.check_output(
            ["git", "branch", "--show-current"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool = data.get("tool_name", "")
    if tool not in ("Edit", "Write"):
        sys.exit(0)

    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path:
        sys.exit(0)

    file_path = os.path.realpath(file_path)
    if os.path.basename(file_path) in EXEMPT_BASENAMES or "/.claude/" in file_path:
        sys.exit(0)
    toplevel = get_git_toplevel()
    if not toplevel:
        sys.exit(0)

    toplevel = os.path.realpath(toplevel)
    branch = get_branch()

    # Check 1: on a patch/* branch but editing outside the worktree
    if branch.startswith("patch/") and "/.worktrees/" not in toplevel:
        # We're on a patch branch in the main repo — edits should be in a worktree
        if not file_path.startswith(toplevel + "/"):
            sys.exit(0)  # file is outside repo entirely, not our concern
        # Check if a matching worktree exists
        version = branch.replace("patch/", "")
        worktree_path = os.path.join(
            os.path.dirname(toplevel) if "/.worktrees/" in toplevel else toplevel,
            ".worktrees",
            f"patch-{version}",
        )
        if os.path.isdir(worktree_path):
            warn(
                f"[worktree-safety] Editing {os.path.basename(file_path)} in the main repo, "
                f"but worktree .worktrees/patch-{version}/ exists. Expected edits in: {worktree_path}/"
            )

    # Check 2: in a worktree but editing a file in a DIFFERENT worktree or main repo
    if "/.worktrees/" in toplevel:
        if not file_path.startswith(toplevel + "/") and not file_path.startswith(
            toplevel
        ):
            # File is outside our worktree
            # Allow DocVault, global config, and other non-repo paths
            repo_root = toplevel.split("/.worktrees/")[0]
            if file_path.startswith(repo_root + "/") and "/.worktrees/" not in file_path:
                warn(
                    f"[worktree-safety] Editing {os.path.basename(file_path)} in the main repo root "
                    f"({repo_root}/) while working in worktree {toplevel}/. "
                    "Confirm this edit belongs in the main checkout."
                )

    emit_and_exit()


if __name__ == "__main__":
    main()
