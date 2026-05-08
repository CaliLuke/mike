# Local Job Workbench Migration Plan

The chosen design is an infrastructure-first migration from the current Supabase-backed legal cloud product to a browser-local workbench. Preserve the existing Next.js frontend and REST/SSE API shapes first, replace Express/Supabase with a Loom-designed Go backend backed by embedded SurrealDB using SurrealKV, and defer Wails packaging plus job-search domain remodeling until the local browser version is working. Wails remains the preferred desktop shell, but the Next 16 app-router frontend must be export-tested before desktop packaging starts. Initial target platform is macOS arm64 only; Intel Macs and other OSes are out of scope.

Word manipulation should move toward Go-native libraries where possible. Evaluate `github.com/zerx-lab/wordZero` for DOCX creation, template rendering, structured parsing, styles, tables, and markdown-to-DOCX workflows during the backend port; keep the existing tracked-edit behavior until a replacement proves it can preserve or intentionally replace the current `document_edits` and version-resolution semantics.

Durable execution for crash-sensitive multi-step paths (document upload, edit resolution, generated-document persistence, future deep-research and human-in-the-loop workflows) uses `github.com/i2y/romancy` with its embedded SQLite backend, sitting alongside SurrealKV in a shared data directory. Romancy activities must be idempotent (deterministic IDs, upserts) so replay after crash is safe; that is the explicit rule for any code path that becomes a workflow.

## Current Status

Last updated: 2026-05-07.

- Milestone 0 has implementation evidence checked in, but its independent-agent review remains open.
- Milestone 1 is complete, including the compatibility inventory, fixture capture/replay scripts, mock-provider mode, and independent review.
- Milestone 2 is complete and pushed in commit `cec5bf8` (`Add Loom backend contract milestone`). The Loom contract covers all 67 inventory routes, preserves the `/users` alias, generates SSE-compatible OpenAPI for all four streaming routes, and `backend-go/check.sh` now passes repeatedly with a stable generated-code freshness gate.
- Milestone 2.5 is complete. The Rust FFI persistence boundary now has an open/query/transaction/close lifecycle, one long-lived Tokio runtime per open handle, bounded `pond` worker admission, serialized handle access, closure-shaped transactions, commit/rollback smoke tests, and review findings addressed in `backend-go/docs/persistence-hardening-review.md`.
- Milestone 3 local data foundation is complete. `backend-go/internal/localdata` initializes `$LUKE_DATA_DIR/surrealkv`, `$LUKE_DATA_DIR/romancy.db`, local storage defaults, schemaful Surreal tables, DB-side cascades, deterministic local user state, single-user auth/access/credit helpers, CORS, download tokens, transaction-wrapped repository primitives, and Romancy document-operation workflows with deterministic upserts.
- Next execution target: Milestone 4 API-compatible backend behavior.

## Milestones

### Milestone 0: Persistence Spike

Goal: Prove the SurrealKV integration path before committing the backend port to it.

Acceptance Criteria

- A Go test binary opens a file-backed SurrealKV database, writes records, closes the connection, reopens it with no external SurrealDB server process running, and reads the same records.
- `backend-go/docs/persistence-spike.md` names the exact dependency path used: native SurrealDB Go SDK embedded mode, an in-repo Go driver/binding layer, or Rust SurrealDB driver access from Go.
- If native Go embedded mode is unavailable, the document records the chosen fallback as either a small in-repo driver/binding layer or Rust driver integration from Go, with the build/toolchain commands needed for local development.

Checklist

- [x] Create a minimal `backend-go` spike package and test that exercises create/read/update/delete against a file-backed SurrealKV path.
- [x] Run the spike with no SurrealDB server process or sidecar running.
- [x] Evaluate native Go SDK embedded access and prefer it only if it passes the persistence test.
- [x] Evaluate a narrow in-repo Go driver/binding layer because native Go SDK embedded access is unavailable.
- [x] Use the Rust SurrealDB driver from Go because the Go-native and C-binding paths did not provide embedded SurrealKV safely.
- [x] Record the chosen dependency, build flags, local toolchain requirements, and failure modes in `backend-go/docs/persistence-spike.md`.
- [ ] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 1: Compatibility Inventory

