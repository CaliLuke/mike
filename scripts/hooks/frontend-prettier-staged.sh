#!/usr/bin/env bash
# Run prettier --write on staged frontend files (passed by prek). Restage on success.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/frontend"

files=()
for f in "$@"; do
  case "$f" in
    frontend/*) files+=("${f#frontend/}");;
  esac
done

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

npx --no-install prettier --write --ignore-unknown "${files[@]}"

( cd "$ROOT" && git add -- "${files[@]/#/frontend/}" )
