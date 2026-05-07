#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 0 ] && exit 0
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
pkgs=$(printf "%s\n" "$@" | sed 's|^backend-go/||' | xargs -n1 dirname | sort -u | awk '$0 != "." { print "./" $0 }')
[ -z "$pkgs" ] && exit 0
cd "$ROOT/backend-go"
export CGO_ENABLED="${CGO_ENABLED:-1}"
export CGO_LDFLAGS="${CGO_LDFLAGS:--L$PWD/internal/persistence/rustbridge/target/release}"
# shellcheck disable=SC2086
go vet $pkgs