Goal: Capture the current Express/frontend API contract before any backend replacement work starts.

Acceptance Criteria

- A checked-in route inventory lists every handler from `backend/src/routes/*.ts`, including `/user` and `/users`, with method, path, router file, frontend caller, and transport.
- The inventory marks these four routes as SSE: `POST /chat`, `POST /projects/:projectId/chat`, `POST /tabular-review/:reviewId/generate`, and `POST /tabular-review/:reviewId/chat`.
- Golden HTTP fixtures exist for representative JSON, upload/download, and SSE envelopes and can be replayed by a script against a running backend.
- Fixture capture runs against the current Express backend before Supabase auth is removed and uses a working `backend/.env`.

Checklist

- [x] Generate `docs/api-compatibility-inventory.md` from `backend/src/index.ts`, `backend/src/routes/*.ts`, and `frontend/src/app/lib/mikeApi.ts`.
- [x] Record which frontend calls use `/user` and which use `/users`; preserve the unused prefix as a generated alias only.
- [x] Include nested project routes in the inventory: `/projects/:projectId/documents`, `/projects/:projectId/folders`, `/projects/:projectId/chats`, and `/projects/:projectId/people`.
- [x] Include tabular prompt and chat-title routes in the inventory: `POST /tabular-review/prompt` and `POST /chat/:chatId/generate-title`.
- [x] Mark every route as REST JSON, multipart upload, binary download, zip download, redirect/token download, or SSE.
- [x] Enumerate the chat tool families currently implemented in `backend/src/lib/chatTools.ts`: document listing/read/search/fetch, document generation, document replication, tracked editing, workflow read/apply, tabular context, citations, and download-card events. List the individual tools within each family so M4 can be expanded into per-tool checklist items.
- [x] Add a deterministic mock-provider mode for fixture capture and replay so SSE tests do not depend on live Claude, Gemini, or Ollama output.
- [x] Implement mock-provider mode below the LLM provider router by intercepting provider HTTP/local model calls so captured fixtures can replay against the Go backend without reimplementing high-level mocks.
- [x] For each SSE route, capture event ordering, event names, and payload schema while ignoring nondeterministic token text and model-specific prose.
- [x] Add fixture capture scripts under `backend-go/testdata/compat` that record current Express request/response examples without committing secrets or uploaded private files.
- [x] Add a fixture replay script under `backend-go/testdata/compat` that compares status codes, content types, response fields, SSE event names, SSE ordering, and SSE payload schemas.
- [x] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 2: Loom Backend Contract

Goal: Define a Loom API contract that preserves the route inventory and transport choices captured in Milestone 1.

Acceptance Criteria

- `backend-go/design` defines Loom services for every route in `docs/api-compatibility-inventory.md`, including the `/users` alias for `/user`.
- The generated OpenAPI marks the four streaming operations as SSE-compatible rather than ordinary JSON responses.
- `loom gen <backend-go module>/design` completes from `backend-go`, and a generation check fails when `backend-go/gen` is stale.

Checklist

- [x] Create `backend-go/go.mod` with Loom, `github.com/i2y/romancy`, `github.com/alitto/pond`, and test dependencies. Persistence is built via CGO against the in-repo Rust bridge per Milestone 2.5 and is not a Go module dependency.
- [x] Add Loom design types matching the current TypeScript response shapes in `frontend/src/app/components/shared/types.ts`.
- [x] Add Loom methods for every inventory row, preserving current HTTP methods, path parameters, query parameters, request bodies, and response status codes.
- [x] Model `POST /chat`, `POST /projects/:projectId/chat`, `POST /tabular-review/:reviewId/generate`, and `POST /tabular-review/:reviewId/chat` as SSE operations.
- [x] Preserve `/user` and `/users` as equivalent route prefixes for profile and account operations.
- [x] Generate Loom transport, endpoint, service, client, and OpenAPI code.
- [x] Add a `go generate` or script check that runs Loom generation and fails when `git diff --quiet backend-go/gen` is false.
- [x] Add a backend README command note for running Loom generation from `backend-go`.
- [x] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 2.5: Persistence Hardening

