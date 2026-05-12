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

## Local Browser Development

Local-first development uses the Loom Go backend, embedded SurrealKV/Romancy
state, local file storage, the Next.js browser frontend, and Ollama by default.

Run the app:

```bash
./dev
```

This installs frontend dependencies if needed, builds the Rust SurrealDB bridge
if needed, starts the Go backend and Next frontend, picks free local ports, and
opens the browser. If Ollama is installed, it also starts Ollama when needed and
pulls the default `gemma4` model when missing. Press Ctrl-C in that terminal to
stop the processes it started.
Set `LUKE_OPEN_BROWSER=0` to skip opening the browser automatically.

The backend data directory is durable and defaults to `.tmp/luke-local`. Set
`LUKE_DEV_ROOT=/path/to/dev-state` to use a different local data directory.
Set `LUKE_SKIP_OLLAMA=1` to skip Ollama startup and model checks.
On macOS, `./dev` builds the Rust bridge and Go backend with the same
deployment target, defaulting to the installed macOS SDK platform version, to
avoid linker version-warning spam. Override with
`LUKE_MACOSX_DEPLOYMENT_TARGET=26.2` only when needed.

Manual commands, when debugging startup:

```bash
npm install --prefix frontend
```

Build the Rust SurrealDB bridge:

```bash
cd backend-go/internal/persistence/rustbridge
cargo build --release
cd ../../..
```

Start the Loom backend from `backend-go`:

```bash
CGO_LDFLAGS="-L$(pwd)/internal/persistence/rustbridge/target/release" \
LUKE_DATA_DIR="$PWD/../.tmp/luke-local/data" \
LOCAL_STORAGE_ROOT="$PWD/../.tmp/luke-local/storage" \
OLLAMA_BASE_URL="http://127.0.0.1:11434" \
LUKE_BACKEND_ADDR="127.0.0.1:3001" \
go run ./cmd/luke-backend
```

Start the frontend from the repo root:

```bash
NEXT_PUBLIC_API_BASE_URL="http://127.0.0.1:3001" npm run dev --prefix frontend
```

Open `http://localhost:3000`. If port 3000 is already in use, Next will choose
the next available port and print it in the terminal.

The backend data directory is durable. Stop and restart the backend with the
same `LUKE_DATA_DIR` and `LOCAL_STORAGE_ROOT` to verify that projects,
documents, chats, workflows, and tabular reviews persist.

## Checks

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only.
