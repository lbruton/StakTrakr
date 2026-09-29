#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

mode="staged"
if [ "${1:-}" = "--changed" ]; then
  mode="changed"
elif [ "${1:-}" = "--staged" ]; then
  mode="staged"
fi

# DocVault/ is the in-repo Obsidian vault (DEVS-78): it has its own conventions and
# .markdownlint.jsonc and is linted by the global docvault-lint hook. markdownlint-cli
# does not apply .markdownlintignore to explicitly passed files, so exclude it here.
VAULT_EXCLUDE=(":(exclude)DocVault/**")

candidate_files=()
append_unique_files() {
  while IFS= read -r file_path; do
    [ -n "$file_path" ] || continue
    local already_seen=false
    if [ "${#candidate_files[@]}" -gt 0 ]; then
      for existing in "${candidate_files[@]}"; do
        if [ "$existing" = "$file_path" ]; then
          already_seen=true
          break
        fi
      done
    fi
    if [ "$already_seen" = false ]; then
      candidate_files+=("$file_path")
    fi
  done
}

if [ "$mode" = "changed" ]; then
  append_unique_files < <(git diff --name-only --diff-filter=ACMRTUXB HEAD -- '*.md' "${VAULT_EXCLUDE[@]}")
  append_unique_files < <(git ls-files --others --exclude-standard -- '*.md' "${VAULT_EXCLUDE[@]}")
else
  append_unique_files < <(git diff --cached --name-only --diff-filter=ACMRTUXB -- '*.md' "${VAULT_EXCLUDE[@]}")
fi

if [ "${#candidate_files[@]}" -eq 0 ]; then
  if [ "$mode" = "changed" ]; then
    echo "No changed Markdown files to lint."
  else
    echo "No staged Markdown files to lint."
  fi
  exit 0
fi

echo "Linting ${#candidate_files[@]} Markdown file(s) [mode: $mode]..."
npx --yes markdownlint-cli --config .markdownlint.json "${candidate_files[@]}"
