# Persistence Spike

Milestone 0 tested embedded SurrealKV access from a Go test binary without a
SurrealDB server process or sidecar. The test binary reaches SurrealKV through
CGO and an in-process Rust static library; this is not a pure-Go embedded
driver.

## Selected Dependency

The selected Milestone 0 path is a narrow in-repo Rust FFI bridge from Go to
the official Rust SurrealDB SDK. The bridge lives under
`internal/persistence/rustbridge` and builds a static library that Go links
through CGO.

Exact dependency path:

- Rust crate: `surrealdb` 3.0.5 with the `kv-surrealkv` feature.
- Go bridge: `internal/persistence/rust_spike.go`.
- Rust bridge: `internal/persistence/rustbridge/src/lib.rs`.

The official `github.com/surrealdb/surrealdb.go` SDK was not selected for this
spike because it is a remote client API and does not currently provide the
embedded SurrealKV open path this app needs.

The `github.com/surrealdb/surrealdb.c.go` path was investigated and can open
and write a `surrealkv://` database, but it failed the same-process close and
reopen test. The likely cause is `surrealdb.c` dropping its Rust runtime during
`sr_surreal_disconnect` before the local-engine router task has completed
datastore shutdown and released SurrealKV's file lock. Treat the C binding as
unselected until that lifecycle issue is patched or disproven.

The app-facing boundary should stay in `internal/persistence` and hide whether
the implementation is Rust FFI, a future patched C binding, or a future native
Go embedded SDK.

This spike is intentionally not the final production FFI shape. It proves
reachability and persistence, but production work still needs an open-once,
query-many, close-on-shutdown handle API, a long-lived runtime ownership model,
and transaction-specific tests.

## Local Toolchain

Required tools:

- Go 1.26.2 or newer local equivalent.
- Rust toolchain with `cargo`.
- Apple Command Line Tools `clang` on macOS.
- CGO enabled.

Verified platform:

- macOS arm64.

Unverified platforms:

- Linux x86_64.
- Windows. Windows is deferred to the Wails feasibility work unless a Windows
  runner is available earlier.

The Makefile builds the Rust static library, sets the linker search path, and
runs the Go tests:

```bash
cd backend-go
make test
```

Equivalent manual flow:

```bash
cd backend-go
cd internal/persistence/rustbridge
cargo build --release
cd ../../..
CGO_LDFLAGS="-L$(pwd)/internal/persistence/rustbridge/target/release" go test ./...
```

## Verified Behavior

The spike test calls the Rust bridge from a Go test binary. The bridge opens a
file-backed SurrealKV database at a temporary path, defines a table, creates a
record, updates it, drops the connection, reopens the same path, and reads the
updated record back. It then deletes the record and verifies that the record is
gone. This proves create/read/update/delete and process-local reopen persistence
with no external SurrealDB server process.

The Rust SDK's local engine shuts down asynchronously after the last client is
dropped, so the bridge uses a bounded retry when reopening the same path. In the
verified run, `go test ./...` from `backend-go` passed.

## Failure Modes

- Missing `libluke_surreal_bridge.a` causes Go link failures. Run `make test`
  so the Rust bridge is built before `go test`.
- A missing Rust toolchain prevents building the bridge.
- macOS builds can fail if CGO uses a non-Apple clang or an incomplete SDK. The
  Makefile pins `CC` and `SDKROOT` to the Command Line Tools paths when they
  exist.
- On macOS, the static Rust library pulls in IOKit through transitive
  dependencies, so the CGO file links `-framework IOKit`.
- Linux linker flags and prerequisite packages are not verified yet.
- Windows linker flags, MSVC/Rust toolchain requirements, and static library
  packaging are not verified yet.
- The Rust bridge emits linker warnings if Rust object files are built for a
  newer local macOS SDK target than Go's default link target. These warnings did
  not prevent the spike test from passing on this machine.
- Immediate reopen can fail with SurrealKV's `LOCK is already locked by another
  process` error. Keep the bounded reopen retry unless the implementation moves
  to a lower-level API that exposes synchronous datastore shutdown.
- SurrealKV has a single-writer file-lock model. Only one backend process should
  open a given data path at a time, and tests should use unique temporary
  directories unless they are explicitly testing lock behavior.
