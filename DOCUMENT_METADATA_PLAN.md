# Document Metadata Enrichment

Add a deferred, user-triggered metadata classifier to `documents` (kind, summary, topics, people/company refs, interview stage) plus a first-class `library` boolean and a `document_application_links` join table so reusable assets (stories, baselines, cheatsheets) can be linked to many applications. Classifier follows the `tabular_entity.go` pattern: one `completeText` call to local Ollama, JSON parse, persist. Async dispatch via `go func()` + `context.Background()`, with an orthogonal `metadata_status` state machine that does not collide with the existing `documents.status`. Upload remains synchronous and untouched.

## Status

- 2026-05-11 — Plan created.
- 2026-05-11 — M1 (Schema and backfill) complete.
- 2026-05-11 — M2 (Classifier service) complete. 7 unit tests pass; enrichDocumentMetadata wired (M3 will expose it via HTTP). 16 existing docs backfilled to `metadata_status="unprocessed"`; new fields project to HTTP responses.
- 2026-05-11 — M3 (Trigger and confirmation API) complete. All 4 endpoints work end-to-end against the dev DB; mock LLM now emits a valid classifier response so probe scenarios get a deterministic happy path.
- 2026-05-11 — M4 (Application linking) complete. Library guard, link CRUD, application.library_documents and document.linked_application_ids all wired end-to-end.

## Milestones

### Milestone 1: Schema and backfill

Toc: Schema

Goal: Land the new fields and join table in SurrealKV with idempotent backfill of existing rows.

Acceptance Criteria

- `backend-go/internal/localdata/schema.go` defines all new fields and the `document_application_links` table; starting the backend against a copy of `.tmp/luke-local/data` completes `initSchema` with no error.
- After backfill, `SELECT count() FROM documents WHERE metadata_status = NONE` returns 0. (`library` and `kind` remain NONE on legacy rows until the classifier runs in Milestone 2.)
- Running `migrateDocumentsLibraryFlag` a second time leaves the row count of changes at 0 (idempotence).

Checklist

- [x] Extend `backend-go/design/doc_types.go` `Document` with `library`, `library_kind`, `kind`, `interview_stage`, `topics`, `company_refs`, `people_refs` (new nested `PersonRef`), `summary`, `dated_event_at`, `derived_from_id`, `metadata_status`, `metadata_processed_at`, `metadata_error`, `linked_application_ids`.
- [x] Append `DEFINE FIELD IF NOT EXISTS` lines for the above to the `documents` block in `backend-go/internal/localdata/schema.go` with the enum `ASSERT $value INSIDE [...]` checks listed in `DOCUMENT_METADATA_PLAN.md` "SurrealQL schema additions".
- [x] Define table `document_application_links` in the same schema constant with fields `document_id`, `application_id`, `relation`, `created_at`, `created_by` and indexes `doc_app_unique` (UNIQUE on `document_id, application_id`) and `app_links_by_app` (`application_id, created_at`).
- [x] Add `migrateDocumentsLibraryFlag` to `backend-go/internal/localdata/schema.go` mirroring `migrateApplicationsToCompanies` at lines 43–59; only set `metadata_status = "unprocessed"` where it is NONE. Do NOT pre-classify `library` / `library_kind`; the classifier (Milestone 2) decides those, so existing rows have `library = NONE` until processed.
- [x] Call `migrateDocumentsLibraryFlag` from `backend-go/internal/localdata/app.go` lines 170–182 after the existing `migrateEncodedChatMessageIDs` call (not from `initSchema`).
- [x] Run `cd backend-go && make generate && make build` and resolve any compile errors in `internal/localapi/repository.go` and `internal/localapi/api.go` from the expanded Document struct.
- [x] Start the backend pointed at a copy of `.tmp/luke-local/data`; run `SELECT count() FROM documents WHERE metadata_status = NONE` via a debug query and confirm 0.
- [x] Commit the milestone changes and push: `git add -A && git commit -m "Add document metadata schema fields and library-link join table" && git push`.

### Milestone 2: Classifier service

Toc: Classifier

Goal: Implement `enrichDocumentMetadata` that reads a document's text twin, calls the local Ollama, parses the JSON, and persists structured metadata.

Acceptance Criteria

- `backend-go/internal/localapi/document_metadata_test.go` parses the fixture `testdata/glean_transcript_llm_response.json` into `classifierResult` and asserts `kind="interview_transcript"`, `library=false`, `summary` non-empty.
- Calling `enrichDocumentMetadata` on a seeded transcript-style document transitions `metadata_status` to `ready` and persists `kind`, `summary`, `topics`, `library` (verified manually via SurrealQL `SELECT` before the probe scenario in Milestone 5).
- The function records an OTel span named `metadata.enrich_document` with attributes `metadata.document_id`, `metadata.kind`, `metadata.library`, `metadata.summary_chars`, `metadata.topic_count`.

