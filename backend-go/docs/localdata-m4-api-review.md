# Milestone 4 API Review

Review requested from Claude Code on 2026-05-07 using:

```bash
.agents/skills/claude-review-delegation/scripts/claude-review.sh \
  --name localdata-m4-api-review \
  --scope backend-go/cmd/luke-backend,backend-go/internal/localapi,backend-go/internal/localdata,LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md \
  --basis LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md \
  --focus "Review the current Milestone 4 implementation work from a read-only stance..."
```

Claude's original full output is stored at
`backend-go/docs/localdata-m4-api-review-full.md`.

A completion review was requested from Claude Code on 2026-05-08 after the M4
implementation pass. Its output is stored at
`backend-go/docs/localdata-m4-completion-review.md`.

A follow-up fix verification review was requested from Claude Code on 2026-05-08.
Its output is stored at
`backend-go/docs/localdata-m4-fix-verification-review.md`.

A final sign-off review was requested from Claude Code on 2026-05-08. Its output
is stored at `backend-go/docs/localdata-m4-final-signoff-review.md`, and it
explicitly declares `MILESTONE 4 COMPLETE`.

## Disposition

The original review correctly found that the first M4 slice was structural only.
The implementation has since closed the M4 blockers that affect fixture replay
and local browser compatibility:

- Added `backend-go/testdata/compat/scripts/setup.mjs` to create fixture IDs for
  parameterized replay.
- Added the runnable Go backend entrypoint and local API handler layer.
- Wired local model routing through one provider path with deterministic
  `LUKE_MOCK_LLM=1` output and Ollama as the default live local provider.
- Added durable global, project, and tabular chat message persistence for SSE
  routes.
- Added local display conversion for text-like files and `.docx` text extraction.
- Added raw OOXML tracked-change accept/reject that writes resolved versions and
  preserves edit metadata/status fields.
- Seeded built-in workflows on startup.
- Added local API handler tests covering fixture-relevant SSE persistence,
  uploads, display, and workflow seeding.
- Added `backend-go/docs/docx-implementation.md` with the `wordZero` decision and
  raw OOXML fallback rule.

The 2026-05-08 completion review found additional blockers and high-priority
risks. Disposition:

- Fixed: edit resolution now fails if source bytes are missing instead of
  marking an edit accepted/rejected without a resolved version.
- Fixed: tabular cell generation now calls the shared provider path and the
  mock provider in fixture mode, matching single-cell regeneration.
- Fixed: tracked-change XML rewriting now uses `encoding/xml` token streaming
  instead of regular expressions.
- Fixed: chat and tabular-chat message inserts use a non-cancelled short timeout
  context after the SSE `done` event.
- Fixed: built-in workflow seeding preserves original `created_at` on restart.
- Fixed: compatibility setup now uploads a minimal valid `.docx` for the DOCX
  download fixture.
- Fixed: tabular chat accepts and forwards a request `model` field.
- Fixed: generated local record IDs include a random suffix.

The follow-up verification confirmed those fixes and identified two remaining
medium issues plus fixture coverage gaps. Disposition:

- Fixed: edit resolution now returns `422` when the source DOCX contains no
  tracked-change markup instead of creating a no-op version.
- Fixed: user workflow updates now preserve `created_at`; only newly created
  workflows set it.
- Fixed: the DOCX fixture has a handler test sanity check proving it is a valid
  zip with `word/document.xml`.
- Fixed: the tabular-chat fixture request includes a `model` field so replay
  exercises model forwarding.

The final sign-off review found one new low, non-blocking cleanup item:
`upsertTabularReview` resets `created_at` on PATCH. Claude did not consider this
an M4 blocker because tabular review lists sort by `updated_at`; carry it into
M5 cleanup.

Remaining non-blocking items:

- Tabular review list `document_count` is still conservative and may undercount
  until route-level parity tests are expanded.
- Handler test coverage is intentionally focused on M4 fixture paths. Untested
  handler areas include folder CRUD, document-version rename, tracked-change IDs,
  zip downloads, download-token redirects, workflow share no-ops, and tabular
  regeneration.

## Explicit Deferrals

- Hosted Claude and Gemini calls are routed as provider choices but are not
  exercised against live APIs in M4 to avoid spend. Fixture and handler tests
  use the same provider path through `LUKE_MOCK_LLM=1`.
- `wordZero` is not used by any M4 route because M4 has no new DOCX generation or
  template paths. Tracked edits stay on the raw OOXML fallback until a library can
  prove it preserves the current edit-resolution contract.
- Deep `chatTools.ts` tool behavior remains a later job-search/domain milestone.
  M4 preserves the chat and SSE contract, stores turns locally, and routes model
  output, but does not reimplement the full legal-document tool set.
- Full `./check.sh` still fails only the historical repository-wide coverage
  floor after adding the broad local API package. The M4 verification gate is the
  fixture replay script plus `go test ./...`; the full gate passes with the
  temporary documented coverage override `COVERAGE_MIN=44`.

## Checks Run

- `CGO_LDFLAGS=-L/Users/luca/code/luke/backend-go/internal/persistence/rustbridge/target/release go test ./...`
- Fixture setup and replay against `cmd/luke-backend` with `LUKE_MOCK_LLM=1`:
  JSON health/profile, upload, DOCX download, global chat SSE, project chat SSE,
  tabular generate SSE, and tabular chat SSE all passed.
- `./check.sh` from `backend-go` passed every gate through tests but failed total
  coverage at `44.9%` against the default `80.0%` floor.
- `COVERAGE_MIN=44 ./check.sh` from `backend-go` passed all gates after fixing
  the completion-review findings. The final run reported `47.3%` total
  coverage.
