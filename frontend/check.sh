#!/usr/bin/env bash
# Frontend quality gates. Usage: ./check.sh [--fix]
set -euo pipefail

FIX="${1:-}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SRC_DIR="src"

FAILED=()

run_gate() {
  local name="$1"
  shift
  printf "\n==> %s\n" "$name"
  if "$@"; then
    return 0
  fi
  FAILED+=("$name")
  return 1
}

printf "Frontend quality gates\n"

# Typecheck (strict; tsc --noEmit via Next's tsconfig)
run_gate "typecheck" npx --no-install tsc --noEmit

# ESLint
if [ "$FIX" = "--fix" ]; then
  run_gate "eslint" npx --no-install eslint "$SRC_DIR" --fix --max-warnings=0
else
  run_gate "eslint" npx --no-install eslint "$SRC_DIR" --max-warnings=0
fi

# Prettier
if [ "$FIX" = "--fix" ]; then
  run_gate "prettier" npx --no-install prettier --write "$SRC_DIR"
else
  run_gate "prettier" npx --no-install prettier --check "$SRC_DIR"
fi

# Duplication
run_gate "duplication (jscpd)" npx --no-install jscpd --config jscpd.json "$SRC_DIR"

# Dead code / unused exports / unused deps
run_gate "dead code (knip)" npx --no-install knip

# Next.js build (catches runtime/build-only errors typecheck misses)
if [ "${SKIP_BUILD:-}" != "1" ]; then
  run_gate "next build" npx --no-install next build
fi

printf "\n"
if [ "${#FAILED[@]}" -eq 0 ]; then
  printf "all checks passed\n"
  exit 0
fi

printf "%d check(s) failed:\n" "${#FAILED[@]}"
for name in "${FAILED[@]}"; do
  printf "  - %s\n" "$name"
done
exit 1