Checklist

- [x] Create `backend-go/internal/localapi/document_metadata.go` with the `classifierSystemPrompt` constant (full prompt body in `DOCUMENT_METADATA_PLAN.md` "Classifier system prompt").
- [x] Define a `classifierResult` Go struct with `Kind`, `Library`, `LibraryKind`, `InterviewStage`, `Summary`, `Topics`, `CompanyRefs`, `PeopleRefs []PersonRef`, `DatedEventAt`, `SuggestedApplicationMatch`, `SuggestedDerivedFrom` and matching `json` tags.
- [x] Create `backend-go/internal/localapi/testdata/glean_transcript_llm_response.json` with a representative classifier output for a Glean recruiter transcript.
- [x] Write `TestClassifierResultParse` in `backend-go/internal/localapi/document_metadata_test.go` that reads the fixture and asserts struct fields without any LLM call.
- [x] Implement `enrichDocumentMetadata(ctx, docID string) error`: load Document, set `metadata_status="processing"`, load latest version's `extracted_text` via the same query path used by `readStoredExtractedText` in `assistant_agent.go`; if extraction failed, set `metadata_status="error"` with a `metadata_error` field and return nil.
- [x] Call `completeText(completionRequest{Model: defaultMainModel, SystemPrompt: classifierSystemPrompt, User: fmt.Sprintf("Filename: %s\n\nContent:\n%s", filename, truncated), Temperature: 0.2})` mirroring `internal/localapi/tabular_entity.go:267–279`; truncate `extracted_text` at 8000 chars.
- [x] Unmarshal into `classifierResult`; validate `Kind`, `LibraryKind`, `InterviewStage` against allow-lists copied from `schema.go` enums (reject unknowns by overwriting to `unclassified` / nil); cap `Topics` at 8 entries and `PeopleRefs` at 16.
- [x] Persist via `UPDATE documents SET ... WHERE id = $id` flipping `metadata_status="ready"` and `metadata_processed_at = time::now()`; on error path set `metadata_status="error"` and store the error message in `metadata_error` (added in Milestone 1).
- [x] Wrap the work in an OTel span following `internal/textextract/textextract.go:81` style; record the attributes listed in the acceptance criteria.
- [x] Run `cd backend-go && go test ./internal/localapi/... -run TestClassifierResultParse -v`.
- [x] Commit and push: `git add -A && git commit -m "Add deferred document metadata classifier service" && git push`.

### Milestone 3: Trigger and confirmation API

Toc: API

Goal: Expose endpoints to queue classification (single and batch), report queue state, and let the user confirm or override results.

Acceptance Criteria

- The four routes below appear in `backend-go/gen/http/cli/luke/cli.go` after `make generate`: `POST /single-documents/{documentId}/process-metadata`, `POST /single-documents/process-metadata`, `GET /single-documents/metadata-queue`, `PATCH /single-documents/{documentId}/metadata`.
- `POST /single-documents/process-metadata` with body `{"filter":"unprocessed"}` queues every `metadata_status="unprocessed"` document and returns 202 with the queued IDs; concurrency is capped at 5 in-flight goroutines.
- `PATCH /single-documents/{documentId}/metadata` with `{"confirm": true, "summary": "..."}` returns 200, persists the override, and flips `metadata_status` to `user_confirmed` (verified in Milestone 5 probe).

Checklist

- [x] Add the four routes to `backend-go/design/document_routes.go` against the existing `single_documents` service with `Result(Document)` for PATCH and a new `MetadataQueueStats` type for the GET (counts by status).
- [x] Run `cd backend-go && make generate` and confirm the new endpoints appear in `backend-go/gen/http/cli/luke/cli.go`.
- [x] Implement the single-doc enqueue handler in `backend-go/internal/localapi/api.go`: flip `metadata_status="queued"`, spawn `go func() { ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second); defer cancel(); _ = s.enrichDocumentMetadata(ctx, docID) }()`, return 202.
- [x] Implement the batch handler with a `make(chan struct{}, 5)` semaphore around each goroutine spawn; resolve `filter="unprocessed"` to the matching document IDs via SurrealQL before iterating.
- [x] Implement the queue-status handler using `SELECT count() AS n, metadata_status FROM documents GROUP BY metadata_status`.
- [x] Implement the PATCH handler: validate any submitted enum value against the allow-list, accept partial updates, set `metadata_status="user_confirmed"` when `confirm=true`, persist via `UPDATE documents MERGE { ... } WHERE id = $id`.
- [x] Run `cd backend-go && make build`.
- [x] Commit and push: `git add -A && git commit -m "Add classifier trigger and confirmation API" && git push`.

