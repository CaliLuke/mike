# API Compatibility Fixtures

These fixtures record hand-authored API compatibility contracts the Go backend
must satisfy: status codes, JSON shapes, allowed SSE event names, and required
payload schemas. They are intentionally small and synthetic: do not commit
private uploaded files, Supabase tokens, model keys, or production data.

Replay against the active Go backend to verify the contract still holds:

```bash
node backend-go/testdata/compat/scripts/replay.mjs
```

Capture records observed status codes, JSON samples, and SSE payload type
sequences against a running backend; it intentionally keeps the expected
content types, required fields, allowed SSE event names, required SSE payload
types, and payload schemas from the fixture definitions. Replay is the strict
contract check.

Environment:

- `API_BASE`: defaults to `http://localhost:3001`.
- `FIXTURE_DIR`: defaults to this directory's `fixtures` folder.
- `FIXTURE_applicationId`, `FIXTURE_reviewId`, `FIXTURE_documentId`, and
  `FIXTURE_versionId`: required when replaying parameterized application,
  tabular, and binary-download fixtures.