Goal: Turn the Milestone 0 Rust FFI spike into a production-shaped persistence boundary before repository work depends on it.

Acceptance Criteria

- The Rust FFI bridge exposes an open-once, query-many, close-on-shutdown handle lifecycle with explicit runtime ownership, instead of a one-shot test entrypoint.
- Transactions cross the FFI boundary as a closure shape: one FFI call accepts a transaction body, commits if it returns ok, rolls back if it returns an error. No begin/commit/rollback exposed as separate FFI calls.
- The persistence spike builds and passes on macOS arm64.
- All blocking FFI calls are funneled through a bounded worker pool (`github.com/alitto/pond`) with a configurable size, default 8, so FFI thread-pinning is bounded and observable.
- Transaction smoke tests prove begin/commit and begin/rollback behavior against file-backed SurrealKV through the chosen FFI boundary.

Checklist

- [x] Define the FFI handle lifecycle in `backend-go/internal/persistence`: open a database handle once per backend process, issue many query/transaction calls through that handle, and close it during backend shutdown.
- [x] Define Rust runtime ownership for the bridge: one long-lived Tokio runtime owned by each open bridge handle. The backend uses one open handle per process.
- [x] Define a closure-shape transaction FFI entrypoint that wraps a Go-supplied callback and commits or rolls back based on the callback's result.
- [x] Front handle-level FFI calls with a `pond` worker pool sized via env (default 8). Document this as the bounded-concurrency model for SurrealKV access; transaction-scoped queries run inside the admitted transaction worker.
- [x] Add a transaction smoke test: begin, write multiple records, roll back, and verify no records persisted.
- [x] Add a transaction smoke test: begin, write multiple records, commit, reopen, and verify records persisted.
- [x] Verify and pin the latest stable Rust `surrealdb` crate for Milestone 2.5 (`3.0.5`) in `Cargo.lock`. Document the pinned version and upgrade procedure in `backend-go/docs/persistence-spike.md`; re-check stable crate freshness at the start of M3.
- [x] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 3: Local Data And Storage

Goal: Replace Supabase database, auth, admin-user lookup, and R2 requirements with a deterministic single-user SurrealKV-backed repository, plus Romancy-backed durable execution for crash-sensitive write paths.

Acceptance Criteria

- Backend data persists across process restarts under `LUKE_DATA_DIR`, which contains `surrealkv/` (SurrealDB data) and `romancy.db` (Romancy SQLite state).
- All SurrealDB tables are schemaful: `DEFINE TABLE` and `DEFINE FIELD` with types and asserts encode invariants (enums, FKs as `record<...>`, strict JSON fields as `object FLEXIBLE`, and legacy variable-shape JSON fields as `any`).
- Cascade deletes run as SurrealQL `EVENT` definitions on parent tables, not in Go repository code.
- Repository tests prove SurrealDB record links, DB-side cascade deletes, JSON object fields, load-bearing indexes, transactions, and DB-side enum validation.
- Local auth primitives resolve to one deterministic local user and expose the same service-level user context shape without requiring an Authorization header. M4 wires those primitives into the ported route handlers.
- Backend startup enforces a single-writer constraint by relying on SurrealKV's own file lock and surfacing a helpful error message ("another Luke backend appears to be using $LUKE_DATA_DIR") when the lock is already held, including same-process double-open attempts against the active data directory.
- Document upload, edit resolution, and generated-document persistence run as Romancy workflows. Their activities are idempotent (deterministic IDs, upserts) so replay after crash is safe.
- The deterministic local user context is wired into Romancy activity contexts the same way it is wired into HTTP handlers; no separate user-resolution mechanism.

Checklist

