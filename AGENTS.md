# Repository Guidelines

## Project Structure & Module Organization

This repository is the Luke codebase: a local-first, single-user AI workbench for a job search. Projects represent positions being pursued, and the long-term architecture is a Next.js frontend, a Loom-designed Go backend, embedded SurrealDB/SurrealKV persistence, local file storage, Ollama-first AI, optional hosted model keys, and Wails packaging after the local browser app is stable.

Current package layout:

- `frontend/`: Next.js 16 application. App routes live in `frontend/src/app`, shared UI in `frontend/src/components/ui`, feature components in `frontend/src/app/components`, contexts in `frontend/src/contexts` and `frontend/src/app/contexts`, and static assets in `frontend/public`.
- `backend/`: Transitional Express API used as the compatibility oracle while the Loom Go backend is built. The entrypoint is `backend/src/index.ts`, route handlers are in `backend/src/routes`, shared services are in `backend/src/lib`, auth middleware is in `backend/src/middleware`, and the current database schema is in `backend/migrations/000_one_shot_schema.sql`.
- `backend-go/`: Target Loom Go backend location. Treat Loom design files as the source of truth once this package exists; generated `gen/` files must be regenerated, not hand-edited.

Keep frontend-only utilities under `frontend/src/lib`. Keep transitional TypeScript backend utilities under `backend/src/lib`, and new Go backend business logic outside generated Loom code. Avoid cross-package imports; use API boundaries instead.

## Build, Test, and Development Commands

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Run locally:

```bash
npm run dev --prefix backend
npm run dev --prefix frontend
```

The backend runs with `tsx watch`; the frontend runs with `next dev` and is available at `http://localhost:3000`.

When `backend-go/` exists, prefer the commands documented there for backend development. Do not add new long-lived backend features to the Express package unless they are needed to preserve compatibility during the Loom migration.

Required checks before submitting changes:

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## Coding Style & Naming Conventions

Use TypeScript for the existing frontend and transitional Express backend. Use Go for the Loom backend. Match the existing TypeScript style: two-space indentation in frontend files, semicolons, double quotes, and named exports where local patterns already use them. React components use `PascalCase` filenames and exports, hooks use `useCamelCase`, and route files follow Next.js conventions such as `page.tsx` and `layout.tsx`.

Frontend linting uses ESLint 9 with `eslint-config-next/core-web-vitals` and TypeScript rules. Transitional Express formatting is supported by Prettier, but no format script is currently defined. For the Loom backend, use `gofmt` and regenerate generated code after design changes.

## Testing Guidelines

There is currently no dedicated TypeScript test script or test framework configured. For now, treat TypeScript builds and frontend linting as the required regression checks. When adding frontend or transitional Express tests, colocate them near the code they cover using a clear pattern such as `*.test.ts` or `*.test.tsx`, and add the corresponding package script in `package.json`.

For the Loom backend, add Go tests near the package they cover and run `go test ./...` from `backend-go`. Compatibility work should preserve the current REST/SSE contract captured in `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`.

## Quality Gates

- `./check.sh` from `backend-go` runs the full Go backend gate.
- `./check.sh --fix` from `backend-go` applies goimports and lint autofixes before checking.
- `make tools` from `backend-go` installs pinned Go gate tools from `tools.go`.
- `prek run` from the repo root runs the fast staged-file hooks.

Full gates: Rust bridge build when missing, Loom generated-code freshness, Go build, vet, goimports, go mod tidy drift, golangci-lint, deadcode, dupl, gocyclo, govulncheck, race tests, and coverage. Set `COVERAGE_MIN` to override the default 80% floor.

## Local Telemetry For Debugging

Luke has local-only OpenTelemetry instrumentation for agent-friendly debugging. The frontend sends browser spans to the Go backend, and the backend writes frontend and backend spans into SQLite at:

```bash
$LUKE_DATA_DIR/telemetry.sqlite
```

