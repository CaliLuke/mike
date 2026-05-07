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
