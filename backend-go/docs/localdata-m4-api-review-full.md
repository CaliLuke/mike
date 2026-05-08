Now I have a complete picture. Here is the full review.

---

## M4 Review: Actionable Findings

**Assessment**: M4 is a structural first pass. Route coverage and schema plumbing are in place. All acceptance-criteria gaps and several contract regressions remain. None of the M4 checklist items are checked.

---

### CRITICAL — Blocks M4 Acceptance Criteria

---

**[C1] No LLM integration — all AI routes are hardcoded stubs**

- **File/lines**: `localapi/api.go` — `chatStream`, `tabularChatStream`, `tabularGenerate`, `sendChatEnvelope`, `regenerateCell`, `tabularPrompt`, `generateChatTitle`
- **Why it matters**: M4 AC says "Ollama is the default model path when no hosted provider keys are stored." Zero LLM plumbing exists. All six M4 LLM checklist items are unimplemented (provider routing, Ollama, Claude, Gemini, streaming, completion).
- **Fix direction**: Wire an Ollama client behind a provider resolver. `tabularGenerate` and `chatStream` need actual model calls with streamed token deltas. `generateChatTitle` needs a cheap summarizer call. For M4 fixture purposes, the mock-provider mode from M1 must route through the same provider path so fixture replay is deterministic.

---

**[C2] Chat and tabular-chat SSE streams never persist messages**

- **File/lines**: `localapi/api.go` — `chatStream` → `sendChatEnvelope`; `tabularChatStream`
- **Why it matters**: `AppendChatMessages` (in `localdata/repository.go:102`) exists and is tested, but is never called from any HTTP handler. After any chat exchange, `GET /chats/{chatId}` returns `messages: []`. `GET /tabular-review/{reviewId}/chats/{chatId}/messages` returns empty. M4 AC requires "chat history…complete against local SurrealKV data."
- **Fix direction**: After the SSE stream closes, call `AppendChatMessages` with the user turn and the assembled assistant turn. For tabular chat, call the equivalent on `tabular_review_chat_messages`. The save must happen even if the client drops the SSE connection, so it should happen after the LLM completes, not inside the flush loop.

---

**[C3] Parameterized fixtures have no setup harness — replay will fail**

- **File/lines**: `testdata/compat/fixtures/binary-docx-download.json`, `sse-project-chat.json`, `sse-tabular-generate.json`, `sse-tabular-chat.json` — all require `FIXTURE_documentId`, `FIXTURE_versionId`, `FIXTURE_projectId`, or `FIXTURE_reviewId`
- **Why it matters**: `replay.mjs:36` returns `{ ok: false, error: "missing env …" }` when any `FIXTURE_*` var is absent. There is no companion script that creates a project, uploads a document, creates a tabular review, and exports their IDs into env before running the replayer. M4 AC: "The fixture replay script…passes…for JSON, upload/download, and SSE routes." The parameterized fixtures—covering project chat, tabular generate, and DOCX download—will always fail in CI without this setup.
- **Fix direction**: Add a `setup.mjs` (or extend `replay.mjs`) that creates a project, uploads `sample.txt`, creates a tabular review, and writes the resulting IDs into a temp env file sourced before replay. Alternatively, refactor the four parameterized fixtures to chain off the upload fixture and pass its response ID as a dynamic variable.

---

**[C4] DOCX implementation note is absent**

- **File/lines**: Entire `backend-go/` tree — no file names `wordZero`, DOCX, or OOXML
- **Why it matters**: M4 AC: "The backend contains a DOCX implementation note naming which document operations use `wordZero` and which still use the OOXML/tracked-edit port." This note does not exist anywhere.
- **Fix direction**: Add `backend-go/docs/docx-implementation.md` naming: (a) which routes serve raw bytes without transformation, (b) which need LibreOffice conversion (currently unimplemented), (c) the decision on `wordZero` vs raw OOXML, and (d) the tracked-change apply gap documented in C5.

---

### HIGH — Regression or Near-Term Breakage

---

