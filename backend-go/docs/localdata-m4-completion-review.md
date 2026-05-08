I now have a complete picture of the implementation. Here is the full findings report.

---

## M4 Review: Actionable Findings

**Overall assessment**: M4 is substantially more complete than the first review found. All six original Critical and High blockers from the previous review are addressed. Several new and residual issues remain. The plan's claim that M4 is "complete for the local browser compatibility gate" overstates one area and leaves three code-level defects that will be visible to end users.

---

### BLOCKER — M4 AC not fully satisfied

---

**[B1] `resolveEdit` silently accepts/rejects while leaving document bytes unchanged when local file is missing**

- **File/line**: `localapi/repository.go:253-299`
- The guard `if readErr == nil { ... create new version ... }` means that when `ReadLocalFile` returns an error (file not found, storage corruption, etc.), the function skips the version write entirely, then still executes `UPDATE document_edits SET status = "accepted", resolved_at = ...` at line 300.
- **Why it matters**: The edit shows as resolved in the UI, but `documents.current_version_id` still points to the unmodified version. The M4 AC requires "edit-resolution…complete against local SurrealKV data." Silently diverging the DB state from the file state is a data integrity violation.
- **Fix direction**: Return HTTP 500 if `readErr != nil` instead of falling through. The status update should only happen after a successful version write (or explicitly when no DOCX transformation is needed for the file type).

---

**[B2] `tabularGenerate` SSE never exercises the LLM provider path — hardcoded stub only**

- **File/line**: `localapi/api.go:674`, `localapi/repository.go:568-570`
- `tabularGenerate` calls `s.upsertCell(...)` → `upsertCellWithContent(...)` with `content = "Local mock answer"`, bypassing `completeText` and `streamChatText` entirely. `LUKE_MOCK_LLM=1` is irrelevant here — the content is hardcoded whether mock mode is on or off.
- `regenerateCell` (`api.go:696`) does call `s.completeText(...)`, creating an inconsistency between the two cell-writing paths.
- **Why it matters**: The M4 plan states "mock-provider fixtures cover the shared provider path." For tabular generate there is no provider path at all. The fixture passes only because it checks event types, not content source. A future live-Ollama run will produce the same "Local mock answer" stub.
- **Fix direction**: In `tabularGenerate`, call `s.completeText(ctx, completionRequest{...})` per cell (or per column against document text) and pass the result to `upsertCellWithContent`. This brings it in line with `regenerateCell` and activates mock mode correctly.

---

### HIGH — User-visible regression or near-miss

---

**[H1] `rewriteTrackedChangeXML` uses regex on structured XML — will produce corrupted output on real DOCX files**

- **File/line**: `localapi/docx.go:119-133`
- The pattern `<w:del\b[^>]*>` breaks on any XML start tag whose attributes contain a `>` character (e.g., `w:val="a>b"`). The greedy `[^>]*` stops at the first `>` and the outer match fails or matches incorrectly.
- Nested tracked changes (accepted insert inside a delete, or vice versa) are not handled by the regex and will produce malformed XML.
- No test exercises this code against a real `.docx` file — `api_test.go` uses a `.txt` upload, and `resolveEdit` returns early if the file is not DOCX-looking.
- **Why it matters**: Accepting or rejecting a tracked edit on a real uploaded DOCX has a realistic chance of producing a corrupt output file. This is the core OOXML editing path.
- **Fix direction**: Replace the regex with an `encoding/xml` stream-rewriter that walks `StartElement`/`EndElement` tokens and drops or promotes `w:del`/`w:ins` subtrees by tracking depth. The existing `textFromWordXML` function shows the token-walk pattern.

---

**[H2] Chat message persistence has a context-cancellation silent-failure window**

- **File/line**: `localapi/repository.go:373-382`
- The flow is: `send({type:"done"})` → `insertChatMessage(user)` → `insertChatMessage(assistant)`. If the client disconnects immediately after receiving `done`, the Go `http.ResponseWriter`'s context may be cancelled before the DB writes complete, causing both inserts to fail with a cancelled-context error. The error is returned to `persistAndStreamChat` → `chatStream` → `streamSSE`'s error handler, which tries to send another `{type:"error"}` event to an already-closed stream. The insert failure is swallowed.
- Same pattern in `persistAndStreamTabularChat` (`repository.go:440-445`).
- **Why it matters**: Chat message persistence is an explicit M4 acceptance criterion. Under realistic network conditions (mobile, slow connections), messages disappear from `GET /chats/{chatId}` after the UI re-renders.
- **Fix direction**: Decouple the DB inserts from the request context. Create a background context (e.g., `context.WithoutCancel(ctx)` or `context.Background()` with a short timeout) for the two `insertChatMessage` calls that execute after the SSE stream closes.

---

**[H3] `seedBuiltinWorkflows` resets `created_at` to `time::now()` on every backend restart**

- **File/line**: `localdata/schema.go:293-326` — all three `UPSERT workflows:builtin_*` blocks include `created_at: time::now()`
- `UPSERT … CONTENT { … }` in SurrealDB replaces the entire document on match. Every restart overwrites `created_at` with the current timestamp.
- **Why it matters**: The workflow list query `ORDER BY created_at` (api.go:517) will always sort the three builtins to the newest positions after a restart, disrupting user-visible ordering.
- **Fix direction**: Use `UPSERT … ON DUPLICATE KEY IGNORE` or move to `CREATE … IF NOT EXISTS`. Simpler: include `created_at: time::now()` only when inserting (`IF NOT EXISTS`), e.g., `UPSERT workflows:builtin_cp_checklist SET title = ..., ..., created_at = created_at OR time::now()`.

