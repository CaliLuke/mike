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