**[H1] `displayDocument` serves DOCX/DOC as `text/plain` — browser renders garbage**

- **File/lines**: `localapi/api.go:230-232` — `displayDocument` → `serveDocumentBytes(w, r, "text/plain; charset=utf-8")`
- **Why it matters**: Uploading a DOCX and clicking "Display" sends raw OOXML bytes with `Content-Type: text/plain`. The browser renders `PK\x03\x04…` garbage. M4 checklist item "Port LibreOffice conversion behavior from `reference/express-backend/src/lib/convert.ts`" is unchecked. This is a hard regression from the Express backend which converts DOC/DOCX to text/HTML via LibreOffice.
- **Fix direction**: Implement or stub a conversion step: invoke `libreoffice --headless --convert-to txt` for DOCX/DOC, fall back to raw-bytes with a TODO comment if LibreOffice is unavailable, and set the content-type to the conversion output type.

---

**[H2] Accept/reject edit routes only update status — never apply tracked changes to DOCX**

- **File/lines**: `localapi/api.go` — `resolveEdit`, called by `acceptEdit`/`rejectEdit`. Query: `UPDATE document_edits:X SET status = ..., resolved_at = ...`
- **Why it matters**: The Express backend uses `docxTrackedChanges.ts` to read the DOCX, apply the tracked change at the OOXML level, write a new document version, and update `current_version_id`. The Go handler only flips the DB status field. After accepting an edit, the document bytes are unchanged. M4 checklist: "Port tracked-change editing behavior…" is unchecked.
- **Fix direction**: After updating `document_edits.status`, read the current DOCX version bytes, apply the tracked change (remove `<w:del>` or `<w:ins>` markup depending on accept vs reject), write a new version via `WriteLocalFileAtomic`, and update `document_versions` + `documents.current_version_id` in a transaction.

---

**[H3] `runDocumentWorkflow` hard 2-second polling deadline — defeats Romancy's crash-safety**

- **File/lines**: `localapi/api.go` — `runDocumentWorkflow`, `deadline := time.Now().Add(2 * time.Second)` with `time.Sleep(10 * time.Millisecond)`
- **Why it matters**: A 2-second wall-clock limit with busy-wait polling will fail on slow disks or with large files. The test in `app_test.go:1131` uses a 5-second deadline with 50ms sleep. The workflow design goal is crash-safety, not synchronous-HTTP-response semantics; polling the result inside the request handler with a hard timeout negates that. A large DOCX upload that takes 2.1s to persist will return 500 even though the workflow succeeds moments later.
- **Fix direction**: Increase the deadline to match the test (≥5s) as a minimum fix. For correctness, consider making upload return immediately with the document ID (from a fast pre-write of the document record) and let the Romancy workflow complete asynchronously; poll status via `GET /single-documents/{documentId}`.

---

**[H4] Built-in workflows never seeded — `GET /workflows` returns empty array**

- **File/lines**: No equivalent of `reference/express-backend/src/lib/builtinWorkflows.ts` anywhere in `backend-go/`. M4 checklist item "Port built-in workflow definitions" is unchecked.
- **Why it matters**: The frontend displays built-in system workflows (e.g., "Standard Review") from the `/workflows` endpoint. On a fresh install, the response is `[]`. All workflow-picker UIs appear empty.
- **Fix direction**: Add a `seedBuiltinWorkflows` step in `app.initialize()` (after `seedLocalUser`) that UPSERTs system workflows with `is_system: true` and a fixed record ID derived from the workflow name so re-seeding on restart is idempotent.

---

### MEDIUM — Contract Regression or Fixture Mismatch

---

**[M1] `updateFolder` PATCH silently resets `name` on partial updates**

- **File/lines**: `localapi/api.go:updateFolder` — `name := "Untitled Folder"` is always written, even when `req.Name == nil`
- **Why it matters**: A PATCH to move a folder to a different parent (`{"parent_folder_id": "xyz"}`) resets the name to "Untitled Folder". The Express backend does a partial SET. This is a regression and will destroy folder names.
- **Fix direction**: In `upsertFolder`, pass name as `*string`. If nil, omit the `name` field from the UPSERT CONTENT (or use UPDATE SET only the provided fields).