- [x] Implement a SurrealDB connection package using the Milestone 2.5 persistence boundary, fixed namespace/database constants, and `LUKE_DATA_DIR/surrealkv`.
- [x] Catch SurrealKV's open-time lock error at startup and wrap it with the helpful message above. Document the single-writer rule and the "open once per process; in-process reopen is not supported" rule in `backend-go/README.md`.
- [x] Ensure repository tests use unique temporary `LUKE_DATA_DIR` directories; do not run shared-path database tests with `t.Parallel()`.
- [x] Define schemaful tables with `DEFINE TABLE` and `DEFINE FIELD` for every domain table; encode enums as `ASSERT $value INSIDE [...]`, FKs as `record<...>`, strict JSON fields as `object FLEXIBLE`, and legacy variable-shape JSON fields as `any`.
- [x] Define SurrealQL `EVENT` cascade rules on parent tables for projects, folders, documents, document versions, document edits, chats, tabular reviews, tabular cells, tabular review chats, and workflow-owned records. Go repository code issues the parent delete and trusts the DB to handle children.
- [x] Wrap multi-record write paths in SurrealDB transactions via the closure-shape FFI for project deletion, tabular review deletion, and chat message append. Document upload, edit resolution, and generated-document persistence are wrapped instead by Romancy workflows (see below).
- [x] Document that tabular cell generation writes are intentionally per-cell and non-transactional when streamed over SSE, unless the port changes that behavior explicitly.
- [x] Document transaction and crash-consistency guarantees in `backend-go/README.md`, including the temp-file-then-rename pattern for byte uploads and startup orphaned-temp sweeps.
- [x] Drop Go-side enum checks; rely on SurrealDB `ASSERT` to enforce them and surface errors back to handlers.
- [x] Preserve current JSON shapes for `documents.structure_tree`, `projects.shared_with`, `workflows.columns_config`, `chat_messages.content`, `chat_messages.files`, `chat_messages.annotations`, and tabular citation data.
- [x] Define SurrealDB indexes for load-bearing lookups: documents by project/folder, document versions by document/version number, chats by project, chat messages by chat, tabular reviews by project, tabular cells by review/document/column, and tabular review chat messages by chat.
- [x] Initialize Romancy with its embedded SQLite backend at `LUKE_DATA_DIR/romancy.db`. Romancy owns its own schema and migrations; Luke does not manage them.
- [x] Implement Romancy workflows for document upload, edit resolution, and generated-document persistence. Activities use deterministic IDs and upserts so replay is safe.
- [x] Wire the deterministic local user context into Romancy activity contexts so workflow-driven writes attribute to the same user as HTTP handler writes.
- [x] Seed the deterministic local user profile on backend startup with non-restricting tier, credits, and reset-date values for local mode.
- [x] Add local credit-gating primitives that keep local single-user AI usage non-blocking when M4 wires handlers.
- [x] Add local user-context middleware preserving the handler/service fields currently represented by `res.locals.userId`, `res.locals.userEmail`, and `res.locals.token`; M4 wires it into the ported routes.
- [x] Add single-user access-check primitives matching `backend/src/lib/access.ts` return semantics with `is_owner: true` and `shared_with: []`.
- [x] Preserve local document byte storage using `LOCAL_STORAGE_ROOT` (defaulting under `LUKE_DATA_DIR`) and remove R2 as a required dependency.
- [x] Decide local download-token semantics by keeping `/download/:token` as a compatibility route backed by local storage paths and the existing token payload shape.
- [x] Add CORS middleware for browser-local development from `http://localhost:3000` and document the later Wails origin separately.
- [x] Add repository tests that create records, restart the SurrealDB connection, and read the same records back from a temporary `LUKE_DATA_DIR`.
- [x] Run `./check.sh` from `backend-go`.
- [x] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete. Findings are summarized in `backend-go/docs/localdata-m3-review.md`.

### Milestone 4: API-Compatible Backend Behavior

Goal: Port Express behavior into Loom service implementations and prove compatibility with the fixtures captured before the rewrite.

Acceptance Criteria

- The fixture replay script from `backend-go/testdata/compat` passes against the Loom backend for JSON, upload/download, and SSE routes.
- Document upload, version listing, display/download routes, project folders, chat history, workflows, tabular reviews, and tabular chat complete against local SurrealKV data.
- Ollama is the default model path when no hosted provider keys are stored. Hosted providers (Claude, Gemini) are ported but not exercised against real APIs in M4 to avoid spend; mock-provider fixtures cover them.
- The backend contains a DOCX implementation note naming which document operations use `wordZero` and which still use the OOXML/tracked-edit port.

