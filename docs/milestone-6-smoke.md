# Milestone 6 Smoke Notes

Date: 2026-05-08.

## Environment

- Backend data dir: `.tmp/m6-smoke/data`.
- Local storage root: `.tmp/m6-smoke/storage`.
- Backend address: `127.0.0.1:3001`.
- Browser automation follow-up backend address: `127.0.0.1:3011`, using
  `.tmp/m6-browser-smoke/data` and `.tmp/m6-browser-smoke/storage`, to avoid an
  existing local listener on `3001`.
- Frontend address: `http://localhost:3000`. An earlier run used
  `http://localhost:3002` because port 3000 was held by an unrelated
  `auto-k-frontend` Vite process; the final run used the milestone's expected
  port after that process was stopped.
- Ollama base URL: `http://127.0.0.1:11434`.
- Ollama model: `gemma4:latest` was already pulled and visible in `ollama list`.

## Commands

```bash
cd backend-go/internal/persistence/rustbridge
cargo build --release
```

```bash
cd backend-go
CGO_LDFLAGS="-L/Users/luca/code/luke/backend-go/internal/persistence/rustbridge/target/release" \
LUKE_DATA_DIR="/Users/luca/code/luke/.tmp/m6-smoke/data" \
LOCAL_STORAGE_ROOT="/Users/luca/code/luke/.tmp/m6-smoke/storage" \
OLLAMA_BASE_URL="http://127.0.0.1:11434" \
LUKE_BACKEND_ADDR="127.0.0.1:3001" \
go run ./cmd/luke-backend
```

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3001" npm run dev --prefix frontend
```

Browser automation follow-up:

```bash
cd backend-go
CGO_LDFLAGS="-L/Users/luca/code/luke/backend-go/internal/persistence/rustbridge/target/release" \
LUKE_DATA_DIR="/Users/luca/code/luke/.tmp/m6-browser-smoke/data" \
LOCAL_STORAGE_ROOT="/Users/luca/code/luke/.tmp/m6-browser-smoke/storage" \
OLLAMA_BASE_URL="http://127.0.0.1:11434" \
LUKE_BACKEND_ADDR="127.0.0.1:3011" \
go run ./cmd/luke-backend
```

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3011" npm run dev --prefix frontend
```

```bash
LUKE_SMOKE_API="http://127.0.0.1:3011" \
npm exec --yes --package playwright -- bash -lc \
'NODE_PATH="$(dirname "$(dirname "$(which playwright)")")" node scripts/m6-browser-smoke.js'
```

```bash
CGO_LDFLAGS="-L/Users/luca/code/luke/backend-go/internal/persistence/rustbridge/target/release" \
go test ./internal/localapi
```

## Observations

- The first backend start failed until the Rust bridge static library was built;
  the README now documents that prerequisite.
- The frontend dev server started successfully but selected port 3002 because
  port 3000 was occupied by an unrelated local app. `curl` confirmed `/assistant`
  and `/projects` served Next HTML on port 3002.
- `curl` confirmed `/projects` served Next HTML on `http://localhost:3000`
  with the projects page chunk present.
- The first smoke created project `project_didk3c6jerog_6b7d83f9`, uploaded document
  `doc_didk3c6rq1lk_4afd97c6`, opened the document display route, created chat
  `chat_didk3c7472q0_f1c212e5`, created workflow
  `workflow_didk3h48eqhc_3bf5fa20`, created tabular review
  `review_didk3h4cq1j4_9bdf5ccf`, and generated one tabular cell with live
  Ollama `gemma4`.
- The final `localhost:3000` smoke created project
  `project_didk7959gv9k_5e2446b6`, uploaded document
  `doc_didk795hams8_0115a7a1`, opened the document display route, created chat
  `chat_didk7967zh28_b8469e56`, created workflow
  `workflow_didk7d6yq8io_a87ce015`, created tabular review
  `review_didk7d72xa0o_952ce599`, and generated one tabular cell with live
  Ollama `gemma4`.
- Chat streaming returned event types `chat_id`, multiple `content_delta`
  events, `citations`, and `done`.
- Tabular generation returned `cell_update` and `done`.
- After backend restart with the same data dirs, both smoke runs preserved their
  project, document, chat with two messages, workflow, tabular review, one
  review document, and one generated cell.
- Playwright/Chromium browser automation opened `http://localhost:3000/projects`,
  completed project creation, project document upload, project chat SSE stream,
  workflow creation, tabular review creation, tabular generation SSE stream,
  hydrated project page load, project page reload, and hydrated tabular review
  page load against the Loom backend. It verified browser-side `ReadableStream`
  SSE consumption and persisted data readback.
- Browser automation created project `project_didlb4jorl68_7a1cd44f`, uploaded
  document `doc_didlb4jumhrk_368a6d77`, created chat
  `chat_didlb4k5xphk_ccece394`, created workflow
  `workflow_didlb640chrs_ccdd0052`, created tabular review
  `review_didlb644u1cw_aea06156`, received chat event types `chat_id`,
  multiple `content_delta`, `citations`, and `done`, and received tabular event
  types `cell_update` and `done`. Readback showed one persisted document, two
  persisted chat messages, and one persisted tabular cell.

## Compatibility Fixes Made During Smoke

- Added frontend-compatible Go backend routes for `GET /chat`, `POST
  /chat/create`, `GET/PATCH/DELETE /chat/:chatId`.
- Changed `POST /projects/:projectId/documents` to accept multipart project
  uploads and added `POST /projects/:projectId/documents/:documentId` for
  existing-document attach.
- Added `POST /single-documents/download-zip` as the frontend-compatible zip
  route while keeping the existing `/single-documents/zip` path.
- Fixed frontend tabular generation to send `document_ids` and `column_indices`
  from the review page, and updated Go SSE `cell_update` events with top-level
  `column_index` and `content` fields consumed by the React table.
- Added frontend-compatible `DELETE /user/account` and `/users/account` routes.
- Honored `?type=` on `GET /workflows` so assistant and tabular workflow lists
  remain separated.
- Honored `project_id` in `POST /chat/create`.
- Allowed local browser CORS preflights for W3C trace headers emitted by the
  frontend telemetry instrumentation.
