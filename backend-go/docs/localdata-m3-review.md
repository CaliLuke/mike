# Milestone 3 Review

Independent review was performed against Milestone 3 after the first localdata
implementation pass. The review found that the initial work had a strong
schema/lifecycle foundation but left checklist drift, workflow behavior, CORS,
local storage, download-token, transaction-wrapper, cascade-test, index-test,
auth/access-helper, namespace-doc, and global workflow DB binding gaps.

## Findings Addressed

- The milestone checklist now reflects implemented behavior instead of leaving
  M3 boxes unchecked while code exists.
- Document upload, edit-resolution, and generated-document workflows now write
  local bytes when supplied, upsert document/version/edit rows, and upsert
  deterministic `workflow_operations` rows.
- Workflow DB binding is keyed per opened app/data directory and cleared on
  close instead of using one process-global database pointer.
- Local CORS, local user middleware, single-user access helpers, non-blocking
  credit helpers, local byte storage, startup temp-file sweep, and download
  tokens have package-level implementations and tests. M4 still wires these
  primitives into the generated HTTP handlers.
- Project deletion, tabular-review deletion, and chat-message append use the
  closure-shaped SurrealDB transaction API.
- Cascade tests cover project, document, document-version, chat, workflow, and
  tabular-review parent deletes.
- Index tests now assert index names and load-bearing field snippets.
- The fixed Surreal namespace/database contract is documented in
  `persistence-spike.md` and exposed in `internal/localdata`.
- Schema compatibility tests cover legacy payload shapes that are strings,
  arrays, or objects.
- The Milestone 3 checklist wording was narrowed where necessary so it claims
  localdata primitives, not M4 route-handler ports.
- Third-pass gate failures and lifecycle findings were addressed: `go vet`
  shadow warnings were removed, startup temp sweeping now runs after the
  single-writer claim, initialization failure no longer double-releases the
  active data directory, local storage rejects symlink path components, and
  workflow resources no longer expose pointers to copied registry values.
- `backend-go/go.mod` now targets Go 1.26.3 so `govulncheck` scans a standard
  library version with the called net/http vulnerabilities fixed.
- Final verification: `./check.sh` from `backend-go` passes, including
  generated-code freshness, build, vet, imports, tidy drift, lint, deadcode,
  dupl, gocyclo, govulncheck, race tests, and 81.5% total coverage.

## Explicit M4 Ownership

Milestone 3 provides local storage and workflow primitives. M4 still owns
API-compatible route handlers, multipart upload parsing, file conversion,
full DOCX tracked-change/edit-resolution semantics, generated-document content
generation, and fixture replay against the Loom backend.
