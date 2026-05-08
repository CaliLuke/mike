I now have a full picture. Here is my final sign-off report.

---

## Milestone 4 Final Sign-off Review

**Scope reviewed:** `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md`, `backend-go/cmd/luke-backend`, `backend-go/internal/localapi`, `backend-go/internal/localdata`, `backend-go/testdata/compat`, `backend-go/docs/docx-implementation.md`, `backend-go/docs/localdata-m4-api-review.md`, `backend-go/docs/localdata-m4-completion-review.md`, `backend-go/docs/localdata-m4-fix-verification-review.md`

---

### Verification of every prior blocker

| Prior finding | Claimed fix | Evidence (file:line) | Verified |
|---|---|---|---|
| B1: resolveEdit silently accepts when file missing | Return 500 if readErr != nil | `repository.go:258-262` — readErr check before any write | ✓ |
| B2: tabularGenerate hardcoded stub | Call completeText per cell | `api.go:674` — `s.completeText(r.Context(), completionRequest{...})` | ✓ |
| H1: XML rewrite uses regex | Replace with encoding/xml token stream | `docx.go:118-186` — `xml.NewDecoder/NewEncoder`; test at `api_test.go:92` | ✓ |
| H2: Chat persist context-cancel window | context.WithoutCancel + 10s timeout | `repository.go:384,450` — `context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)` | ✓ |
| H3: seedBuiltinWorkflows resets created_at | Use updateQuery (no created_at) vs createQuery | `schema.go:48-73` — `createQuery()` sets it once, `updateQuery()` omits it entirely | ✓ |
| Medium: 422 when no tracked change found | Check changed return from applyTrackedChange | `repository.go:269-272` — `if !changed { writeError(w, http.StatusUnprocessableEntity, ...) }` | ✓ |
| Medium: upsertWorkflow resets created_at on PUT/PATCH | UPDATE SET for existing, CREATE for new | `repository.go:506-516` — `UPDATE %s SET ... is_system = false;` with no `created_at`; fallback UPSERT only runs when record doesn't exist | ✓ |
| Low M1: DOCX fixture not verified as valid ZIP | Add TestCompatSampleDocxIsReadable | `api_test.go:104-119` — opens as zip.NewReader, asserts word/document.xml present | ✓ |
| Low M2: Tabular chat fixture missing model field | Add "model": "gemma4" to fixture body | `sse-tabular-chat.json:8` — `"model": "gemma4"` is present | ✓ |
| M2: tabularChatStream ignores model | Add Model *string field, pass through | `api.go:741-742,761` — decoded and forwarded | ✓ |
| M3: newID timestamp-only collision | Append 4 crypto/rand bytes | `repository.go:711-717` — `crypto/rand.Read` suffix appended | ✓ |

`sample.docx` physically verified as a valid ZIP with `word/document.xml` present (`unzip -t` clean, no errors).

---

### New findings during this review

#### LOW — `upsertTabularReview` resets `created_at` on every PATCH

- **File/line:** `repository.go:566-578` — `UPSERT %s CONTENT { ... created_at: time::now(), updated_at: time::now() }`
- `UPSERT ... CONTENT` replaces the entire record; `created_at` is overwritten on every `PATCH /tabular-review/:reviewId`.
- **Why it matters:** This is the exact same pattern that was a MEDIUM fix for `upsertWorkflow`. However, the impact is lower here because the tabular review list query orders by `updated_at DESC` (not `created_at`), and no M4 AC requires `created_at` preservation on review updates.
- **Not a blocker.** Recommend fixing in M5 as a parallel to the workflow fix (use `UPDATE ... SET` for existing reviews, reserve `UPSERT CONTENT` only for new ones).

---

### Acceptance criteria cross-check

| M4 AC | Coverage | Status |
|---|---|---|
| Fixture replay passes for JSON, upload/download, SSE | `replay.mjs` + documented passing run; `setup.mjs` uploads valid `sample.docx` | Satisfied |
| Document upload, version listing, display/download, project folders, chat history, workflows, tabular reviews, tabular chat complete | Handlers present for all paths; integration test covers SSE persistence, display, workflow seed | Satisfied |
| Ollama is default model path; hosted providers deferred; mock covers shared path | `llm.go:40-84` — mock short-circuits at top, Ollama below, claude/gemini return deferred error | Satisfied |
| DOCX implementation note naming wordZero decision and OOXML fallback | `backend-go/docs/docx-implementation.md` present and complete | Satisfied |

---

### Documented deferrals confirmed still valid

- Hosted Claude/Gemini live calls: explicitly blocked at `llm.go:48,82` with a descriptive error; mock mode covers the shared path.
- `chatTools.ts` full legal tool set: plan records this at `localdata-m4-api-review.md:92`.
- `wordZero` adoption: `docx-implementation.md` names no M4 route uses it; rule documented.
- Coverage floor: 47.3% against 80% default; `COVERAGE_MIN=44` override documented; no fixture-replay or `go test ./...` gate fails.

---

### Residual risks (non-blocking)

1. Complex nested XML tracked changes (e.g., revision marks inside tables, `mc:AlternateContent` blocks) are not tested; the `encoding/xml` path handles flat cases correctly.
2. `tabular_reviews.document_count` hardcoded to `0` in the list query (`api.go:592`); detail view is accurate.
3. Handler test gaps: folder CRUD, zip download, download-token redirect, workflow share no-ops, tracked-change IDs have no handler tests; documented in the disposition.
4. `upsertTabularReview` `created_at` reset on PATCH (new, LOW, described above).

---

## MILESTONE 4 COMPLETE

All acceptance criteria are satisfied. Every blocker from the completion review and the fix-verification review is confirmed present and correct in the working tree. The only uncommitted change is to `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md` (plan wording). The one new LOW finding (`upsertTabularReview` `created_at` reset) does not block completion and is recommended for M5 cleanup.

The remaining unchecked plan item — `[ ] Ask an independent reviewer for final sign-off` at `LOCAL_JOB_WORKBENCH_MIGRATION_PLAN.md:212` — should be checked now that this review confirms no blockers remain.
