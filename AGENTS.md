# Repository Guidelines

## Project Structure & Module Organization

This repository contains two TypeScript packages:

- `frontend/`: Next.js 16 application. App routes live in `frontend/src/app`, shared UI in `frontend/src/components/ui`, feature components in `frontend/src/app/components`, contexts in `frontend/src/contexts` and `frontend/src/app/contexts`, and static assets in `frontend/public`.
- `backend/`: Express API. The entrypoint is `backend/src/index.ts`, route handlers are in `backend/src/routes`, shared services are in `backend/src/lib`, auth middleware is in `backend/src/middleware`, and Supabase schema setup is in `backend/migrations/000_one_shot_schema.sql`.

Keep frontend-only utilities under `frontend/src/lib` and backend-only utilities under `backend/src/lib`. Avoid cross-package imports; use API boundaries instead.

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

Required checks before submitting changes:

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## Coding Style & Naming Conventions

Use TypeScript throughout. Match the existing style: two-space indentation in frontend files, semicolons, double quotes, and named exports where local patterns already use them. React components use `PascalCase` filenames and exports, hooks use `useCamelCase`, and route files follow Next.js conventions such as `page.tsx` and `layout.tsx`.

Frontend linting uses ESLint 9 with `eslint-config-next/core-web-vitals` and TypeScript rules. Backend formatting is supported by Prettier, but no format script is currently defined.

## Testing Guidelines

There is currently no dedicated test script or test framework configured. For now, treat TypeScript builds and frontend linting as the required regression checks. When adding tests, colocate them near the code they cover using a clear pattern such as `*.test.ts` or `*.test.tsx`, and add the corresponding package script in `package.json`.

## Commit & Pull Request Guidelines

Git history is minimal and uses short, imperative summaries, for example `Add local repo contents`. Keep commits focused and use concise subject lines.

Pull requests should include a short description, the affected package (`frontend`, `backend`, or both), setup or migration notes, linked issues when applicable, and screenshots for visible UI changes. Include the exact checks you ran.

## Security & Configuration Tips

Copy environment templates before local development:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Do not commit secrets. Local development requires Supabase, S3-compatible storage, at least one model provider key, and LibreOffice for DOC/DOCX conversion.
