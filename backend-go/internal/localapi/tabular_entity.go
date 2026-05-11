package localapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// tabularReviewMeta carries the small bag of fields tabular.generate needs to
// decide which generation pipeline to run.
type tabularReviewMeta struct {
	RowMode      string
	AnchorPrompt string
	ColumnSpecs  map[int]tabularColumnSpec
}

// loadTabularReviewMeta returns the row_mode + anchor extractor prompt + the
// column specs for the review. Defaults row_mode to "document".
func (s *Server) loadTabularReviewMeta(ctx context.Context, reviewID string) (tabularReviewMeta, error) {
	recID := recordID("tabular_reviews", reviewID)
	rows, err := queryRows(ctx, s.app.DB, "SELECT columns_config, row_mode, anchor_extractor FROM "+recID+";")
	if err != nil {
		return tabularReviewMeta{}, err
	}
	if len(rows) == 0 {
		return tabularReviewMeta{}, fmt.Errorf("tabular review not found: %s", reviewID)
	}
	r := rows[0]
	mode := asString(r["row_mode"])
	if mode == "" {
		mode = "document"
	}
	anchorPrompt := ""
	if anchor, ok := r["anchor_extractor"].(map[string]any); ok {
		anchorPrompt = asString(anchor["prompt"])
	}
	specs := map[int]tabularColumnSpec{}
	items, _ := r["columns_config"].([]any)
	for i, item := range items {
		m, _ := item.(map[string]any)
		idx := asInt(m["index"])
		if idx == 0 && i != 0 {
			idx = i
		}
		specs[idx] = tabularColumnSpec{
			Index:  idx,
			Name:   asString(m["name"]),
			Prompt: asString(m["prompt"]),
			Format: asString(m["format"]),
		}
	}
	return tabularReviewMeta{RowMode: mode, AnchorPrompt: anchorPrompt, ColumnSpecs: specs}, nil
}

// nextRowIndex returns the next stable ordinal for a new row in this review.
// Row indices are unique-per-review (enforced by tabular_review_rows_review_idx).
func (s *Server) nextRowIndex(ctx context.Context, reviewID string) (int, error) {
	recID := recordID("tabular_reviews", reviewID)
	rows, err := queryRows(ctx, s.app.DB, "SELECT row_index FROM tabular_review_rows WHERE review_id = "+recID+" ORDER BY row_index DESC LIMIT 1;")
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return asInt(rows[0]["row_index"]) + 1, nil
}

