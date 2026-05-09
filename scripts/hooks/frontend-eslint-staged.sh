#!/usr/bin/env bash
# Run eslint --fix on staged frontend files (passed by prek). Restage on success.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/frontend"

# Filter to files under frontend/ and rewrite as paths relative to frontend/.
files=()
for f in "$@"; do
  case "$f" in
    frontend/*) files+=("${f#frontend/}");;
  esac
done

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

npx --no-install eslint --fix --max-warnings=0 "${files[@]}"

# Restage anything eslint --fix modified.
( cd "$ROOT" && git add -- "${files[@]/#/frontend/}" )
