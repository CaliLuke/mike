# Luke Go Backend

This package contains the target Loom-designed Go backend for Luke. The `design/`
package is the source of truth for the API contract, and generated files under
`gen/` are committed but not hand-edited.

## Loom Generation

Run generation from this directory:

```bash
go generate ./design
```

The direct Loom command is:

```bash
loom gen github.com/CaliLuke/luke/backend-go/design
```

Run the full backend gate before submitting Go backend changes:

```bash
./check.sh
```

`./check.sh` reruns Loom generation, tidies module metadata, and fails if
`gen/`, `go.mod`, or `go.sum` were stale.

## Local Data Runtime

The local backend uses one data directory per Luke workspace. Set
`LUKE_DATA_DIR` before starting the backend. The local data initializer stores
SurrealKV data under `$LUKE_DATA_DIR/surrealkv`, Romancy durable workflow state
in `$LUKE_DATA_DIR/romancy.db`, and local document bytes under
`$LUKE_DATA_DIR/storage` unless `LOCAL_STORAGE_ROOT` is set.

The SurrealDB namespace and database are fixed to `luke`/`luke` in the Rust
bridge and surfaced in `internal/localdata` as `Namespace` and `Database`.

SurrealKV is opened once per backend process. A second backend pointed at the
same data directory is unsupported; startup wraps lock failures and same-process
double opens with:

```text
another Luke backend appears to be using $LUKE_DATA_DIR
```

This single-writer rule is intentional for the local-first app. Repository tests
use unique temporary `LUKE_DATA_DIR` values and avoid shared-path parallelism.

## Consistency Rules

SurrealDB owns domain invariants through schemaful tables, typed record links,
enum `ASSERT` clauses, indexes, and cascade `EVENT` definitions. Go repository
code should issue parent deletes and rely on the database events for dependent
records. Multi-record SurrealDB writes should use the closure-shaped transaction
API from `internal/persistence`.

Document upload, edit resolution, and generated-document persistence run as
Romancy workflows. The M3 workflows write local bytes through atomic
temp-file-then-rename storage helpers, upsert the document/version/edit rows
they own, and upsert deterministic `workflow_operations:<id>` rows so replay is
idempotent. M4 still owns the full API-compatible handlers, file conversion,
DOCX edit-resolution semantics, and generated-document content behavior.

Tabular cell generation over SSE is intentionally per-cell and non-transactional
unless the port explicitly changes that behavior. Local download tokens keep the
compatibility route shape while resolving to local storage paths.

## Browser Origins

During browser-local development, the Go backend should allow CORS from
`http://localhost:3000`. The later Wails shell should use its own app origin and
must be documented separately during packaging work.
