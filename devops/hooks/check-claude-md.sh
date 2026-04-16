#!/usr/bin/env bash
# Verify CLAUDE.md exists. It is gitignored but must be present locally.
# Restore with: git show 494271bd:CLAUDE.md > CLAUDE.md
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ ! -f "${REPO_ROOT}/CLAUDE.md" ]; then
  echo "ERROR: CLAUDE.md is missing." >&2
  echo "  Restore: git show 494271bd:CLAUDE.md > CLAUDE.md" >&2
  exit 1
fi