Telemetry is intended for local debugging and should be used before guessing at browser/API/SSE failures. When investigating runtime issues, start by querying this SQLite database for recent errors, slow spans, failed fetches, and trace-correlated frontend/backend activity. Do not send telemetry data to hosted services, and do not add remote collectors unless explicitly requested.

Telemetry defaults:

- Backend: enabled by default; set `OTEL_ENABLED=false` to disable.
- Frontend: enabled by default in local development; set `NEXT_PUBLIC_OTEL_ENABLED=false` to disable.
- Ingest endpoint: `POST /v1/traces` on the Go backend.
- Frontend trace propagation uses W3C headers such as `traceparent`, `tracestate`, and `baggage`.
- Retention is local and bounded; see `backend-go/internal/telemetry/telemetry.go`.

Useful queries:

```bash
DB="$LUKE_DATA_DIR/telemetry.sqlite"
sqlite3 -column -header "$DB" "SELECT name, service, kind, trace_id, start_unix_nano FROM spans ORDER BY start_unix_nano DESC LIMIT 20"
sqlite3 -column -header "$DB" "SELECT name, service, (end_unix_nano - start_unix_nano) / 1000000 AS ms FROM spans ORDER BY ms DESC LIMIT 20"
sqlite3 -column -header "$DB" "SELECT name, service, parent_span_id, start_unix_nano FROM spans WHERE trace_id = '<TRACE_ID>' ORDER BY start_unix_nano"
```

Reference docs and code:

- `docs/telemetry.md` documents the architecture, manual instrumentation, query patterns, and retention.
- `frontend/src/app/lib/telemetry.ts` and `frontend/src/app/components/TelemetryBootstrap.tsx` contain the browser setup.
- `backend-go/internal/telemetry/telemetry.go` contains the SQLite schema, retention, and span ingest/write path.
- `backend-go/cmd/luke-backend/main.go` wires telemetry into the local backend.

## Milestone Execution Discipline

When executing a milestone from `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`, do not treat checklist text as a loose suggestion. Read the whole milestone, its acceptance criteria, and any prior review documents before editing code. Keep the plan, implementation, tests, docs, and git state in sync throughout the work.

Before declaring a milestone complete:

- Every checked item in the plan must correspond to implemented, tested behavior or an explicit documented deferral to a later milestone.
- The "Current Status" section and milestone checkboxes must reflect reality, not intent.
- Backend Go milestones must pass `./check.sh` from `backend-go`, not only `go test ./...`, unless the plan explicitly documents a narrower temporary gate and why that is acceptable.
- Generated Loom code must be fresh. If `./check.sh` reports stale `gen/` output, regenerate and include it instead of ignoring the drift.
- Review docs such as `backend-go/docs/*-review.md` must state which findings were fixed, which are deferred, and why deferred items are not milestone blockers.
- Do not mark a milestone complete while required code, generated files, docs, or plan changes are unstaged or uncommitted, unless the user explicitly asked not to commit.
- If independent agents or reviewers are used, ask them for a thorough blocker-focused review against the plan, acceptance criteria, quality gates, lifecycle edge cases, persistence semantics, and git status. Do not ask only for a superficial summary.

When a reviewer calls out gaps, fix the gate failures and lifecycle or data-safety issues first, then rerun the full gate before updating the plan status. Prefer tightening the milestone wording over checking boxes for aspirational or M4-owned behavior.

## Commit & Pull Request Guidelines

Git history is minimal and uses short, imperative summaries, for example `Add local repo contents`. Keep commits focused and use concise subject lines.

Pull requests should include a short description, the affected package (`frontend`, `backend`, `backend-go`, or multiple), setup or migration notes, linked issues when applicable, and screenshots for visible UI changes. Include the exact checks you ran.

## Security & Configuration Tips

Copy environment templates before local development:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Do not commit secrets. During the transition, local development may still require Supabase, S3-compatible storage or the local-storage fallback, at least one model provider key, and LibreOffice for DOC/DOCX conversion. The target Luke architecture removes Supabase and required cloud object storage from the default development path.
