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
- Go bridge: `internal/persistence/surreal.go`.
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

Milestone 2.5 replaced the original one-shot spike entrypoint with a
production-shaped process boundary:

- `persistence.Open` opens one SurrealKV handle for the backend process.
- `(*DB).Query` issues repeated SurrealQL calls through that handle.
- `(*DB).Transaction` accepts a Go closure. Rust begins the transaction,
  invokes the closure with a transaction-scoped query handle, commits when the
  closure returns nil, and rolls back when the closure returns an error. Begin,
  commit, and rollback are not exposed as separate Go APIs.
- `(*DB).Close` releases the handle during backend shutdown.

The Rust bridge owns one long-lived Tokio runtime per open database handle. The
backend opens one handle per process, so this is also the process runtime owner
in normal operation. The Go side fronts every blocking handle-level FFI call
with a bounded `github.com/alitto/pond` worker pool and serializes access to the
opaque Rust handle before crossing the FFI boundary. Set
`LUKE_SURREALKV_WORKERS` to override the pool size; the default is 8. Once a
blocking FFI task is admitted to the worker pool, Go waits for the Rust result
so callers do not observe a transaction outcome before commit or rollback
finishes. Transaction-scoped query calls run inside the transaction closure on
the already-dispatched worker rather than submitting a nested worker task, so
aggregate transaction concurrency is still bounded by the admitted transaction
workers. The supplied `*Tx` is invalidated before commit or rollback, so escaped
transaction handles return an error instead of reusing a freed Rust transaction
pointer.

## Upgrade Procedure

The Rust bridge tracks the stable `surrealdb` crate pinned in
`internal/persistence/rustbridge/Cargo.toml` and resolved in `Cargo.lock`.
Current pinned version: `surrealdb` 3.0.5 with `kv-surrealkv`.

To upgrade:

1. Update the `surrealdb` version in `internal/persistence/rustbridge/Cargo.toml`.
2. Run `cargo update -p surrealdb` from `internal/persistence/rustbridge`.
3. Run `cargo build --release` from `internal/persistence/rustbridge`.
4. Run `go test ./...` from `backend-go` with `CGO_LDFLAGS` pointing at the
   release static library, or use `make test`.
5. Verify transaction commit and rollback smoke tests still pass before using
   the new crate version for repository work.

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
  process` error if the previous process or handle has not released the file
  lock. Production code should open once per process and close during shutdown.
- SurrealKV has a single-writer file-lock model. Only one backend process should
  open a given data path at a time, and tests should use unique temporary
  directories unless they are explicitly testing lock behavior.
