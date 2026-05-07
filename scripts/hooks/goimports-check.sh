#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 0 ] && exit 0
out=$(goimports -l "$@")
if [ -n "$out" ]; then
  echo "$out" >&2
  echo "fix: goimports -w <files>" >&2
  exit 1
fi
