#!/usr/bin/env python3
# library-version: 8aa34eb2c2cf
"""PreToolUse hook: report Vale alerts on the lines a `git commit` adds.

Alerts go out as additionalContext; the commit is never blocked. The repo's .vale.ini decides
which files are linted. Old lines are left out, so an existing backlog stays quiet.
A repo without .vale.ini, or a machine without vale, is a quiet no-op.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import sys

TIMEOUT = 15
MAX_ALERTS = 30
SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\n")
HUNK = re.compile(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@")


def run(cmd, cwd):
    """Run a command and return stdout, or None when it fails."""
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=TIMEOUT)
    except (subprocess.TimeoutExpired, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


def find_commit(command, cwd):
    """Return (directory, all_flag) for the first `git commit` in a shell command, or None."""
    here = cwd
    for segment in SEGMENT_SPLIT.split(command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        if len(words) >= 2 and words[0] == "cd":
            here = os.path.join(here, os.path.expanduser(words[1]))
            continue
        if not words or words[0] != "git":
            continue
        where, i = here, 1
        while i < len(words) and words[i].startswith("-"):
            if words[i] == "-C" and i + 1 < len(words):
                where = os.path.join(where, os.path.expanduser(words[i + 1]))
                i += 2
            elif words[i] == "-c":
                i += 2
            else:
                i += 1
        if i < len(words) and words[i] == "commit":
            args = words[i + 1:]
            all_flag = any(a == "--all" or re.fullmatch(r"-[a-zA-Z]*a[a-zA-Z]*", a) for a in args)
            return where, all_flag
    return None


def added_lines(root, base):
    """Map each changed file to the set of line numbers the commit adds."""
    # quotePath off keeps non-ASCII names literal; git ends a name holding a space with a tab.
    diff = run(["git", "-c", "core.quotePath=false", "diff", *base, "-U0", "--no-color",
                "--no-ext-diff", "--diff-filter=ACMR"], root)
    lines, path = {}, None
    for line in (diff or "").splitlines():
        if line.startswith("+++ "):
            target = line[4:].rstrip("\t")
            path = target[2:] if target.startswith("b/") else None
            if path:
                lines.setdefault(path, set())
        elif path and (m := HUNK.match(line)):
            start, count = int(m.group(1)), int(m.group(2) or 1)
            lines[path].update(range(start, start + count))
    return {p: n for p, n in lines.items() if n}


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    command = (data.get("tool_input") or {}).get("command") or ""
    found = find_commit(command, data.get("cwd") or os.getcwd())
    vale = shutil.which("vale")
    if not found or not vale or not os.path.isdir(found[0]):
        sys.exit(0)

    top = run(["git", "rev-parse", "--show-toplevel"], found[0])
    root = top.strip() if top else None
    if not root or not os.path.isfile(os.path.join(root, ".vale.ini")):
        sys.exit(0)

    changed = added_lines(root, ["HEAD"] if found[1] else ["--cached"])
    files = [p for p in changed if os.path.isfile(os.path.join(root, p))]
    if not files:
        sys.exit(0)
    report = run([vale, "--output=JSON", "--no-exit", *files], root)
    try:
        results = json.loads(report or "{}")
    except json.JSONDecodeError:
        sys.exit(0)

    alerts = []
    for path, items in results.items():
        rel = os.path.relpath(os.path.join(root, path), root)
        for a in items:
            if a.get("Line") in changed.get(rel, ()):
                alerts.append(f"{rel}:{a['Line']} [{a.get('Check')}] {a.get('Message')}")
    if not alerts:
        sys.exit(0)

    alerts.sort()
    shown = alerts[:MAX_ALERTS]
    more = len(alerts) - len(shown)
    text = (
        f"Vale: {len(alerts)} alert(s) on lines this commit adds. The commit goes ahead. "
        "Fix them in a follow-up commit before you push; the rules are in prose-core.\n"
        + "\n".join(shown)
        + (f"\n... and {more} more (run `vale` on the files)" if more else "")
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": text}}))
    sys.exit(0)


if __name__ == "__main__":
    main()