Checklist

- [ ] Port user profile and model settings behavior from `backend/src/routes/user.ts` and `backend/src/lib/userSettings.ts`.
- [ ] Port project, folder, document attach, document move, people, sharing no-op, and document count behavior from `backend/src/routes/projects.ts`.
- [ ] Port document upload, display, docx bytes, version, edit-resolution, and zip-download behavior from `backend/src/routes/documents.ts`.
- [ ] Port document-version helpers from `backend/src/lib/documentVersions.ts`.
- [ ] Port upload and document-format helpers from `backend/src/lib/upload.ts` and `backend/src/lib/documentFormats.ts`.
- [ ] Port LibreOffice conversion behavior from `backend/src/lib/convert.ts`.
- [ ] Port tracked-change editing behavior from `backend/src/lib/docxTrackedChanges.ts` and preserve `document_edits.change_id`, `del_w_id`, `ins_w_id`, accepted status, and rejected status semantics.
- [ ] Evaluate `github.com/zerx-lab/wordZero` against current generated-document, template, markdown-to-DOCX, table, and structured-read needs.
- [ ] Use `wordZero` for new DOCX generation paths that it supports without breaking current download/version response shapes.
- [ ] Use raw zip/XML OOXML manipulation as the fallback implementation path for generated documents and tracked-change editing when `wordZero` cannot satisfy a required operation.
- [ ] Port global chat and project chat routes from `backend/src/routes/chat.ts` and `backend/src/routes/projectChat.ts`.
- [ ] Expand the `chatTools.ts` port into per-tool checklist items derived from the M1 inventory; each tool gets its own checkbox before implementation begins.
- [ ] Port LLM provider routing from `backend/src/lib/llm/models.ts` and `backend/src/lib/llm/index.ts`.
- [ ] Port Ollama streaming and completion behavior from `backend/src/lib/llm/ollama.ts`.
- [ ] Port Claude streaming and completion behavior from `backend/src/lib/llm/claude.ts`.
- [ ] Port Gemini streaming and completion behavior from `backend/src/lib/llm/gemini.ts`.
- [ ] Port chat-title generation route `POST /chat/:chatId/generate-title`.
- [ ] Port workflow list, create, update, delete, hidden-workflow, share-list no-op, share-create no-op, and share-delete no-op behavior from `backend/src/routes/workflows.ts`.
- [ ] Port built-in workflow definitions from `backend/src/lib/builtinWorkflows.ts`.
- [ ] Port tabular review, prompt generation, cell generation SSE, single-cell regeneration, clear-cells, chats, messages, and tabular chat SSE behavior from `backend/src/routes/tabular.ts`.
- [ ] Port download token behavior from `backend/src/routes/downloads.ts` and `backend/src/lib/downloadTokens.ts`.
- [ ] Run the fixture replay script against the Loom backend.
- [ ] Run `go test ./...` from `backend-go`.
- [ ] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 5: Frontend Supabase Removal

Goal: Keep the current Next.js UI working while replacing direct Supabase session/profile access with local backend calls. Actively reduce Node-only and server-only usage so the M7 static-export experiment has the cleanest possible signal.

Acceptance Criteria

- `rg -n "supabase|@supabase|SUPABASE|createServerSupabase" frontend/src frontend/package.json frontend/.env.local.example` has no hits.
- `frontend/src/app/lib/mikeApi.ts` and all direct fetch call sites work without Supabase Authorization headers.
- Converted code does not import `next/headers`, use server actions, or rely on Node-only APIs. Existing usage is removed where reasonable, not just avoided in new code.
- `npm run build --prefix frontend` and `npm run lint --prefix frontend` complete.

Checklist

