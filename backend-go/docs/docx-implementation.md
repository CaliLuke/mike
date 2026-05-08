# DOCX Implementation Note

Milestone 4 keeps document byte storage local and preserves the existing
download/version response shapes. The Go backend uses lightweight local
conversion paths instead of requiring LibreOffice for the browser-local backend.

## Current Paths

- `GET /single-documents/:documentId/docx` returns the stored version bytes with
  the DOCX content type. It does not transform bytes.
- `GET /download/:token` returns bytes from local storage using the token payload
  storage path.
- `POST /single-documents` and `POST /projects/:projectId/upload` persist bytes
  through the Romancy document-upload workflow and local atomic file writes.
- `POST /single-documents/:documentId/versions` writes a new local version
  directly and updates `documents.current_version_id`.
- `GET /single-documents/:documentId/display` returns text for text-like files
  and extracts visible text from `word/document.xml` for `.docx` files. Other
  binary formats fall back to stored bytes with an octet-stream content type.
- `POST /edits/:editId/accept` and `POST /edits/:editId/reject` read the source
  DOCX bytes, apply a raw OOXML tracked-change fallback, write a new document
  version, update `documents.current_version_id`, and preserve edit status,
  `change_id`, `del_w_id`, and `ins_w_id` fields on the edit record.

## wordZero Evaluation

`github.com/zerx-lab/wordZero` was evaluated at the code-fit level during M4.
The current milestone does not introduce new DOCX generation, template rendering,
markdown-to-DOCX, table creation, or structured DOCX authoring paths. The
load-bearing M4 operations are byte-preserving downloads, display extraction, and
tracked-edit accept/reject semantics over existing stored versions.

No M4 route currently uses `wordZero`. Using it for tracked edits would require
proving that it preserves the existing `document_edits` identifiers and
version-resolution semantics; that proof is deferred until a future generated
document/template milestone needs a richer DOCX library.

## Fallback Rule

Use raw zip/XML OOXML manipulation for tracked-edit compatibility until a Go DOCX
library can preserve the current edit-resolution contract. Use a richer DOCX
library only for new generation paths that can preserve existing download and
version response shapes.
