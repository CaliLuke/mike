# Luke

Luke is a local-first AI workbench for running a serious job search. It is designed around one person, their work history, and the positions they are applying for.

The goal is to turn every application into a focused workspace: collect the job description, company research, resume drafts, cover letters, recruiter notes, interview prep, interview feedback, and the evidence from the user's career that should shape each answer. Over time, Luke should build a reusable vault of work experience, accomplishments, projects, writing samples, and interview stories that an agent can draw from when tailoring resumes or reviewing interview performance.

## Product Direction

Luke is a batteries-included local application with a simple operating model:

- Single-user by default.
- Local data persistence with embedded SurrealDB and SurrealKV.
- Local file storage for resumes, job descriptions, notes, exports, and generated documents.
- Local-first AI through Ollama, with optional hosted Claude and Gemini keys.
- A design-driven Go backend built with Loom.
- A desktop shell through Wails after the local browser version is stable.

The implementation plan is tracked in [`LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`](./LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md).

## Core Use Case

Luke should help one person answer four recurring job-search questions:

- What do I know about this position, company, and hiring process?
- Which parts of my experience are most relevant here?
- What resume, cover letter, portfolio notes, and interview stories should I use?
- How did the interviews go, and what should I improve before the next round?

In Luke, a project represents a position being pursued. The knowledge vault represents the user's reusable career context: roles, responsibilities, achievements, metrics, projects, technologies, domain experience, leadership examples, conflict stories, failures, writing samples, and prior application material.

## Current Development Setup

Local development currently uses the existing Next.js and Express packages.

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Current Required Services

The current setup expects:

- Supabase Auth and Postgres.
- S3-compatible object storage, such as Cloudflare R2, or the backend local-storage fallback where supported.
- At least one supported model provider key, depending on which models are enabled.
- LibreOffice for DOC/DOCX to PDF conversion.

Luke's local-first architecture removes Supabase and required cloud object storage from the default path.

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only.
