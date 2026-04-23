#!/usr/bin/env bash
# Verify SSH signing key is loaded before allowing commit.
# Prevents unsigned commits that get rejected by branch protection.

gpgsign=$(git config --get commit.gpgsign)
format=$(git config --get gpg.format)

if [ "$gpgsign" != "true" ]; then
  exit 0
fi

if [ "$format" = "ssh" ]; then
  if ! ssh-add -l &>/dev/null; then
    echo ""
    echo "ERROR: SSH signing key not loaded — commit would be unsigned."
    echo ""
    echo "  Fix: ssh-add --apple-use-keychain ~/.ssh/id_rsa"
    echo ""
    echo "  Branch protection requires verified signatures."
    echo ""
    exit 1
  fi
elif [ "$format" = "openpgp" ] || [ -z "$format" ]; then
  key=$(git config --get user.signingkey)
  if [ -n "$key" ] && ! gpg --list-secret-keys "$key" &>/dev/null; then
    echo ""
    echo "ERROR: GPG signing key '$key' not available — commit would be unsigned."
    echo ""
    exit 1
  fi
fi

exit 0
