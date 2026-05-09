#!/usr/bin/env bash
# Run a full frontend typecheck if any frontend/ TS file is staged.
# tsc cannot reliably check a subset of files in a project — full pass is fastest correct option.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

has_frontend_ts=0
for f in "$@"; do
  case "$f" in
    frontend/*.ts|frontend/*.tsx|frontend/**/*.ts|frontend/**/*.tsx) has_frontend_ts=1; break;;
  esac
done

if [ "$has_frontend_ts" -eq 0 ]; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/frontend"
npx --no-install tsc --noEmit