// upsertReviewRow inserts one entity-row record and returns its record id +
// the inserted row as a map (for echoing back via SSE). Anchor metadata is
// stored as a FLEXIBLE object so we can preserve whatever shape the extractor
// chose.
func (s *Server) upsertReviewRow(ctx context.Context, reviewID, documentID string, rowIndex int, anchor Anchor) (string, map[string]any, error) {
	rowID := newID("trow")
	recID := recordID("tabular_review_rows", rowID)
	anchorJSON, err := json.Marshal(map[string]any{
		"label":    anchor.Label,
		"summary":  anchor.Summary,
		"metadata": anchor.Metadata,
	})
	if err != nil {
		return "", nil, err
	}
	_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
		CREATE %s CONTENT {
			review_id: %s,
			document_id: %s,
			row_index: %d,
			anchor: %s,
			created_at: time::now()
		};
	`, recID, recordID("tabular_reviews", reviewID), recordID("documents", documentID), rowIndex, string(anchorJSON)))
	if err != nil {
		return "", nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, review_id, document_id, row_index, anchor, created_at FROM "+recID+";")
	if err != nil || len(rows) == 0 {
		return "", nil, err
	}
	return recID, rows[0], nil
}

// upsertReviewRowCell writes/updates one cell of an entity-mode row. Cells are
// keyed by (row_id, column_index) — see tabular_row_cells_row_col_idx.
func (s *Server) upsertReviewRowCell(ctx context.Context, rowRecID string, columnIndex int, summary, status string) (map[string]any, error) {
	existing, err := queryRows(ctx, s.app.DB, fmt.Sprintf(
		"SELECT id FROM tabular_row_cells WHERE row_id = %s AND column_index = %d LIMIT 1;",
		rowRecID, columnIndex,
	))
	if err != nil {
		return nil, err
	}
	var cellRecID string
	if len(existing) > 0 {
		if v, ok := existing[0]["id"].(string); ok {
			cellRecID = v
		}
	}
	if cellRecID == "" {
		// Compose a stable, readable id rooted at the parent row.
		// rowRecID has shape "tabular_review_rows:trow_…" — strip the prefix.
		rowSuffix := rowRecID
		if idx := strings.LastIndex(rowSuffix, ":"); idx >= 0 {
			rowSuffix = rowSuffix[idx+1:]
		}
		cellRecID = recordID("tabular_row_cells", rowSuffix+"_"+strconv.Itoa(columnIndex))
	}
	if len(existing) > 0 {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
			UPDATE %s SET
				row_id = %s,
				column_index = %d,
				content = { summary: %s },
				citations = {},
				status = %s;
		`, cellRecID, rowRecID, columnIndex, surrealString(summary), surrealString(status)))
	} else {
		_, err = s.app.DB.Query(ctx, fmt.Sprintf(`
			CREATE %s CONTENT {
				row_id: %s,
				column_index: %d,
				content: { summary: %s },
				citations: {},
				status: %s,
				created_at: time::now()
			};
		`, cellRecID, rowRecID, columnIndex, surrealString(summary), surrealString(status)))
	}
	if err != nil {
		return nil, err
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id, row_id, column_index, content, status, created_at FROM "+cellRecID+";")
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// runEntityModeGenerate is the full entity-row generation pipeline. Called
// from tabularGenerate when the review's row_mode is "entity". Streams SSE
// events (row_created, cell_update, done) and updates the parent span via
// the cellsDone/cellsFailed counters the caller passed in.
func (s *Server) runEntityModeGenerate(
	ctx context.Context,
	w http.ResponseWriter,
	parentSpan trace.Span,
	reviewID string,
	documentIDs []string,
	columnIndices []int,
	meta tabularReviewMeta,
	cellsDone, cellsFailed *int,
) {
	if strings.TrimSpace(meta.AnchorPrompt) == "" {
		err := fmt.Errorf("entity-mode review %s has no anchor extractor prompt", reviewID)
		recordSpanError(parentSpan, err)
		parentSpan.SetAttributes(attribute.String("tabular.exit_reason", "no_anchor_prompt"))
		writeError(w, http.StatusBadRequest, err)
		return
	}

	rowIndex, idxErr := s.nextRowIndex(ctx, reviewID)
	if idxErr != nil {
		recordSpanError(parentSpan, idxErr)
		parentSpan.SetAttributes(attribute.String("tabular.exit_reason", "row_index_failed"))
		writeError(w, http.StatusInternalServerError, idxErr)
		return
	}

	var (
		rowsCreated int
		streamErr   error
	)

	streamSSE(ctx, w, func(send func(map[string]any) error) error {
		for _, docID := range documentIDs {
			anchors, err := s.extractAnchors(ctx, docID, meta.AnchorPrompt)
			if err != nil {
				// Anchor failure for one doc: log + continue with next doc.
				_ = send(map[string]any{
					"type":        "row_extract_failed",
					"document_id": docID,
					"error":       err.Error(),
				})
				continue
			}
			docText, docFilename, docErr := s.loadDocumentForTabular(ctx, docID)
			if docErr != nil {
				_ = send(map[string]any{
					"type":        "row_extract_failed",
					"document_id": docID,
					"error":       docErr.Error(),
				})
				continue
			}
			for _, anchor := range anchors {
				rowRecID, rowMap, err := s.upsertReviewRow(ctx, reviewID, docID, rowIndex, anchor)
				if err != nil {
					streamErr = err
					return err
				}
				rowsCreated++
				if err := send(map[string]any{
					"type":        "row_created",
					"row_id":      rowRecID,
					"document_id": docID,
					"row_index":   rowIndex,
					"anchor": map[string]any{
						"label":    anchor.Label,
						"summary":  anchor.Summary,
						"metadata": anchor.Metadata,
					},
					"row": rowMap,
				}); err != nil {
					streamErr = err
					return err
				}
				rowIndex++

				for _, column := range columnIndices {
					cellCtx, cellSpan := startLocalSpan(ctx, "tabular.row.cell.generate",
						attribute.String("tabular_review.id", reviewID),
						attribute.String("tabular.row.id", rowRecID),
						attribute.Int("tabular.column.index", column),
						attribute.String("tabular.document.id", docID),
						attribute.String("tabular.document.filename", docFilename),
						attribute.Int("tabular.document.text_chars", len(docText)),
						attribute.String("tabular.anchor.label", truncateForSpan(anchor.Label, 200)),
					)
					spec, hasSpec := meta.ColumnSpecs[column]
					if !hasSpec || strings.TrimSpace(spec.Prompt) == "" {
						cellSpan.SetAttributes(attribute.String("tabular.cell.status", "no_column_prompt"))
						cellSpan.End()
						*cellsFailed++
						continue
					}
					cellSpan.SetAttributes(
						attribute.String("tabular.column.name", spec.Name),
						attribute.String("tabular.column.format", spec.Format),
					)
					summary, err := s.completeText(cellCtx, completionRequest{
						Model:        defaultMainModel,
						SystemPrompt: entityCellSystemPrompt(),
						User:         entityCellUserPrompt(spec, anchor, docFilename, docText),
					})
					if err != nil {
						*cellsFailed++
						cellSpan.SetAttributes(attribute.String("tabular.cell.status", "llm_failed"))
						recordSpanError(cellSpan, err)
						cellSpan.End()
						streamErr = err
						return err
					}
					trimmed := strings.TrimSpace(summary)
					if trimmed == "" {
						trimmed = "Not addressed"
						cellSpan.SetAttributes(attribute.Bool("tabular.cell.fell_back_to_default", true))
					}
					cellSpan.SetAttributes(attribute.Int("tabular.cell.summary_chars", len(trimmed)))
					rowCell, err := s.upsertReviewRowCell(cellCtx, rowRecID, column, trimmed, "done")
					if err != nil {
						*cellsFailed++
						cellSpan.SetAttributes(attribute.String("tabular.cell.status", "persist_failed"))
						recordSpanError(cellSpan, err)
						cellSpan.End()
						streamErr = err
						return err
					}
					if err := send(map[string]any{
						"type":         "cell_update",
						"row_id":       rowRecID,
						"column_index": column,
						"content":      map[string]any{"summary": trimmed},
						"status":       "done",
						"cell":         rowCell,
					}); err != nil {
						*cellsFailed++
						cellSpan.SetAttributes(attribute.String("tabular.cell.status", "send_failed"))
						recordSpanError(cellSpan, err)
						cellSpan.End()
						streamErr = err
						return err
					}
					*cellsDone++
					cellSpan.SetAttributes(attribute.String("tabular.cell.status", "done"))
					cellSpan.End()
				}
			}
		}
		return send(map[string]any{"type": "done"})
	})

	parentSpan.SetAttributes(
		attribute.Int("tabular.rows.created", rowsCreated),
		attribute.Int("tabular.cells.done", *cellsDone),
		attribute.Int("tabular.cells.failed", *cellsFailed),
	)
	if streamErr != nil {
		recordSpanError(parentSpan, streamErr)
		parentSpan.SetAttributes(attribute.String("tabular.exit_reason", "stream_failed"))
	} else {
		parentSpan.SetAttributes(attribute.String("tabular.exit_reason", "done"))
	}
}

// entityCellSystemPrompt is the system message used when generating a column
// value for a specific anchor (entity row). Reuses the same anti-speculation
// rules as the document-row prompt.
func entityCellSystemPrompt() string {
	return "You are a precise extraction assistant filling one cell of a tabular review. " +
		"The user has already identified a specific entity (the anchor) within a source document. " +
		"Use ONLY the anchor and the source document to answer. " +
		"If neither contains the requested information, respond exactly with \"Not addressed\". " +
		"Do not speculate, do not invent facts, and do not add commentary. " +
		"Return the answer in the requested format with no preamble."
}

func entityCellUserPrompt(spec tabularColumnSpec, anchor Anchor, filename, docText string) string {
	formatHint := tabularFormatHint(spec.Format)
	var b strings.Builder
	b.WriteString("Column: ")
	if spec.Name != "" {
		b.WriteString(spec.Name)
	} else {
		b.WriteString("Column " + strconv.Itoa(spec.Index))
	}
	b.WriteString("\nFormat: ")
	b.WriteString(formatHint)
	b.WriteString("\n\nTask:\n")
	b.WriteString(spec.Prompt)
	b.WriteString("\n\n--- Anchor (this row's entity) ---\n")
	if anchor.Label != "" {
		b.WriteString("Label: ")
		b.WriteString(anchor.Label)
		b.WriteString("\n")
	}
	if anchor.Summary != "" {
		b.WriteString("Summary: ")
		b.WriteString(anchor.Summary)
		b.WriteString("\n")
	}
	if len(anchor.Metadata) > 0 {
		metaJSON, _ := json.Marshal(anchor.Metadata)
		b.WriteString("Metadata: ")
		b.Write(metaJSON)
		b.WriteString("\n")
	}
	b.WriteString("--- Source document")
	if filename != "" {
		b.WriteString(": ")
		b.WriteString(filename)
	}
	b.WriteString(" ---\n")
	if docText == "" {
		b.WriteString("(document has no extractable text)")
	} else {
		b.WriteString(docText)
	}
	b.WriteString("\n--- End of document ---\n\nAnswer:")
	return b.String()
}

// Anchor is one extracted entity that becomes a row in an entity-mode tabular
// review. Label is the primary display string (e.g. a job title at a company,
// or an accomplishment sentence). Summary holds a verbatim source snippet or
// short paraphrase to give downstream column prompts something concrete to
// extract from. Metadata is free-form structured data the extractor wants to
// preserve (company, dates, etc.) — columns can reference it without having
// to re-parse the label.
type Anchor struct {
	Label    string         `json:"label"`
	Summary  string         `json:"summary,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// anchorExtractorSystemPrompt is fixed across workflows. The workflow-specific
// extraction goal is supplied in the user message. Designed to coax small
// local models (Gemma, Llama) into returning a non-empty list when the
// document plausibly contains entities — empty output is a last resort,
// not a default.
func anchorExtractorSystemPrompt() string {
	return "You are an extraction assistant. Read the provided document and return a JSON array of anchor objects describing the entities the user asked for.\n\n" +
		"Anchor shape:\n" +
		"  { \"label\": string, \"summary\": string, \"metadata\": object }\n\n" +
		"- `label` is a short human-readable identifier (e.g. a role at a company, or the first ~80 chars of an accomplishment sentence).\n" +
		"- `summary` is a verbatim or near-verbatim quote from the document that grounds the anchor.\n" +
		"- `metadata` carries the structured fields the task asks for (company, role, start_date, end_date, etc.).\n\n" +
		"Worked example. Task: \"List every job tenure in the document.\" Document contains: \"Senior Engineer, Acme Corp, Mar 2021 – Jun 2023. Led the API team.\" You return:\n" +
		"[\n" +
		"  {\n" +
		"    \"label\": \"Senior Engineer at Acme Corp (Mar 2021 – Jun 2023)\",\n" +
		"    \"summary\": \"Senior Engineer, Acme Corp, Mar 2021 – Jun 2023. Led the API team.\",\n" +
		"    \"metadata\": { \"company\": \"Acme Corp\", \"role\": \"Senior Engineer\", \"start_date\": \"Mar 2021\", \"end_date\": \"Jun 2023\" }\n" +
		"  }\n" +
		"]\n\n" +
		"Rules:\n" +
		"1. Output ONLY the JSON array — no prose, no markdown fences, no commentary.\n" +
		"2. Be GENEROUS in what counts as an anchor. If the document plausibly contains the entities the user asked for, extract them. Aim for high recall.\n" +
		"3. Only return an empty array [] when the document genuinely contains nothing matching the task (e.g. asking for accomplishments in a blank invoice).\n" +
		"4. Do not invent entities not supported by the document text. When a metadata field isn't stated, use null.\n" +
		"5. Each anchor must have a non-empty `label`."
}

func anchorExtractorUserPrompt(filename, text, taskPrompt string) string {
	var b strings.Builder
	b.WriteString("Task:\n")
	b.WriteString(strings.TrimSpace(taskPrompt))
	b.WriteString("\n\n--- Document")
	if filename != "" {
		b.WriteString(": ")
		b.WriteString(filename)
	}
	b.WriteString(" ---\n")
	if text == "" {
		b.WriteString("(document has no extractable text)")
	} else {
		b.WriteString(text)
	}
	b.WriteString("\n--- End of document ---\n\nReturn the JSON array now.")
	return b.String()
}

// extractAnchors runs the anchor extractor over one document. Returns the
// parsed list of anchors. Emits a `tabular.anchor.extract` span with the doc
// id, filename, text length, prompt length, model used, anchors.count, and
// exit_reason ("ok" | "no_text" | "llm_failed" | "parse_failed" | "empty").
func (s *Server) extractAnchors(ctx context.Context, documentID, taskPrompt string) ([]Anchor, error) {
	ctx, span := startLocalSpan(ctx, "tabular.anchor.extract",
		attribute.String("document.id", documentID),
		attribute.Int("tabular.anchor.prompt_chars", len(taskPrompt)),
	)
	defer span.End()

	if strings.TrimSpace(taskPrompt) == "" {
		err := fmt.Errorf("anchor extractor prompt is empty")
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.anchor.exit_reason", "empty_prompt"))
		return nil, err
	}

	docText, docFilename, err := s.loadDocumentForTabular(ctx, documentID)
	if err != nil {
		recordSpanError(span, err)
		span.SetAttributes(attribute.String("tabular.anchor.exit_reason", "document_load_failed"))
		return nil, err
	}
	span.SetAttributes(
		attribute.String("document.filename", docFilename),
		attribute.Int("document.text_chars", len(docText)),
	)
	if strings.TrimSpace(docText) == "" {
		span.SetAttributes(
			attribute.Int("tabular.anchor.count", 0),
			attribute.String("tabular.anchor.exit_reason", "no_text"),
		)
		return []Anchor{}, nil
	}

	// Small local models (gemma4 et al.) frequently default to returning an
	// empty array even when the document is rich. Run up to two attempts,
	// escalating the prompt on retry to push the model toward extracting
	// something concrete. Each attempt is recorded as a span attribute so we
	// can see the recovery pattern in telemetry.
	var (
		raw       string
		anchors   []Anchor
		parseErr  error
		attempts  int
		retryNote string
	)
	for attempts = 1; attempts <= 2; attempts++ {
		userPrompt := anchorExtractorUserPrompt(docFilename, docText, taskPrompt)
		if attempts > 1 {
			userPrompt += "\n\nYour previous response was an empty array, but the document clearly contains content matching the task. Look again. Extract the 3-10 strongest candidates supported by the document. Output the JSON array now."
			retryNote = "retry_after_empty"
		}
		raw, err = s.completeText(ctx, completionRequest{
			Model:        defaultMainModel,
			SystemPrompt: anchorExtractorSystemPrompt(),
			User:         userPrompt,
		})
		if err != nil {
			recordSpanError(span, err)
			span.SetAttributes(
				attribute.String("tabular.anchor.exit_reason", "llm_failed"),
				attribute.Int("tabular.anchor.attempts", attempts),
			)
			return nil, err
		}
		anchors, parseErr = parseAnchorList(raw)
		if parseErr == nil && len(anchors) > 0 {
			break
		}
	}
	span.SetAttributes(
		attribute.Int("tabular.anchor.attempts", attempts),
		attribute.Int("tabular.anchor.llm_response_chars", len(raw)),
		attribute.String("tabular.anchor.llm_response_excerpt", truncateForSpan(strings.TrimSpace(raw), 600)),
	)
	if retryNote != "" {
		span.SetAttributes(attribute.String("tabular.anchor.retry_note", retryNote))
	}

	if parseErr != nil {
		recordSpanError(span, parseErr)
		span.SetAttributes(attribute.String("tabular.anchor.exit_reason", "parse_failed"))
		return nil, parseErr
	}
	span.SetAttributes(
		attribute.Int("tabular.anchor.count", len(anchors)),
		attribute.String("tabular.anchor.exit_reason", "ok"),
	)
	return anchors, nil
}

// parseAnchorList tolerates a few common LLM output styles:
//   - bare JSON array
//   - ```json … ``` fenced array
//   - JSON object with an "anchors" key whose value is the array
//   - leading/trailing prose around an embedded array
func parseAnchorList(raw string) ([]Anchor, error) {
	body := stripCodeFences(strings.TrimSpace(raw))
	if body == "" {
		return []Anchor{}, nil
	}

	// Try direct array decode first.
	if anchors, ok := tryDecodeAnchorArray([]byte(body)); ok {
		return anchors, nil
	}
	// Try { "anchors": [...] } wrapper.
	var wrap struct {
		Anchors []Anchor `json:"anchors"`
	}
	if err := json.Unmarshal([]byte(body), &wrap); err == nil && wrap.Anchors != nil {
		return wrap.Anchors, nil
	}
	// Fall back to finding the first balanced [...] block in the body.
	if start := strings.Index(body, "["); start >= 0 {
		if end := findMatchingBracket(body, start); end > start {
			if anchors, ok := tryDecodeAnchorArray([]byte(body[start : end+1])); ok {
				return anchors, nil
			}
		}
	}
	return nil, fmt.Errorf("anchor parse: response did not contain a JSON array")
}

func tryDecodeAnchorArray(b []byte) ([]Anchor, bool) {
	// Always go through the loose-map decode so we can collect unknown
	// fields into Metadata. A strict []Anchor decode would silently drop
	// them.
	var loose []map[string]any
	if err := json.Unmarshal(b, &loose); err != nil {
		return nil, false
	}
	out := make([]Anchor, 0, len(loose))
	for _, m := range loose {
		a := Anchor{}
		if v, ok := m["label"].(string); ok {
			a.Label = v
		}
		if v, ok := m["summary"].(string); ok {
			a.Summary = v
		}
		if md, ok := m["metadata"].(map[string]any); ok {
			a.Metadata = md
		} else {
			// Treat all unknown fields as metadata.
			extra := map[string]any{}
			for k, v := range m {
				if k == "label" || k == "summary" || k == "metadata" {
					continue
				}
				extra[k] = v
			}
			if len(extra) > 0 {
				a.Metadata = extra
			}
		}
		if a.Label == "" && a.Summary == "" && len(a.Metadata) == 0 {
			continue // skip blank entries
		}
		out = append(out, a)
	}
	return out, true
}

var codeFencePattern = regexp.MustCompile("(?s)^```(?:json|JSON)?\\s*\\n?(.*?)\\n?```\\s*$")

func stripCodeFences(s string) string {
	if m := codeFencePattern.FindStringSubmatch(s); len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	return s
}

// findMatchingBracket returns the index of the `]` that closes the `[` at
// position `open`, or -1 if no match. Naive: counts brackets respecting
// double-quoted strings and \-escapes. Good enough for LLM JSON output.
func findMatchingBracket(s string, open int) int {
	if open >= len(s) || s[open] != '[' {
		return -1
	}
	depth := 0
	inStr := false
	escape := false
	for i := open; i < len(s); i++ {
		c := s[i]
		if escape {
			escape = false
			continue
		}
		if inStr {
			switch c {
			case '\\':
				escape = true
			case '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '[':
			depth++
		case ']':
			depth--
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}

func truncateForSpan(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