### Milestone 4: Application linking

Toc: Linking

Goal: Make library documents queryable from both directions (doc → applications served, application → library docs serving it).

Acceptance Criteria

- `POST /single-documents/{id}/application-links` returns HTTP 400 when the target document has `library=false`, and 201 otherwise; the inserted row has `created_by="user_confirmed"`.
- `GET /single-documents/{id}` populates `linked_application_ids` from a sub-select on `document_application_links` (verified in Milestone 5 probe).
- `GET /applications/{id}` (the existing list query in `backend-go/internal/localapi/repository.go:51–58`) includes a new `library_documents` array populated by the join table.

Checklist

- [x] Add `POST /single-documents/{documentId}/application-links` (body `{application_id, relation}`) and `DELETE /single-documents/{documentId}/application-links/{applicationId}` to `backend-go/design/document_routes.go`.
- [x] Add `library_documents` ArrayOf(Document) to the `Application` type in `backend-go/design/application_types.go`.
- [x] Run `cd backend-go && make generate`.
- [x] Extend `applicationListQuery` in `backend-go/internal/localapi/repository.go:51–58` with `(SELECT * FROM documents WHERE id IN (SELECT document_id FROM document_application_links WHERE application_id = $parent.id)) AS library_documents`.
- [x] Extend the Document load query in `backend-go/internal/localapi/repository.go` with `(SELECT application_id FROM document_application_links WHERE document_id = $parent.id) AS linked_application_ids`.
- [x] Implement the POST handler in `backend-go/internal/localapi/api.go`: reject with `goa.PermanentError("invalid_request", ...)` when the document has `library=false`; `CREATE document_application_links CONTENT { ... created_by: "user_confirmed" }`.
- [x] Implement the DELETE handler with `DELETE FROM document_application_links WHERE document_id = $doc AND application_id = $app`.
- [x] Update the classifier persistence step from Milestone 2 to also insert link rows with `created_by="classifier_suggested"` when `suggested_application_match` resolves to an existing application id.
- [x] Run `cd backend-go && make build`.
- [x] Commit and push: `git add -A && git commit -m "Add library-document application links and sub-select queries" && git push`.

### Milestone 5: Probe scenario and handoff

Toc: Probe

Goal: Cover the full upload → classify → confirm → link flow with one probe scenario, confirm no regressions, and commit.

Acceptance Criteria

- `cd backend-go && make probe SCENARIO=document_metadata` exits 0, asserting: upload yields `status=ready` and `metadata_status=unprocessed`; POST process-metadata transitions to `ready` within 60s with non-empty `summary` and `kind` populated; `telemetry.sqlite` has at least one `metadata.enrich_document` span; PATCH `{confirm:true}` flips `metadata_status` to `user_confirmed`; linking a separate library story to an application makes it appear under that application's `library_documents`.
- Every other probe scenario listed by `cd backend-go && make probe-list` still exits 0.
- Repository has one commit on `main` with subject `Add deferred document metadata enrichment and library/application linking` and no unrelated changes.

Checklist

- [ ] Create `backend-go/cmd/probe/scenarios/document_metadata.go` with `Register()` in `init()` and a `Run(ctx, client, tel, result)` function modeled on `backend-go/cmd/probe/scenarios/applications.go`.
- [ ] In the scenario, upload an interview-transcript fixture, POST `/single-documents/{id}/process-metadata`, poll `GET /single-documents/{id}` every 2s for up to 60s asserting `metadata_status` reaches `ready`.
- [ ] Assert `summary` non-empty, `kind == "interview_transcript"`, `library == false` on the resulting document.
- [ ] Assert the telemetry span via `From(spans).Named("metadata.enrich_document").WithAttr("metadata.document_id", docID).RequireAtLeast(1, "classifier ran exactly once")`.
- [ ] In the same scenario, PATCH `/single-documents/{id}/metadata` with `{"confirm": true, "summary": "override"}`; assert `metadata_status == "user_confirmed"` and the summary is the override on the next GET.
- [ ] In the same scenario, upload a story fixture, classify it (or directly PATCH `library=true`), POST `/application-links` linking it to an existing application, GET that application, assert the story id appears in `library_documents`.
- [ ] `defer client.Delete(...)` for every document and `defer DELETE` for every link the scenario creates.
- [ ] Run `cd backend-go && make probe SCENARIO=document_metadata` and confirm exit 0.
- [ ] Run `cd backend-go && for s in $(make probe-list | tail -n +2); do make probe SCENARIO=$s || { echo "FAIL: $s"; exit 1; }; done` to confirm no regressions.
- [ ] `git add -A && git commit -m "Add document metadata probe scenario" && git push`.

