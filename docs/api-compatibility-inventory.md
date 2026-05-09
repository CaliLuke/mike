# API Compatibility Inventory

Generated for Milestone 1 from `reference/express-backend/src/index.ts`, `reference/express-backend/src/routes/*.ts`,
`reference/express-backend/src/lib/chatTools.ts`, and `frontend/src/app/lib/lukeApi.ts`.

Express mounts:

| Mount | Router file |
|---|---|
| `/chat` | `reference/express-backend/src/routes/chat.ts` |
| `/projects` | `reference/express-backend/src/routes/projects.ts` |
| `/projects/:projectId/chat` | `reference/express-backend/src/routes/projectChat.ts` |
| `/single-documents` | `reference/express-backend/src/routes/documents.ts` |
| `/tabular-review` | `reference/express-backend/src/routes/tabular.ts` |
| `/workflows` | `reference/express-backend/src/routes/workflows.ts` |
| `/user` | `reference/express-backend/src/routes/user.ts` |
| `/users` | `reference/express-backend/src/routes/user.ts` |
| `/download` | `reference/express-backend/src/routes/downloads.ts` |

`/user` is the active frontend prefix. `frontend/src/contexts/AuthContext.tsx`
posts to `/user/profile`, and `frontend/src/app/lib/lukeApi.ts` deletes
`/user/account`. `/users` has no current frontend caller and must be preserved
as a generated alias only.

## Route Inventory

| Method | Path | Router file | Frontend caller | Transport |
|---|---|---|---|---|
| GET | `/health` | `reference/express-backend/src/index.ts` | none | REST JSON |
| GET | `/chat` | `chat.ts` | `listChats` | REST JSON |
| POST | `/chat/create` | `chat.ts` | `createChat` | REST JSON |
| GET | `/chat/:chatId` | `chat.ts` | `getChat` | REST JSON |
| PATCH | `/chat/:chatId` | `chat.ts` | `renameChat` | REST JSON |
| DELETE | `/chat/:chatId` | `chat.ts` | `deleteChat` | REST JSON 204 |
| POST | `/chat/:chatId/generate-title` | `chat.ts` | `generateChatTitle` | REST JSON |
| POST | `/chat` | `chat.ts` | `streamChat` | SSE |
| POST | `/projects/:projectId/chat` | `projectChat.ts` | `streamProjectChat` | SSE |
| GET | `/projects` | `projects.ts` | `listProjects` | REST JSON |
| POST | `/projects` | `projects.ts` | `createProject` | REST JSON |
| GET | `/projects/:projectId` | `projects.ts` | `getProject` | REST JSON |
| PATCH | `/projects/:projectId` | `projects.ts` | `updateProject` | REST JSON |
| DELETE | `/projects/:projectId` | `projects.ts` | `deleteProject` | REST JSON 204 |
| GET | `/projects/:projectId/people` | `projects.ts` | `getProjectPeople` | REST JSON |
| GET | `/projects/:projectId/documents` | `projects.ts` | project document refresh callers | REST JSON |
| POST | `/projects/:projectId/documents/:documentId` | `projects.ts` | `addDocumentToProject` | REST JSON |
| POST | `/projects/:projectId/documents` | `projects.ts` | `uploadProjectDocument` | multipart upload |
| GET | `/projects/:projectId/chats` | `projects.ts` | `listProjectChats` | REST JSON |
| POST | `/projects/:projectId/folders` | `projects.ts` | `createProjectFolder` | REST JSON |
| PATCH | `/projects/:projectId/folders/:folderId` | `projects.ts` | `renameProjectFolder`, `moveSubfolderToFolder` | REST JSON |
| DELETE | `/projects/:projectId/folders/:folderId` | `projects.ts` | `deleteProjectFolder` | REST JSON 204 |
| PATCH | `/projects/:projectId/documents/:documentId/folder` | `projects.ts` | `moveDocumentToFolder` | REST JSON |
| GET | `/single-documents` | `documents.ts` | `listSingleDocuments` | REST JSON |
| POST | `/single-documents` | `documents.ts` | `uploadSingleDocument` | multipart upload |
| DELETE | `/single-documents/:documentId` | `documents.ts` | `deleteSingleDocument` | REST JSON 204 |
| GET | `/single-documents/:documentId/display` | `documents.ts` | `useFetchSingleDoc` | binary download |
| POST | `/single-documents/download-zip` | `documents.ts` | `downloadDocumentsZip` | zip download |
| GET | `/single-documents/:documentId/url` | `documents.ts` | `getDocumentUrl` | REST JSON redirect/token download envelope |
| GET | `/single-documents/:documentId/docx` | `documents.ts` | `useFetchDocxBytes`, document panels | binary download |
| GET | `/single-documents/:documentId/versions` | `documents.ts` | `listDocumentVersions`, `useDocumentVersions` | REST JSON |
| POST | `/single-documents/:documentId/versions` | `documents.ts` | `uploadDocumentVersion` | multipart upload |
| PATCH | `/single-documents/:documentId/versions/:versionId` | `documents.ts` | `renameDocumentVersion` | REST JSON |
| GET | `/single-documents/:documentId/tracked-change-ids` | `documents.ts` | `DocxView` | REST JSON |
| POST | `/single-documents/:documentId/edits/:editId/accept` | `documents.ts` | `EditCard`, `AssistantMessage`, `DocPanel` | REST JSON |
| POST | `/single-documents/:documentId/edits/:editId/reject` | `documents.ts` | `EditCard`, `AssistantMessage`, `DocPanel` | REST JSON |
| GET | `/tabular-review` | `tabular.ts` | `listTabularReviews` | REST JSON |
| POST | `/tabular-review` | `tabular.ts` | `createTabularReview` | REST JSON |
| POST | `/tabular-review/prompt` | `tabular.ts` | `generateTabularPrompt` | REST JSON |
| GET | `/tabular-review/:reviewId` | `tabular.ts` | `getTabularReview` | REST JSON |
| GET | `/tabular-review/:reviewId/people` | `tabular.ts` | `getTabularReviewPeople` | REST JSON |
| PATCH | `/tabular-review/:reviewId` | `tabular.ts` | `updateTabularReview` | REST JSON |
| DELETE | `/tabular-review/:reviewId` | `tabular.ts` | `deleteTabularReview` | REST JSON 204 |
| POST | `/tabular-review/:reviewId/clear-cells` | `tabular.ts` | `clearTabularCells` | REST JSON |
| POST | `/tabular-review/:reviewId/regenerate-cell` | `tabular.ts` | `regenerateTabularCell` | REST JSON |
| POST | `/tabular-review/:reviewId/generate` | `tabular.ts` | `streamTabularGenerate` | SSE |
| GET | `/tabular-review/:reviewId/chats` | `tabular.ts` | `listTabularChats` | REST JSON |
| DELETE | `/tabular-review/:reviewId/chats/:chatId` | `tabular.ts` | `deleteTabularChat` | REST JSON 204 |
| GET | `/tabular-review/:reviewId/chats/:chatId/messages` | `tabular.ts` | `listTabularChatMessages` | REST JSON |
| POST | `/tabular-review/:reviewId/chat` | `tabular.ts` | `streamTabularChat` | SSE |
| GET | `/workflows` | `workflows.ts` | `listWorkflows` | REST JSON |
| POST | `/workflows` | `workflows.ts` | `createWorkflow` | REST JSON |
| PUT | `/workflows/:workflowId` | `workflows.ts` | none, compatibility | REST JSON |
| PATCH | `/workflows/:workflowId` | `workflows.ts` | `updateWorkflow` | REST JSON |
| DELETE | `/workflows/:workflowId` | `workflows.ts` | `deleteWorkflow` | REST JSON 204 |
| GET | `/workflows/hidden` | `workflows.ts` | `listHiddenWorkflows` | REST JSON |
| POST | `/workflows/hidden` | `workflows.ts` | `hideWorkflow` | REST JSON 204 |
| DELETE | `/workflows/hidden/:workflowId` | `workflows.ts` | `unhideWorkflow` | REST JSON 204 |
| GET | `/workflows/:workflowId` | `workflows.ts` | `getWorkflow` | REST JSON |
| GET | `/workflows/:workflowId/shares` | `workflows.ts` | `listWorkflowShares` | REST JSON |
| DELETE | `/workflows/:workflowId/shares/:shareId` | `workflows.ts` | `deleteWorkflowShare` | REST JSON 204 |
| POST | `/workflows/:workflowId/share` | `workflows.ts` | `shareWorkflow` | REST JSON 204 |
| POST | `/user/profile` | `user.ts` | `AuthContext` | REST JSON |
| DELETE | `/user/account` | `user.ts` | `deleteAccount` | REST JSON 204 |
| POST | `/users/profile` | `user.ts` | none, alias only | REST JSON |
| DELETE | `/users/account` | `user.ts` | none, alias only | REST JSON 204 |
| GET | `/download/:token` | `downloads.ts` | download card links | redirect/token download |