---

### MEDIUM — Contract gap or fixture coverage hole

---

**[M1] `binary-docx-download` fixture validates content-type but not DOCX bytes — exercises no DOCX path**

- **File/line**: `testdata/compat/fixtures/binary-docx-download.json` + `testdata/compat/scripts/setup.mjs:9-11`
- `setup.mjs` uploads `sample.txt`, making `FIXTURE_documentId` point to a `.txt` document. The DOCX download fixture then calls `GET /single-documents/{documentId}/docx` and receives `.txt` bytes with a forced `application/vnd.openxmlformats-officedocument.wordprocessingml.document` content-type. The fixture's `contentTypeIncludes` check passes because `serveDocumentBytes` sets the content-type unconditionally.
- **Why it matters**: The plan states DOCX bytes are covered. No real `.docx` fixture file exists. Any regression in DOCX serving would not be caught.
- **Fix direction**: Add a `sample.docx` (minimal valid DOCX: a valid zip with `word/document.xml`) to `testdata/compat/fixtures/` and upload it in `setup.mjs` as the document used for the DOCX download fixture.

---

**[M2] `tabularChatStream` ignores any model field in the request — silently inconsistent with chat routes**

- **File/line**: `localapi/api.go:729-756` — the request struct has no `Model` field; `persistAndStreamTabularChat` hardcodes `defaultMainModel`
- Global and project chat both accept and honour `req.Model` via `modelOrDefault(model)`. Tabular chat does not expose a model parameter at all.
- **Why it matters**: If the frontend sends `"model": "gemma4"` in the tabular chat request (matching what it sends for other chat routes), it is silently ignored. When live Ollama is wired, this will prevent model selection for tabular chat.
- **Fix direction**: Add `Model *string` to the request struct and pass it through `persistAndStreamTabularChat` the same way `persistAndStreamChat` does.

---

**[M3] `newID` has no random component — timestamp-only collisions remain unfixed**

- **File/line**: `localapi/repository.go:667-669`
- `newID(prefix)` uses `strconv.FormatInt(time.Now().UTC().UnixNano(), 36)` with no entropy component. Fast successive calls (e.g., two `insertChatMessage` calls in the same nanosecond) produce duplicate IDs, which will fail the SurrealDB `CREATE` (not `UPSERT`) statement.
- This was flagged as L1 in the previous review and was not addressed.
- **Fix direction**: Append 4 random bytes: `prefix + "_" + strconv.FormatInt(time.Now().UTC().UnixNano(), 36) + "_" + hex.EncodeToString(randBytes(4))`.

---

### LOW — Residual / documentation gaps

---

**[L1] `tabularDetail` returns `document_count: 0` in the list query but actual documents in the detail view — inconsistency**

- **File/line**: `localapi/api.go:592` (`0 AS document_count`), `repository.go:553-565` (tabularDetail returns real docs)
- The list endpoint hardcodes 0; the detail endpoint returns the real documents array. The frontend may use the list count to decide whether to show a populated badge.
- **Fix direction**: Replace `0 AS document_count` with a subquery: `(SELECT count() FROM tabular_cells WHERE review_id = id GROUP ALL)[0].count ?? 0 AS document_count`.

**[L2] M4 plan checklist — independent review item unchecked**

- **File/line**: `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md:201`
- `- [ ] Ask an independent agent to review the milestone work...` is unchecked. The M4 status section (line 18) claims M4 is "complete" but this checklist item is the only M4 item still open.
- **Fix direction**: Check the box after addressing the findings above and before moving to M5.

**[L3] Coverage at 44.9% — handler parity gap**

- **File/line**: `backend-go/docs/localdata-m4-api-review.md:49-53`
- The documented deferral acknowledges the 80% floor failure. The two test functions in `api_test.go` cover SSE persistence and display/workflow-seed. Folder CRUD, document version rename, trackedChangeIDs, project chat, zip download, download token, workflow share no-ops, and tabular cell regeneration have no handler tests.
- Not a blocker, but the documented deferral should state which routes have no test so M5 can pick up the gap.

---

### Summary table

| Finding | Severity | AC gap? |
|---|---|---|
| B1: resolveEdit silently corrupts edit status when file missing | **Blocker** | Yes — edit resolution AC |
| B2: tabularGenerate never routes through LLM provider | **Blocker** | Yes — shared provider path AC |
| H1: rewriteTrackedChangeXML regex breaks on real DOCX | **High** | Yes — tracked-edit AC |
| H2: Message persistence context-cancel window | **High** | Yes — chat persistence AC |
| H3: seedBuiltinWorkflows resets created_at every restart | **High** | No |
| M1: binary-docx fixture tests .txt bytes | **Medium** | Yes — fixture coverage AC |
| M2: tabularChatStream ignores model | **Medium** | No |
| M3: newID timestamp-only collision (unfixed from prior review) | **Medium** | No |
| L1: tabularDetail document_count always 0 in list | **Low** | No |
| L2: M4 checklist review item unchecked | **Low** | Yes — checklist |
| L3: Coverage floor deferral underspecified | **Low** | No |