- [ ] Replace `frontend/src/lib/supabase.ts`, `frontend/src/lib/supabase-server.ts`, and `frontend/src/lib/auth.ts` usage with local API helpers or remove the files.
- [ ] Update `frontend/src/app/lib/mikeApi.ts` to stop attaching Supabase Authorization headers.
- [ ] Update `frontend/src/contexts/AuthContext.tsx` to provide the deterministic local user and local sign-out behavior.
- [ ] Update `frontend/src/contexts/UserProfileContext.tsx` to load and mutate profile/model/API-key data through backend profile routes.
- [ ] Remove or repurpose `frontend/src/app/login/page.tsx` and `frontend/src/app/signup/page.tsx` so local mode has no Supabase login/signup flow.
- [ ] Update `frontend/src/app/components/assistant/EditCard.tsx` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/components/assistant/AssistantMessage.tsx` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/components/shared/DocPanel.tsx` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/components/shared/DocxView.tsx` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/hooks/useDocumentVersions.ts` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/hooks/useFetchDocxBytes.ts` to use local API helpers instead of reading a Supabase session.
- [ ] Update `frontend/src/app/hooks/useFetchSingleDoc.ts` to use local API helpers instead of reading a Supabase session.
- [ ] Audit converted code for `next/headers`, server actions, and Node-only imports; remove or refactor to client + fetch where reasonable.
- [ ] Remove login/signup redirects from protected layouts while preserving route access.
- [ ] Remove `@supabase/*` dependencies and Supabase env examples from the frontend package.
- [ ] Run `rg -n "supabase|@supabase|SUPABASE|createServerSupabase" frontend/src frontend/package.json frontend/.env.local.example`.
- [ ] Run `npm run build --prefix frontend`.
- [ ] Run `npm run lint --prefix frontend`.
- [ ] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 6: Local Browser Smoke Path

Goal: Prove the app runs locally without Supabase before starting Wails packaging or job-search remodeling.

Acceptance Criteria

- Backend starts with only local env values for `LUKE_DATA_DIR`, `LOCAL_STORAGE_ROOT`, and `OLLAMA_BASE_URL`.
- Frontend at `http://localhost:3000` can complete the main persisted workflows against the Loom backend using Ollama with the `gemma4` model.
- A backend restart preserves project, document, chat, workflow, and tabular review data.

Checklist

- [ ] Add root-level local development notes for starting the Loom backend and Next frontend, including Ollama setup with `gemma4` pulled.
- [ ] Start the Loom backend with `LUKE_DATA_DIR`, `LOCAL_STORAGE_ROOT`, and `OLLAMA_BASE_URL`.
- [ ] Start the frontend with `npm run dev --prefix frontend`.
- [ ] Manually create a project, upload a document, open the document, create a chat, create a workflow, create a tabular review, and generate tabular cells using the `gemma4` model.
- [ ] Restart the backend and reload the frontend.
- [ ] Confirm the project, document, chat, workflow, and tabular review are still present after restart.
- [ ] Record the smoke-test commands and observations in the pull request description.
- [ ] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.

### Milestone 7: Wails Feasibility Check

Goal: Verify the desktop packaging path before committing the product to Wails. Scope: macOS arm64 only.

Acceptance Criteria

- A Wails feasibility note states whether the current Next 16 app-router frontend can be statically exported without losing required behavior.
- If static export is not viable, the note describes the selected Wails architecture for running or embedding the frontend/server assets.
- The Wails feasibility note covers the Rust static library introduced by the persistence layer, including macOS arm64 linker flags, Rust toolchain requirements, and whether CI prebuilds the artifact.
- The Wails feasibility note records the pinned SurrealDB crate version and license/distribution implications.

Checklist

- [ ] Run the frontend export/build experiment needed to determine whether required app-router pages, dynamic routes, document viewers, and streaming API clients survive static export.
- [ ] Record which frontend features require a running Next server versus static assets.
- [ ] Choose the Wails integration shape based on the experiment: static frontend assets with Go backend APIs, or Wails app that launches/hosts a local Next server process plus the Loom backend.
- [ ] Verify macOS arm64 linker flags and prerequisite system libraries for the Rust persistence bridge in a Wails build.
- [ ] Decide whether release builds require a Rust toolchain on the developer/build machine or consume a prebuilt `libluke_surreal_bridge.a` artifact from CI.
- [ ] Record SurrealDB Rust crate version and license/distribution notes in the Wails feasibility document.
- [ ] Ask an independent agent to review the milestone work against the acceptance criteria, then address or explicitly defer each finding before marking the milestone complete.
