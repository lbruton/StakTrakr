#!/usr/bin/env python3
# library-version: 8cb423b84b38
"""PostToolUse hook: report Vale alerts on the lines a `git commit` added.

It lints a snapshot of HEAD, so the text and line numbers match the commit, whatever the
working tree holds. Alerts go out as additionalContext. The repo's .vale.ini decides which
files are linted, and old lines are left out. Without .vale.ini or vale it is a quiet no-op.
"""

import io
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

TIMEOUT = 15
MAX_ALERTS = 30
# A quiet commit prints nothing; a HEAD this recent (seconds) is taken as its result.
RECENT = 300
SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\n")
HUNK = re.compile(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@")
COMMIT_LINE = re.compile(r"^\[[^\]\n]*?\b([0-9a-f]{7,40})\]", re.M)
STYLES_PATH = re.compile(r"^\s*StylesPath\s*=\s*(.+?)\s*$", re.M)


def run(cmd, cwd, text=True):
    """Run a command and return stdout, or None when it fails."""
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=text, timeout=TIMEOUT)
    except (subprocess.TimeoutExpired, OSError):
        return None
    return result.stdout if result.returncode == 0 else None


def find_commit(command, cwd):
    """Return the directory of the first `git commit` in a shell command, or None."""
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
            return where
    return None


def committed_now(root, stdout):
    """True when HEAD is the commit this command made, judged from its output."""
    head = (run(["git", "rev-parse", "HEAD"], root) or "").strip()
    if not head:
        return False
    shas = COMMIT_LINE.findall(stdout)
    if shas:
        return any(head.startswith(s) for s in shas)
    if stdout.strip():
        return False
    stamp = (run(["git", "log", "-1", "--format=%ct"], root) or "").strip()
    return stamp.isdigit() and time.time() - int(stamp) < RECENT


def added_lines(root):
    """Map each file HEAD changed to the set of line numbers it added."""
    # quotePath off keeps non-ASCII names literal; git ends a name holding a space with a tab.
    diff = run(["git", "-c", "core.quotePath=false", "show", "--format=", "-U0", "--no-color",
                "--no-ext-diff", "--diff-filter=ACMR", "HEAD"], root)
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


def snapshot(root, files, dest):
    """Write HEAD's copy of files plus the working-tree Vale config into dest."""
    data = run(["git", "archive", "--format=tar", "HEAD", "--", *files], root, text=False)
    if data is None:
        return False
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        try:
            tar.extractall(dest, filter="data")
        except TypeError:
            tar.extractall(dest)
    config = os.path.join(root, ".vale.ini")
    shutil.copy(config, dest)
    with open(config, encoding="utf-8") as f:
        m = STYLES_PATH.search(f.read())
    styles = m.group(1) if m else ""
    if styles and not os.path.isabs(styles) and os.path.isdir(os.path.join(root, styles)):
        shutil.copytree(os.path.join(root, styles), os.path.join(dest, styles), dirs_exist_ok=True)
    return True


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    command = (data.get("tool_input") or {}).get("command") or ""
    where = find_commit(command, data.get("cwd") or os.getcwd())
    vale = shutil.which("vale")
    if not where or not vale or not os.path.isdir(where):
        sys.exit(0)

    top = run(["git", "rev-parse", "--show-toplevel"], where)
    root = top.strip() if top else None
    if not root or not os.path.isfile(os.path.join(root, ".vale.ini")):
        sys.exit(0)
    response = data.get("tool_response")
    stdout = response.get("stdout") or "" if isinstance(response, dict) else str(response or "")
    if not committed_now(root, stdout):
        sys.exit(0)
    parents = (run(["git", "rev-list", "--parents", "-n", "1", "HEAD"], root) or "").split()
    if len(parents) > 2:
        sys.exit(0)

    changed = added_lines(root)
    if not changed:
        sys.exit(0)
    with tempfile.TemporaryDirectory() as tmp:
        if not snapshot(root, list(changed), tmp):
            sys.exit(0)
        report = run([vale, "--output=JSON", "--no-exit", *changed], tmp)
    try:
        results = json.loads(report or "{}")
    except json.JSONDecodeError:
        sys.exit(0)

    alerts = []
    for path, items in results.items():
        for a in items:
            if a.get("Line") in changed.get(os.path.normpath(path), ()):
                alerts.append(f"{os.path.normpath(path)}:{a['Line']} [{a.get('Check')}] {a.get('Message')}")
    if not alerts:
        sys.exit(0)

    alerts.sort()
    shown = alerts[:MAX_ALERTS]
    more = len(alerts) - len(shown)
    text = (
        f"Vale: {len(alerts)} alert(s) on lines this commit added. "
        "Fix them in a follow-up commit before you push; the rules are in prose-core.\n"
        + "\n".join(shown)
        + (f"\n... and {more} more (run `vale` on the files)" if more else "")
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": text}}))
    sys.exit(0)


if __name__ == "__main__":
    main()
