#!/usr/bin/env bash
# Run knip across the frontend project when any frontend file changed.
# Knip is a project-wide gate (unused exports/deps) — file-scoped invocations are unreliable.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  exit 0
fi

has_frontend=0
for f in "$@"; do
  case "$f" in
    frontend/*) has_frontend=1; break;;
  esac
done

if [ "$has_frontend" -eq 0 ]; then
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/frontend"
npx --no-install knip