---

**[M2] `chat` PATCH silently resets `title` when no title is sent**

- **File/lines**: `localapi/api.go:chat` PATCH case — `title := "Untitled Chat"` written unconditionally when `req.Title == nil`
- **Why it matters**: Any PATCH without an explicit `title` overwrites the existing title with "Untitled Chat". No frontend operation currently sends a titleless PATCH to chat (they use `generate-title`), but it is a semantic regression.
- **Fix direction**: Only update `title` if `req.Title != nil`. Use `UPDATE chats:X SET updated_at = time::now()` alone when nothing else changes.

---

**[M3] `tabularGenerate` inserts phantom `local-document` cells when `document_ids` is empty**

- **File/lines**: `localapi/api.go:tabularGenerate` — `req.DocumentIDs = []string{"local-document"}` as fallback
- **Why it matters**: A client that omits `document_ids` gets cells inserted with `document_id = documents:local_document` which does not exist. Subsequent `tabularDetail` queries return these cells, which the frontend tries to join against a non-existent document.
- **Fix direction**: Return HTTP 400 if `document_ids` is empty after both field reads. Remove the `local-document` fallback.

---

**[M4] `tabularChatStream` sends `sendChatEnvelope` but the fixture schema requires `chat_id` field inside the payload**

- **File/lines**: `localapi/api.go:tabularChatStream` and `sse-tabular-chat.json`
- **Why it matters**: The fixture `sse-tabular-chat.json` expects `payloadSchemas.chat_id.type = "string"` — that means `payload.type === "string"` which passes since `{"type":"chat_id","chat_id":"..."}` has `payload.type = "chat_id"` (a string). This is fine. BUT the `chat_id` value field `payload.chat_id` is not checked in schema, and the fixture does not assert that the `chat_id` emitted is the actual newly-created tabular chat ID. No blocker, but no coverage of "the correct chatId was returned."
- **Fix direction**: Add a schema check `"chat_id": {"chat_id": "string"}` to the fixture, which would be satisfied by the current implementation.

---

### LOW

---

**[L1] `newID` has no random component — same-nanosecond collisions possible**

- **File/lines**: `localapi/repository.go:newID` — `prefix + "_" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36)`
- **Why it matters**: `createProject` uses `CREATE` (not `UPSERT`), so a collision would cause a 500. On single-user local hardware, consecutive calls within 1ns are extremely rare but possible under scheduler jitter.
- **Fix direction**: Append 4 random bytes from `crypto/rand` (use `localdata.randomToken` pattern) or use the standard library `rand.Int64`.

---

**[L2] No tests for `localapi` package**

- **File/lines**: `backend-go/internal/localapi/` — no `*_test.go` files
- **Why it matters**: M4 checklist item "Run `go test ./...` from `backend-go`" is unchecked. Handler behavior (status codes, JSON shapes, SSE event ordering) is exercised only by the manual replay script.
- **Fix direction**: Add at minimum an `httptest`-based table test for each handler group (profile, projects, documents, chats, workflows, tabular) covering status codes, response field presence, and SSE event ordering. The `app_test.go` pattern (open a real `localdata.App` with a temp dir) transfers directly.

---

## Completeness Status

| M4 Acceptance Criterion | Status |
|---|---|
| Fixture replay passes (JSON, upload/download, SSE) | **Partial** — parameterized fixtures fail without setup harness |
| Document upload/versions/display/download work end-to-end | **Partial** — upload works; display doesn't convert; tracked edits don't apply |
| Ollama default model path | **Not implemented** |
| Hosted providers ported (mock-covered in M4) | **Not implemented** |
| DOCX implementation note present | **Missing** |

The structural layer (routes, schema, CORS, user seeding, Romancy wiring, cascade deletes) is solid and M3 tests are comprehensive. The M4 gap is entirely in the behavior layer: LLM integration, message persistence, document conversion, and tracked-change application.
