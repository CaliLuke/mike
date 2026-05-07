#!/usr/bin/env bash
# Go quality gates for backend-go. Usage: ./check.sh [--fix]
set -euo pipefail

FIX="${1:-}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RUST_BRIDGE_DIR="internal/persistence/rustbridge"
RUST_BRIDGE_LIB="$RUST_BRIDGE_DIR/target/release/libluke_surreal_bridge.a"

export CGO_ENABLED="${CGO_ENABLED:-1}"
export CGO_LDFLAGS="${CGO_LDFLAGS:--L$ROOT/$RUST_BRIDGE_DIR/target/release}"

if [ "$(uname -s)" = "Darwin" ]; then
  if [ -x /Library/Developer/CommandLineTools/usr/bin/clang ]; then
    export CC="${CC:-/Library/Developer/CommandLineTools/usr/bin/clang}"
  fi
  if [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/lib ]; then
    export SDKROOT="${SDKROOT:-/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk}"
  fi
fi

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

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required tool: $1" >&2
    echo "install with: go install $2" >&2
    exit 1
  fi
}

require_tool golangci-lint github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
require_tool goimports golang.org/x/tools/cmd/goimports@latest
require_tool govulncheck golang.org/x/vuln/cmd/govulncheck@latest

printf "Go quality gates for backend-go\n"

if [ ! -f "$RUST_BRIDGE_LIB" ]; then
  run_gate "rust bridge" bash -c "cd '$RUST_BRIDGE_DIR' && cargo build --release"
fi

snapshot_generated() {
  if [ ! -d gen ]; then
    printf '__missing_gen__\n'
    return 0
  fi
  find gen -type f -print0 | sort -z | xargs -0 shasum
}
export -f snapshot_generated

run_gate "loom generated freshness" bash -c '
  before=$(snapshot_generated)
  go generate ./design
  go mod tidy
  after=$(snapshot_generated)
  if [ "$before" != "$after" ]; then
    echo "generated Loom code was stale. Review regenerated files under backend-go/gen."
    git status --short -- gen || true
    exit 1
  fi
'

run_gate "go build" go build ./...
run_gate "go vet" go vet ./...

SOURCE_PKGS="$(go list ./... | grep -v '/gen/' | tr '\n' ' ')"
FORMAT_DIRS="$(go list -f '{{.ImportPath}} {{.Dir}}' ./... | awk '$1 !~ /\/gen(\/|$)/ { print $2 }' | tr '\n' ' ')"
METRIC_DIRS="$(go list -f '{{.ImportPath}} {{.Dir}}' ./... | awk '$1 !~ /\/gen(\/|$)/ && $1 !~ /\/design$/ { print $2 }' | tr '\n' ' ')"

if [ "$FIX" = "--fix" ]; then
  run_gate "goimports write" bash -c "goimports -w $FORMAT_DIRS"
else
  run_gate "goimports check" bash -c "
    out=\$(goimports -l $FORMAT_DIRS)
    if [ -n \"\$out\" ]; then
      echo \"\$out\"
      exit 1
    fi
  "
fi

run_gate "go mod tidy drift" bash -c '
  cp go.mod go.mod.bak
  cp go.sum go.sum.bak 2>/dev/null || true
  go mod tidy
  moddiff=$(diff -u go.mod.bak go.mod || true)
  sumdiff=$(diff -u go.sum.bak go.sum 2>/dev/null || true)
  mv go.mod.bak go.mod
  mv go.sum.bak go.sum 2>/dev/null || rm -f go.sum
  if [ -n "$moddiff" ] || [ -n "$sumdiff" ]; then
    echo "go.mod/go.sum drift detected. Run: go mod tidy"
    echo "$moddiff"
    echo "$sumdiff"
    exit 1
  fi
'

if [ "$FIX" = "--fix" ]; then
  run_gate "golangci-lint" golangci-lint run --fix
else
  run_gate "golangci-lint" golangci-lint run
fi

if command -v deadcode >/dev/null 2>&1; then
  run_gate "deadcode" bash -c '
    out=$(deadcode -test '"$SOURCE_PKGS"')
    if [ -n "$out" ]; then
      echo "$out"
      exit 1
    fi
  '
fi

if command -v dupl >/dev/null 2>&1; then
  run_gate "dupl" bash -c "
    out=\$(dupl -threshold 50 $METRIC_DIRS)
    if [ -n \"\$out\" ] && ! printf '%s\n' \"\$out\" | grep -qx 'Found total 0 clone groups.'; then
      echo \"\$out\"
      exit 1
    fi
  "
fi

if command -v gocyclo >/dev/null 2>&1; then
  run_gate "gocyclo" bash -c "
    out=\$(gocyclo -over 25 $METRIC_DIRS)
    if [ -n \"\$out\" ]; then
      echo 'functions exceeding cyclomatic complexity 25:'
      echo \"\$out\"
      exit 1
    fi
  "
fi

run_gate "govulncheck" govulncheck ./...

if find . -name '*_test.go' -not -path './vendor/*' -not -path './internal/persistence/rustbridge/target/*' -print -quit | grep -q .; then
  TEST_PKGS="$(go list ./... | grep -v '/gen/' | grep -v '/design$' | tr '\n' ' ')"
  run_gate "go test coverage" bash -c "
    go test $TEST_PKGS -race -coverprofile=coverage.out -covermode=atomic -timeout 120s
    total=\$(go tool cover -func=coverage.out | awk '/^total:/ { sub(/%/, \"\", \$3); print \$3 }')
    min=\${COVERAGE_MIN:-80}
    awk -v total=\"\$total\" -v min=\"\$min\" 'BEGIN {
      printf \"total coverage: %.1f%% (minimum %.1f%%)\n\", total, min
      exit(total + 0 < min + 0)
    }'
  "
fi

printf "\n"
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "All Go quality gates passed."
  exit 0
fi

echo "${#FAILED[@]} Go quality gate(s) failed:"
for name in "${FAILED[@]}"; do
  echo "  - $name"
done
exit 1
