#!/usr/bin/env python3
"""
Post-Edit Lint Hook — StakTrakr

Single script for both harnesses (DEVS-90):
- Claude Code: PostToolUse on Edit/Write, file in tool_input.file_path
- Codex: PostToolUse on apply_patch, patch text in tool_input.command;
  paths in the patch are relative to the payload's cwd

Checks each edited file inside the repo:
- .js files: node --check (syntax) + ESLint
- .md files: markdownlint-cli (same tool and config as pre-commit)
- .json files: JSON syntax validation

Both harnesses drop plain stdout from PostToolUse hooks, so findings are
emitted as hookSpecificOutput.additionalContext JSON. Clean edits print
nothing. Always exits 0 (non-blocking feedback only).
"""

import json
import os
import re
import subprocess
import sys

# .claude/hooks/post-edit-lint.py -> repo root, so worktrees lint with their own tree
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

PATCH_PATH_RE = re.compile(r"^\*\*\* (?:Add File|Update File|Move to): (.+)$")


def run_cmd(cmd, timeout=15):
    """Run a command and return (returncode, output). Never raises."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=PROJECT_DIR,
        )
        output = result.stdout.strip() or result.stderr.strip()
        lines = output.split("\n")[:10]
        return result.returncode, "\n".join(lines)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0, ""


def edited_files(tool_name, tool_input, cwd):
    """Absolute paths of files the tool call wrote."""
    if tool_name in ("Edit", "Write", "MultiEdit"):
        path = tool_input.get("file_path", "")
        return [path] if path else []
    if tool_name == "apply_patch":
        patch = tool_input.get("command", "")
        if isinstance(patch, list):
            patch = "\n".join(patch)
        paths = []
        lines = patch.splitlines()
        for i, line in enumerate(lines):
            m = PATCH_PATH_RE.match(line.strip())
            if not m:
                continue
            # An Update followed by Move to only exists at the destination
            if line.startswith("*** Update File:") and i + 1 < len(lines) and lines[i + 1].startswith("*** Move to:"):
                continue
            paths.append(os.path.join(cwd, m.group(1).strip()))
        return paths
    return []


def in_repo(path):
    real = os.path.realpath(path)
    return real.startswith(PROJECT_DIR + os.sep)


def lint_file(file_path):
    """Return a list of finding strings for one file."""
    basename = os.path.basename(file_path)
    rel = os.path.relpath(os.path.realpath(file_path), PROJECT_DIR)
    errors = []

    if file_path.endswith(".js"):
        rc, out = run_cmd(["node", "--check", file_path], timeout=10)
        if rc != 0:
            errors.append(f"SYNTAX ERROR in {basename}:\n{out}")
        else:
            rc, out = run_cmd(["npx", "--no-install", "eslint", "--no-warn-ignored", rel], timeout=20)
            if rc != 0 and out:
                errors.append(f"ESLint ({rel}):\n{out}")

    elif file_path.endswith(".md"):
        rc, out = run_cmd(
            [
                "npx", "--yes", "markdownlint-cli",
                "--config", ".markdownlint.json",
                "--ignore-path", ".markdownlintignore",
                rel,
            ],
            timeout=30,
        )
        if rc != 0 and out:
            errors.append(f"Markdownlint ({rel}):\n{out}")

    elif file_path.endswith(".json"):
        try:
            with open(file_path) as f:
                json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"JSON SYNTAX ERROR in {basename}: {e}")

    return errors


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    if not isinstance(input_data, dict):
        sys.exit(0)

    tool_input = input_data.get("tool_input") or {}
    cwd = input_data.get("cwd") or os.getcwd()
    files = edited_files(input_data.get("tool_name", ""), tool_input, cwd)

    errors = []
    for path in dict.fromkeys(files):
        if os.path.isfile(path) and in_repo(path):
            errors.extend(lint_file(path))

    if errors:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": "[lint] " + "\n[lint] ".join(errors),
            }
        }))

    sys.exit(0)


if __name__ == "__main__":
    main()
