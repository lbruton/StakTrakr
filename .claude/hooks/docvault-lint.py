#!/usr/bin/env python3
# library-version: ce6718eb297b
"""Post-edit lint hook for DocVault vaults — markdownlint + frontmatter + wikilink checks.

DEVS-78: any `*/DocVault/**` file is a vault page (project vaults in each repo, the shared
vault at Devops/DocVault). markdownlint runs from that vault's root so its own
.markdownlint.jsonc applies; the shared vault's config is the fallback.

DEVS-75: findings go out as PostToolUse additionalContext (plain stdout never
reached the model), only real error lines are kept (the old 10-line cap was
mostly the cli2 banner), and generated Reports/ pages skip markdownlint.

DEVS-135: deployed per code repo by skills-deploy (master: Devops/skill-library/hooks). No user-level
paths: the GitHub root is the folder holding this repo ($CLAUDE_PROJECT_DIR, worktrees resolved to their
main checkout). Paths outside any */DocVault/ are a quiet no-op.
"""

import json
import os
import re
import subprocess
import sys


def _github_root():
    project = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    return os.path.dirname(os.path.realpath(project).split("/.worktrees/")[0])


GITHUB_ROOT = os.environ.get("GITHUB_ROOT") or _github_root()
SHARED_VAULT = os.environ.get("DOCVAULT_SHARED", f"{GITHUB_ROOT}/Devops/DocVault")
ARCHIVE_VAULT = f"{GITHUB_ROOT}/DocVault"
TIMEOUT = 15

REQUIRED_FRONTMATTER_KEYS = ("tags", "created", "updated")
# Keys that MUST be quoted for Obsidian Bases compatibility
QUOTE_REQUIRED_KEYS = ("id", "created", "updated", "date")
# Links into the frozen central archive (removed from disk after DEVS-88) go dead.
RAW_VAULT_PATH = re.compile(re.escape(ARCHIVE_VAULT) + r"/[^\s)`\"']+\.(?:md|canvas)")


def vault_root(file_path):
    """Return the enclosing */DocVault root for a path, or None."""
    i = file_path.find("/DocVault/")
    return file_path[: i + len("/DocVault")] if i != -1 else None


def check_frontmatter_and_links(file_path):
    """Return a list of warning strings for frontmatter/wikilink issues."""
    warnings = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except (OSError, UnicodeDecodeError):
        return warnings

    # Frontmatter checks
    if content.startswith("---\n"):
        end = content.find("\n---", 4)
        if end != -1:
            fm = content[4:end]
            fm_lines = fm.splitlines()
            fm_keys = {
                line.split(":", 1)[0].strip()
                for line in fm_lines
                if ":" in line and not line.startswith(" ")
            }
            missing = [k for k in REQUIRED_FRONTMATTER_KEYS if k not in fm_keys]
            if missing:
                warnings.append(f"frontmatter missing: {', '.join(missing)}")
            # Bases-compat quote check
            for line in fm_lines:
                m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$", line)
                if not m:
                    continue
                key, val = m.group(1), m.group(2).strip()
                if key in QUOTE_REQUIRED_KEYS and val and val[0] not in ("'", '"', "["):
                    warnings.append(f"frontmatter `{key}` unquoted (Bases compat): {val}")
    else:
        warnings.append("missing YAML frontmatter")

    # Raw vault path check (body only — skip frontmatter)
    body = content
    if content.startswith("---\n"):
        end = content.find("\n---", 4)
        if end != -1:
            body = content[end + 4 :]
    for match in RAW_VAULT_PATH.findall(body)[:3]:
        warnings.append(f"link into frozen central DocVault (archived, DEVS-78): {match}")

    return warnings


def run_cmd(cmd, cwd, limit_lines=10):
    """Run a command, return (returncode, output limited to N lines)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
            cwd=cwd,
        )
        output = (result.stdout + result.stderr).strip()
        if output:
            lines = output.splitlines()[:limit_lines]
            return result.returncode, "\n".join(lines)
        return result.returncode, ""
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return 0, ""


def main():
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    if tool_name not in ("Edit", "Write"):
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    if not file_path or not os.path.isfile(file_path):
        sys.exit(0)

    findings = []
    base = os.path.basename(file_path)
    root = vault_root(file_path)
    in_vault = root is not None

    if file_path.endswith(".md") and in_vault:
        # Only vault files — project-level hooks lint their own .md.
        # Generated report pages are rewritten nightly; linting them is noise.
        if "/Reports/" not in file_path[len(root):] and "/Templates/" not in file_path[len(root):]:
            cmd = ["npx", "markdownlint-cli2"]
            shared_cfg = os.path.join(SHARED_VAULT, ".markdownlint.jsonc")
            if not os.path.isfile(os.path.join(root, ".markdownlint.jsonc")) and os.path.isfile(shared_cfg):
                cmd += ["--config", shared_cfg]
            rc, output = run_cmd(cmd + [":" + os.path.relpath(file_path, root)], cwd=root, limit_lines=200)
            if rc != 0 and output:
                errors = [ln for ln in output.splitlines() if " error " in ln or " MD0" in ln][:10]
                if errors:
                    findings.append(f"[lint] markdownlint {base}:\n" + "\n".join(errors))

        # Frontmatter + raw-path checks (skip index files and generated digests)
        if ("/.obsidian/" not in file_path and "/Templates/" not in file_path
                and base != "INDEX.md" and not base.startswith("_")):
            for w in check_frontmatter_and_links(file_path):
                findings.append(f"[vault] {base}: {w}")

    if findings:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": "\n".join(findings),
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
