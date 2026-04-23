#!/usr/bin/env bash
# Verify signing key is loaded before allowing commit.
# Prevents unsigned commits that get rejected by branch protection.
set -euo pipefail

gpgsign=$(git config --type=bool --get commit.gpgsign 2>/dev/null || echo false)
format=$(git config --get gpg.format 2>/dev/null || true)

if [ "$gpgsign" != "true" ]; then
  exit 0
fi

if [ "$format" = "ssh" ]; then
  key=$(git config --get user.signingkey 2>/dev/null || true)
  private_key="$key"
  if [[ "$private_key" == *.pub ]]; then
    private_key="${private_key%.pub}"
  fi

  if [ -n "$private_key" ] && [ -r "$private_key" ]; then
    exit 0
  fi

  if ! ssh-add -l &>/dev/null; then
    echo ""
    echo "ERROR: SSH signing key not loaded — commit would be unsigned."
    echo ""
    echo "  Fix: ssh-add ~/.ssh/id_rsa"
    echo "  macOS: add --apple-use-keychain if your key lives in Keychain."
    echo ""
    echo "  Branch protection requires verified signatures."
    echo ""
    exit 1
  fi
elif [ "$format" = "openpgp" ] || [ -z "$format" ]; then
  key=$(git config --get user.signingkey 2>/dev/null || true)
  if [ -n "$key" ] && ! gpg --list-secret-keys "$key" &>/dev/null; then
    echo ""
    echo "ERROR: GPG signing key '$key' not available — commit would be unsigned."
    echo ""
    exit 1
  elif [ -z "$key" ] && ! gpg --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec'; then
    echo ""
    echo "ERROR: No GPG secret key available — commit signing will fail."
    echo ""
    exit 1
  fi
fi

exit 0
