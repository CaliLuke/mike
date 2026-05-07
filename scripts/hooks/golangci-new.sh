#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/backend-go"
export CGO_ENABLED="${CGO_ENABLED:-1}"
export CGO_LDFLAGS="${CGO_LDFLAGS:--L$PWD/internal/persistence/rustbridge/target/release}"
golangci-lint run --new-from-rev=HEAD --fast-only
