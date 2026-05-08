# Milestone 6 Final Review

Date: 2026-05-08.

Reviewer: Claude Code CLI via `.agents/skills/claude-review-delegation`.

## Review Inputs

- `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`
- `docs/milestone-6-smoke.md`
- `.tmp/claude-reviews/local-browser-m6-review.md`
- `.tmp/claude-reviews/local-browser-m6-final-review.md`
- Current diff for local API compatibility, local CORS, frontend tabular
  generation, and smoke documentation.

## Initial Findings And Disposition

- `streamTabularGeneration` sent no body and the backend returned HTTP 400.
  Fixed by sending `document_ids` and `column_indices` from the frontend and
  covering the stream shape in `TestLocalAPIChatAndTabularStreamsPersistMessages`.
- `DELETE /user/account` had no Go backend route. Fixed by adding
  `/user/account` and `/users/account` aliases and test coverage.
- `GET /workflows?type=` was ignored by the backend. Fixed by applying a
  type filter in the list query and testing assistant/tabular separation.
- The first smoke was HTTP-level rather than browser-level. Fixed by adding and
  running a Playwright/Chromium browser smoke that opens `http://localhost:3000`,
  consumes SSE streams in the browser runtime, verifies DOM content, and checks
  persisted records.
- `POST /chat/create` ignored `project_id`. Fixed by decoding the request body
  and verifying project chat list membership in test coverage.

## Final Review Result

The final reviewer stated:

> MILESTONE 6 COMPLETE / no blockers remain.

The reviewer confirmed all Milestone 6 acceptance criteria pass:

- Backend starts with local env values for data dir, storage root, and Ollama.
- Frontend at `http://localhost:3000` completes the main persisted workflows
  against the Loom backend using Ollama `gemma4`.
- Backend restart preserves project, document, chat, workflow, and tabular
  review data.

## Deferred Non-Blockers

- Single-cell tabular regeneration currently sets `content` to the whole
  response object instead of `result.summary`. This is outside the M6 smoke path
  and should be fixed before user-facing release.
- `GET /tabular-review?project_id=` is still not filtered by the backend. This
  is outside the M6 acceptance path but should be fixed before larger review
  lists make project-scoped views misleading.

## Checks

- `npm run build --prefix frontend`
- `npm run lint --prefix frontend` exits 0 with existing warnings.
- `CGO_LDFLAGS="-L/Users/luca/code/luke/backend-go/internal/persistence/rustbridge/target/release" go test ./internal/localapi ./internal/localdata`
- Playwright/Chromium smoke via `scripts/m6-browser-smoke.js`
- `backend-go/check.sh` was run; all gates before coverage passed, and the
  historical repository-wide coverage floor still fails at 51.1% versus the
  default 80% threshold. This remains the same documented non-M6 blocker from
  earlier milestones.
