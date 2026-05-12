# Repository Guidelines

## Project Structure & Module Organization

This repository is the Luke codebase: a local-first, single-user AI workbench for a job search. Applications represent positions being pursued, and the long-term architecture is a Next.js frontend, a Loom-designed Go backend, embedded SurrealDB/SurrealKV persistence, local file storage, Ollama-first AI, optional hosted model keys, and Wails packaging after the local browser app is stable.

Current package layout:

- `frontend/`: Next.js 16 application. App routes live in `frontend/src/app`, shared UI in `frontend/src/components/ui`, feature components in `frontend/src/app/components`, contexts in `frontend/src/contexts` and `frontend/src/app/contexts`, and static assets in `frontend/public`.
- `backend-go/`: Active Loom Go backend. Treat Loom design files as the source of truth; generated `gen/` files must be regenerated, not hand-edited.

Keep frontend-only utilities under `frontend/src/lib`. Keep Go backend business logic outside generated Loom code. Avoid cross-package imports; use API boundaries instead.

## No Shims, No Hacks

Do not solve migrations or product terminology changes with compatibility shims, aliases, duplicate routes, fallback wrappers, hidden adapter layers, or "temporary" hacks. When a concept is renamed or replaced, rewrite the code, routes, API contracts, generated design, tests, docs, and UI to the new concept directly. Remove the old names instead of preserving them as compatibility paths. If existing persisted local data needs migration, implement an explicit data migration with clear ownership and tests; do not keep the old model alive through aliases.

This rule is categorical. Do not add compatibility shims unless the user explicitly asks for a backwards-compatibility layer in that exact task.

## Build, Test, and Development Commands

Install dependencies:

```bash
npm install --prefix frontend
```

Run locally:

```bash
./dev
```

The active backend is `backend-go`; the `./dev` launcher starts the Go backend and Next frontend together, picks free local ports, and opens the browser. Use manual `backend-go` and `frontend` commands only when debugging startup behavior.

