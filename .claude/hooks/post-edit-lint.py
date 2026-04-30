#!/usr/bin/env python3
"""
Post-Edit Lint Hook — StakTrakr

Runs after Edit or Write tool calls.
- .js files: node --check (syntax) + ESLint
- .md files: markdownlint
- .json files: JSON syntax validation

Exit codes:
  0 = always (non-blocking feedback only)
"""

import json
import os
import subprocess
import sys

PROJECT_DIR = "/Volumes/DATA/GitHub/StakTrakr"


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
        output = (result.stderr.strip() or result.stdout.strip())
        lines = output.split("\n")[:10]
        return result.returncode, "\n".join(lines)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return 0, ""


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path or not os.path.isfile(file_path):
        sys.exit(0)

    basename = os.path.basename(file_path)
    errors = []

    if file_path.endswith(".js"):
        # Syntax check
        rc, out = run_cmd(["node", "--check", file_path], timeout=10)
        if rc != 0:
            errors.append(f"SYNTAX ERROR in {basename}:\n{out}")
        # ESLint
        rc, out = run_cmd(
            ["npx", "eslint", "--no-warn-ignored", file_path], timeout=15
        )
        if rc != 0 and out:
            errors.append(f"ESLint ({basename}):\n{out}")

    elif file_path.endswith(".md"):
        rc, out = run_cmd(
            ["npx", "markdownlint", "--config", ".markdownlint.json", file_path],
            timeout=15,
        )
        if rc != 0 and out:
            errors.append(f"Markdownlint ({basename}):\n{out}")

    elif file_path.endswith(".json"):
        try:
            with open(file_path) as f:
                json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"JSON SYNTAX ERROR in {basename}: {e}")

    if errors:
        print("[lint] " + "\n[lint] ".join(errors), file=sys.stdout)

    sys.exit(0)


if __name__ == "__main__":
    main()