### Milestone 6: Frontend surface

Toc: Frontend

Goal: Surface metadata in the Files area so the user can see, filter, confirm, and batch-trigger classification without leaving the UI.

Acceptance Criteria

- `frontend/src/app/components/files/FilesOverview.tsx` shows a `kind` badge and a `Library` / `Application` badge on every row; a filter bar narrows the list by `library` (All / Library / Application), `kind`, and `metadata_status` (unprocessed / queued / ready / user_confirmed / error).
- `FilesOverview` has a "Process unprocessed" button that calls `POST /single-documents/process-metadata` with `{"filter":"unprocessed"}`; a status pill polls `GET /single-documents/metadata-queue` every 5s and shows `{queued, processing}` counts; the pill disappears when both reach 0.
- `frontend/src/app/components/files/FileView.tsx` shows a Metadata panel with `summary`, `topics` (as chips), `company_refs`, `people_refs`, `interview_stage`, `dated_event_at`, and the application link list; each field has an inline edit control; a "Confirm" button PATCHes with `confirm: true` and the row's `metadata_status` badge flips to `user_confirmed` without a page reload.
- Running `cd frontend && npm run lint && npm run build` exits 0.

Checklist

- [ ] Extend the `Document` type in `frontend/src/app/lib/lukeApi.ts` (and wherever the type is mirrored — search for `interface Document` and `type Document`) with the new fields: `library`, `library_kind`, `kind`, `interview_stage`, `topics`, `company_refs`, `people_refs`, `summary`, `dated_event_at`, `derived_from_id`, `metadata_status`, `metadata_processed_at`, `linked_application_ids`.
- [ ] Add API client functions in `frontend/src/app/lib/lukeApi.ts`: `processDocumentMetadata(id)`, `processDocumentMetadataBatch({document_ids?, filter?})`, `getMetadataQueue()`, `patchDocumentMetadata(id, patch, confirm)`, `addDocumentApplicationLink(docId, appId, relation)`, `deleteDocumentApplicationLink(docId, appId)`.
- [ ] Create `frontend/src/app/components/files/MetadataBadges.tsx` rendering the `kind` badge, the `Library`/`Application` pill, and the `metadata_status` dot; import it into `FilesOverview.tsx` row rendering.
- [ ] Create `frontend/src/app/components/files/FilesFilterBar.tsx` with three controls (library scope, kind, metadata_status); wire it to the existing filter state in `FilesOverview.tsx`.
- [ ] Create `frontend/src/app/components/files/ProcessQueuePill.tsx`: a small status component that polls `GET /single-documents/metadata-queue` every 5s with `useEffect` + `setInterval`, hides itself when counts are 0; render it in the `FilesOverview.tsx` header next to the "Process unprocessed" button.
- [ ] Add the "Process unprocessed" button to the `FilesOverview.tsx` header that calls `processDocumentMetadataBatch({filter:"unprocessed"})` and toasts the queued count.
- [ ] Create `frontend/src/app/components/files/MetadataPanel.tsx` rendering the editable summary/topics/company_refs/people_refs/interview_stage/dated_event_at fields with a Confirm button; on submit, call `patchDocumentMetadata(id, edits, true)` and re-fetch the document via `useFetchSingleDoc`.
- [ ] Embed `MetadataPanel` in `FileView.tsx` below the existing document preview; when `metadata_status === "unprocessed"`, show a "Classify this document" button that calls `processDocumentMetadata(id)`.
- [ ] In `frontend/src/app/components/files/MetadataPanel.tsx`, render `linked_application_ids` as a list of chips with a Remove button (calls `deleteDocumentApplicationLink`) and an "Add link" combobox of existing applications (calls `addDocumentApplicationLink` with `relation="referenced"`); only render this section when the document has `library=true`.
- [ ] Update the application detail page under `frontend/src/app/(pages)/applications/` to render the new `library_documents` array (read from the existing application list/detail query) as a "Library documents linked to this application" section with links back to `/files/{id}`.
- [ ] Run `cd frontend && npm run lint && npm run build` and resolve any type errors from the expanded Document interface.
- [ ] Manually exercise the flow at `http://localhost:3000/files`: upload a transcript, click "Classify", confirm the panel updates to `ready` within ~30s with non-empty summary, click "Confirm" to flip to `user_confirmed`, link a library story to an application, navigate to the application page and confirm the library section lists the story.
- [ ] `git add -A && git commit -m "Surface document metadata and library/application links in Files UI" && git push`.