Required checks before submitting changes:

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```

## Coding Style & Naming Conventions

Use TypeScript for the frontend and Go for the Loom backend. Match the existing TypeScript style: two-space indentation in frontend files, semicolons, double quotes, and named exports where local patterns already use them. React components use `PascalCase` filenames and exports, hooks use `useCamelCase`, and route files follow Next.js conventions such as `page.tsx` and `layout.tsx`.

Frontend linting uses ESLint 9 with `eslint-config-next/core-web-vitals` and TypeScript rules. For the Loom backend, use `gofmt` and regenerate generated code after design changes.

## Assistant Chat UI: lean on assistant-ui

The assistant chat (`/assistant-next` and the application-scoped variant) is built on the [`@assistant-ui/react`](https://www.assistant-ui.com/) library. When extending or modifying chat surfaces, **prefer the library's primitives and patterns over hand-rolled components**:

- **Composer extensions**: build on `ComposerPrimitive` (e.g. `ComposerPrimitive.Unstable_TriggerPopover` for slash/mention menus, `ComposerPrimitive.AddAttachment`, `ComposerPrimitive.Send`/`Cancel`). Don't replace the composer wholesale — extend it.
- **Message rendering**: route per-event UI through `makeAssistantToolUI({ toolName, render })` so the polished `Thread`'s `GroupedParts` picks the renderer up automatically. Add new SSE event types to the tool-name set rather than special-casing them in a custom message renderer.
- **State**: keep our `useAssistantChat` hook as the single source of truth and feed assistant-ui via `useExternalStoreRuntime`. Don't introduce a second message store. For composer-adjacent state (pending workflow, side panel tabs, model selection), use small context providers mounted inside the runtime tree.
- **Side panels, modals, dialogs**: reuse the shadcn primitives (`@/components/ui/*`) that the assistant-ui registry installs — `Avatar`, `Dialog`, `Tooltip`, `DropdownMenu`, etc. Don't re-implement them.
- **Layout overrides on `thread.tsx`**: that file lives at `src/components/assistant-ui/thread.tsx`; it's owned (shadcn-installed) so customisation is expected, but keep edits surgical and prefer extracting into spike-folder components (e.g. `(pages)/assistant-next/*`) wired in via imports.
- **Defer to the library's accessibility/keyboard behaviour**: the trigger popover handles arrow-key nav, Enter/Escape, etc. Don't shadow it.

Before adding a new chat surface, check whether assistant-ui already exposes a primitive for it (search `@assistant-ui/react/dist/primitives` or the `llms.txt` docs). Hand-rolling is a fallback, not the default.

## Testing Guidelines

There is currently no dedicated TypeScript test script or test framework configured. For now, treat TypeScript builds and frontend linting as the required regression checks. When adding frontend or transitional Express tests, colocate them near the code they cover using a clear pattern such as `*.test.ts` or `*.test.tsx`, and add the corresponding package script in `package.json`.

For the Loom backend, add Go tests near the package they cover and run `go test ./...` from `backend-go`. Compatibility work should preserve the current REST/SSE contract captured in `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`.

## Quality Gates

- `./check.sh` from `backend-go` runs the full Go backend gate.
- `./check.sh --fix` from `backend-go` applies goimports and lint autofixes before checking.
- `make tools` from `backend-go` installs pinned Go gate tools from `tools.go`.
- `./check.sh` from `frontend` runs the full frontend gate (typecheck, eslint, prettier, jscpd, knip, next build). `--fix` applies eslint and prettier autofixes. `SKIP_BUILD=1` skips the next build step.
- `prek run` from the repo root runs the fast staged-file hooks. `prek install` wires it into git.

Full Go gates: Rust bridge build when missing, Loom generated-code freshness, Go build, vet, goimports, go mod tidy drift, golangci-lint, deadcode, dupl, gocyclo, govulncheck, race tests, and coverage. Set `COVERAGE_MIN` to override the default 80% floor.

Full frontend gates: `tsc --noEmit`, ESLint with `--max-warnings=0` (strict: max-lines 500, no-explicit-any, no-console, exhaustive-deps as errors), Prettier `--check`, jscpd duplication (2% threshold), knip dead-code/unused-deps, and `next build`. Pre-commit (prek) runs prettier + eslint on staged frontend files plus a full `tsc --noEmit`; pre-push adds knip.

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

### Browser Runtime Errors

The frontend telemetry bootstrap also captures uncaught browser errors and forwards them as spans. `installErrorReporter()` in `frontend/src/app/lib/telemetry.ts` hooks three sinks; each emits a span with `status='2'` (Error), an `error.message` attribute, a `page.url`, and an `error.stack` / `error.name` when an `Error` instance is available:

- `frontend.runtime_error` — `window.onerror`. Carries `error.source`, `error.line`, `error.col`.
- `frontend.unhandled_rejection` — `window.onunhandledrejection`.
- `frontend.console_error` — a patched `console.error`. React's dev-time error overlay routes here, so Next.js runtime overlay errors land in this bucket too.

Pull the latest browser errors instead of asking the user to paste a stack trace:

```bash
DB="$LUKE_DATA_DIR/telemetry.sqlite"
sqlite3 -column -header "$DB" "
  SELECT datetime(start_unix_nano/1000000000,'unixepoch','localtime') AS at,
         name,
         json_extract(attributes,'\$.\"error.message\"') AS message,
         json_extract(attributes,'\$.\"page.url\"')      AS url
    FROM spans
   WHERE service='luke-frontend' AND status='2'
   ORDER BY id DESC
   LIMIT 20"
```

Drill into one error's stack:

```bash
sqlite3 -column -header "$DB" "
  SELECT json_extract(attributes,'\$.\"error.stack\"')
    FROM spans WHERE id=<SPAN_ID>"
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

Never bypass git hooks with `--no-verify` unless the user explicitly authorizes that exact bypass for the current command. If a hook fails, stop and report the failing hook, the relevant error output, and the safest fix or next action instead of committing through it.

Pull requests should include a short description, the affected package (`frontend`, `backend`, `backend-go`, or multiple), setup or migration notes, linked issues when applicable, and screenshots for visible UI changes. Include the exact checks you ran.

## Security & Configuration Tips

Copy environment templates before local development:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Do not commit secrets. The default Luke development path uses the local Go backend, local storage, embedded data, and Ollama.

PDF text extraction shells out to `spdf` (Rust binary that embeds PDFium). Install once per dev machine:

```bash
cargo install spdf-cli --version 0.2.0-alpha.2
```
