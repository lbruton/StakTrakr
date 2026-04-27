#!/usr/bin/env bash
# Verify CLAUDE.md exists. It is tracked by git and must survive worktree operations.
# Restore with: git restore CLAUDE.md
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ ! -f "${REPO_ROOT}/CLAUDE.md" ]; then
  echo "ERROR: CLAUDE.md is missing." >&2
  echo "  Restore: git restore CLAUDE.md" >&2
  exit 1
fi
