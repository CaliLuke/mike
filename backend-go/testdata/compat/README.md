# API Compatibility Fixtures

These fixtures record the Milestone 1 compatibility contract for the current
Express backend. They are intentionally small and synthetic: do not commit
private uploaded files, Supabase tokens, model keys, or production data.

Run capture against the transitional backend with a working `backend/.env`:

```bash
LUKE_MOCK_LLM=1 npm run dev --prefix backend
AUTH_TOKEN='<supabase jwt>' node backend-go/testdata/compat/scripts/capture.mjs
```

Capture is not a pure read-only operation. It sends real requests to the
running backend, including `POST /user/profile` and upload/chat/tabular paths,
so run it only against disposable local data or a fixture Supabase project.
`LUKE_MOCK_LLM=1` removes live model calls, but it does not stop database or
storage writes.

The checked-in expectations are hand-authored compatibility contracts. Capture
records observed status codes, JSON samples, and SSE payload type sequences for
diffing, but it intentionally keeps the expected content types, required fields,
allowed SSE event names, required SSE payload types, and payload schemas from
the fixture definitions. Replay is the strict contract check.

Replay against either Express or the future Go backend:

```bash
AUTH_TOKEN='<jwt or local test token>' node backend-go/testdata/compat/scripts/replay.mjs
```

Environment:

- `API_BASE`: defaults to `http://localhost:3001`.
- `AUTH_TOKEN`: optional bearer token. Required by the current Express auth
  middleware unless that backend is started with a local auth bypass in a later
  milestone.
- `FIXTURE_DIR`: defaults to this directory's `fixtures` folder.
- `FIXTURE_projectId`, `FIXTURE_reviewId`, `FIXTURE_documentId`, and
  `FIXTURE_versionId`: required when replaying parameterized project, tabular,
  and binary-download fixtures.
