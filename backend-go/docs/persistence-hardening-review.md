# Persistence Hardening Review

Date: 2026-05-07

Scope: Milestone 2.5, covering `internal/persistence`, the Rust FFI bridge,
transaction smoke tests, and `docs/persistence-spike.md`.

## Review Findings And Disposition

- Concurrent FFI calls could alias the same Rust handle or race with close.
  Addressed by lifecycle admission locking plus serialized handle access before
  crossing the FFI boundary. Added concurrent admitted-query/close coverage.
- Context cancellation could return before transaction commit or rollback
  completed. Addressed by checking context before pool admission, waiting for
  admitted FFI work to finish, passing the caller context into the transaction
  closure, and rolling back if the context is canceled before commit.
- Escaped `*Tx` values could retain a dangling Rust transaction pointer.
  Addressed by invalidating the Go transaction handle before Rust commits or
  rolls back, with regression coverage.
- Runtime ownership wording was ambiguous. Resolved by documenting one
  long-lived Tokio runtime per open bridge handle, with the backend opening one
  handle per process.
- Bounded-concurrency wording overpromised for transaction-scoped queries.
  Resolved by documenting that handle-level FFI calls enter through `pond`, while
  transaction-scoped queries run inside the already-admitted transaction worker.
- SurrealDB crate freshness was verified before M3. `surrealdb` 3.0.5 is pinned
  as the latest stable crate; 3.1.0-beta.1 is a prerelease.

## Verification

Commands run:

```bash
cd backend-go
CGO_ENABLED=1 CGO_LDFLAGS="-L$(pwd)/internal/persistence/rustbridge/target/release" go test ./internal/persistence -count=1 -v
CGO_ENABLED=1 CGO_LDFLAGS="-L$(pwd)/internal/persistence/rustbridge/target/release" go test -race ./internal/persistence -count=1
./check.sh
```

Result: all passed. `./check.sh` reported `83.8%` total coverage against the
`80.0%` minimum. macOS linker target warnings remain non-fatal and are tracked
in `docs/persistence-spike.md`.