The four compatibility-critical SSE routes are:

- `POST /chat`
- `POST /projects/:projectId/chat`
- `POST /tabular-review/:reviewId/generate`
- `POST /tabular-review/:reviewId/chat`

SSE responses use `Content-Type: text/event-stream`; current streams send
`data: <json>` chunks whose JSON payloads carry a `type` field, and terminate
with `data: [DONE]`. Replay ignores nondeterministic token prose and validates
event names, ordered payload types, status, content type, and payload shape.

## Chat Tool Inventory

Source: `reference/express-backend/src/lib/chatTools.ts`.

| Family | Tools / events |
|---|---|
| Document listing | `list_documents` |
| Document read/search/fetch | `read_document`, `find_in_document`, `fetch_documents` |
| Document generation | `generate_docx`; emits `doc_created` download-card event |
| Document replication | `replicate_document`; emits `doc_replicated` |
| Tracked editing | `edit_document`; emits `doc_edited` with edit annotations and download URL |
| Workflow read/apply | `list_workflows`, `read_workflow`; emits `workflow_applied` |
| Tabular context | `read_table_cells` |
| Citations | assistant citation parser emits document citation annotations; tabular chat parser emits `tabular_citation` annotations |
| Download-card events | `doc_created`, `doc_edited`, `doc_replicated` |

Milestone 4 should expand each individual tool above into its own porting and
fixture checklist item.

## Fixture Coverage

Fixture scripts and checked-in golden envelopes live in
`backend-go/testdata/compat`.

Representative checked-in envelopes:

- JSON: `json-health.json`, `json-profile.json`
- Upload: `upload-document.json`
- Binary download: `binary-docx-download.json`
- SSE: `sse-global-chat.json`, `sse-project-chat.json`,
  `sse-tabular-generate.json`, `sse-tabular-chat.json`

Parameterized fixtures intentionally keep private IDs and uploaded private bytes
out of the repository. Local capture fills those values against a working
`reference/express-backend/.env`.

## Mock Provider Mode

Set `LUKE_MOCK_LLM=1` on the Express backend to route provider adapter calls
through `reference/express-backend/src/lib/llm/mock.ts`. The switch lives in the Claude, Gemini,
and Ollama adapter modules after `reference/express-backend/src/lib/llm/index.ts` has resolved the
provider, so route handlers still exercise their normal chat, tabular, title,
and prompt paths without live Claude, Gemini, or Ollama output.
