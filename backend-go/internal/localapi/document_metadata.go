package localapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
)

const (
	metadataMaxConcurrentClassifiers = 5
	metadataClassifyTimeout          = 60 * time.Second
)

// classifierSystemPrompt instructs the model to produce a single JSON object
// matching classifierResult. Kept verbatim from DOCUMENT_METADATA_PLAN.md so
// reviewers can diff prompt changes against the plan.
const classifierSystemPrompt = `You are a document classifier for a personal career-operations workbench. Given a document's filename and extracted text, you produce a single JSON object describing its kind, scope, and the entities it references.

You MUST return only JSON matching this schema (no commentary):
{
  "kind": one of [resume, resume_baseline, job_description, interview_transcript, recruiter_notes, prep_packet, cheatsheet, interviewer_bio, schedule, story, about_me, answer_bank, framework, references, cover_letter, writing_sample, coaching_state],
  "library": boolean,           // true if this is a reusable asset across applications; false if it belongs to a single application loop
  "library_kind": "shared" | "reference" | null,
  "interview_stage": "recruiter" | "hiring_manager" | "peer" | "tech" | "panel" | "onsite" | "other" | null,
  "summary": string,            // 2-4 sentences. No filler. State what the doc IS.
  "topics": [string, ...],      // 3-8 short tags: subjects, skills, themes
  "company_refs": [string, ...],// companies mentioned in content (not the application)
  "people_refs": [{"name": string, "role": string}, ...],
  "dated_event_at": ISO8601 string or null,  // when the meeting/event happened
  "suggested_application_match": string or null,  // application name if obvious
  "suggested_derived_from": string or null        // baseline doc filename if obvious
}

Heuristics:
- A document like "Amplitude - Luca Candela Resume 2025.pdf" with content tailored to one company is kind=resume, library=false.
- A document like "Resume 2025 - Baseline.md" is kind=resume_baseline, library=true, library_kind=shared.
- A transcript ("Meeting Title: ...") is kind=interview_transcript, library=false; infer interview_stage from speakers ("recruiter", "hiring manager", "tech screen").
- A general guide ("product sense", "interview process") is kind=cheatsheet or framework, library=true, library_kind=reference.
- A STAR-formatted experience write-up is kind=story, library=true, library_kind=shared.

If a field cannot be determined, return null. Do not fabricate.`

// classifierKindAllowList mirrors the documents.kind SurrealQL enum in
// backend-go/internal/localdata/schema.go. Out-of-list values from the LLM
// are folded to "unclassified".
var classifierKindAllowList = map[string]struct{}{
	"resume": {}, "resume_baseline": {}, "job_description": {},
	"interview_transcript": {}, "recruiter_notes": {}, "prep_packet": {},
	"cheatsheet": {}, "interviewer_bio": {}, "schedule": {},
	"story": {}, "about_me": {}, "answer_bank": {}, "framework": {},
	"references": {}, "cover_letter": {}, "writing_sample": {},
	"coaching_state": {}, "unclassified": {},
}

var classifierLibraryKindAllowList = map[string]struct{}{
	"shared": {}, "reference": {},
}

var classifierInterviewStageAllowList = map[string]struct{}{
	"recruiter": {}, "hiring_manager": {}, "peer": {}, "tech": {},
	"panel": {}, "onsite": {}, "other": {},
}

// classifierPersonRef matches the people_refs array element shape. Independent
// of the loom-generated PersonRef so this package can parse without dragging
// the gen/ dependency.
type classifierPersonRef struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

type classifierResult struct {
	Kind                      string                `json:"kind"`
	Library                   *bool                 `json:"library"`
	LibraryKind               *string               `json:"library_kind"`
	InterviewStage            *string               `json:"interview_stage"`
	Summary                   string                `json:"summary"`
	Topics                    []string              `json:"topics"`
	CompanyRefs               []string              `json:"company_refs"`
	PeopleRefs                []classifierPersonRef `json:"people_refs"`
	DatedEventAt              *string               `json:"dated_event_at"`
	SuggestedApplicationMatch *string               `json:"suggested_application_match"`
	SuggestedDerivedFrom      *string               `json:"suggested_derived_from"`
}

// parseClassifierResult decodes the LLM JSON output, strips code fences if the
// model wrapped its reply in them, and normalises enum/array values to fit
// what the documents table will accept.
func parseClassifierResult(raw string) (classifierResult, error) {
	var result classifierResult
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "```") {
		// Strip a leading ```json or ``` fence and its trailing ``` if present.
		trimmed = strings.TrimPrefix(trimmed, "```json")
		trimmed = strings.TrimPrefix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
		trimmed = strings.TrimSuffix(trimmed, "```")
		trimmed = strings.TrimSpace(trimmed)
	}
	if trimmed == "" {
		return result, errors.New("classifier returned empty response")
	}
	if err := json.Unmarshal([]byte(trimmed), &result); err != nil {
		return result, fmt.Errorf("decode classifier JSON: %w", err)
	}
	normaliseClassifierResult(&result)
	return result, nil
}

func normaliseClassifierResult(r *classifierResult) {
	if _, ok := classifierKindAllowList[r.Kind]; !ok {
		r.Kind = "unclassified"
	}
	if r.LibraryKind != nil {
		if _, ok := classifierLibraryKindAllowList[*r.LibraryKind]; !ok {
			r.LibraryKind = nil
		}
	}
	if r.InterviewStage != nil {
		if _, ok := classifierInterviewStageAllowList[*r.InterviewStage]; !ok {
			r.InterviewStage = nil
		}
	}
	// Library-only kinds need library=true even if the model forgot.
	// We only flip an explicit nil; an explicit false stays so the user can
	// still confirm/override.
	if r.Library == nil {
		switch r.Kind {
		case "story", "about_me", "answer_bank", "framework", "references", "cheatsheet", "resume_baseline", "writing_sample":
			t := true
			r.Library = &t
		case "resume", "job_description", "interview_transcript", "recruiter_notes", "prep_packet", "interviewer_bio", "schedule", "cover_letter", "coaching_state":
			f := false
			r.Library = &f
		}
	}
	if len(r.Topics) > 8 {
		r.Topics = r.Topics[:8]
	}
	if len(r.CompanyRefs) > 16 {
		r.CompanyRefs = r.CompanyRefs[:16]
	}
	if len(r.PeopleRefs) > 16 {
		r.PeopleRefs = r.PeopleRefs[:16]
	}
}

// enrichDocumentMetadata runs the classifier on a single document and writes
// the result. Designed for deferred, user-triggered invocation (M3 wires the
// HTTP endpoint that spawns this). Reads the latest version's text twin via
// the same path as the chat agent (readStoredExtractedText).
func (s *Server) enrichDocumentMetadata(ctx context.Context, documentID string) error {
	ctx, span := startLocalSpan(ctx, "metadata.enrich_document",
		attribute.String("metadata.document_id", documentID),
	)
	defer span.End()

	if err := s.setDocumentMetadataStatus(ctx, documentID, "processing", ""); err != nil {
		recordSpanError(span, err)
		return err
	}

	// Pull filename + current_version_id so we know what to feed the LLM.
	docRows, err := queryRows(ctx, s.app.DB,
		"SELECT filename, current_version_id FROM "+recordID("documents", documentID)+";")
	if err != nil {
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}
	if len(docRows) == 0 {
		err := errors.New("document not found")
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}
	filename := asString(docRows[0]["filename"])
	versionID := trimRecord(asString(docRows[0]["current_version_id"]))

	text, ok, err := s.readStoredExtractedText(ctx, versionID)
	if err != nil {
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}
	if !ok {
		// No text twin yet (e.g. extraction failed or pending). Mark error
		// rather than spinning forever; the user can retry once ingest is ready.
		msg := "text twin unavailable"
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", msg)
		span.SetAttributes(attribute.String("metadata.skip_reason", msg))
		return nil
	}

	truncated := text
	const maxInputChars = 8000
	if len(truncated) > maxInputChars {
		truncated = truncated[:maxInputChars]
	}
	span.SetAttributes(
		attribute.Int("metadata.input_chars", len(truncated)),
		attribute.Bool("metadata.input_truncated", len(text) > maxInputChars),
	)

	raw, err := s.completeText(ctx, completionRequest{
		Model:        defaultMainModel,
		SystemPrompt: classifierSystemPrompt,
		User:         fmt.Sprintf("Filename: %s\n\nContent:\n%s", filename, truncated),
	})
	if err != nil {
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}

	parsed, err := parseClassifierResult(raw)
	if err != nil {
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}

	span.SetAttributes(
		attribute.String("metadata.kind", parsed.Kind),
		attribute.Int("metadata.summary_chars", len(parsed.Summary)),
		attribute.Int("metadata.topic_count", len(parsed.Topics)),
		attribute.Int("metadata.people_ref_count", len(parsed.PeopleRefs)),
	)
	if parsed.Library != nil {
		span.SetAttributes(attribute.Bool("metadata.library", *parsed.Library))
	}

	if err := s.persistClassifierResult(ctx, documentID, parsed); err != nil {
		_ = s.setDocumentMetadataStatus(ctx, documentID, "error", err.Error())
		recordSpanError(span, err)
		return err
	}
	return nil
}

// setDocumentMetadataStatus flips metadata_status with an optional error
// message. Always updates metadata_processed_at so the UI can show "last
// touched".
func (s *Server) setDocumentMetadataStatus(ctx context.Context, documentID, status, errMessage string) error {
	errAssign := "metadata_error = NONE"
	if errMessage != "" {
		errAssign = "metadata_error = " + surrealString(errMessage)
	}
	query := fmt.Sprintf(
		"UPDATE %s SET metadata_status = %s, metadata_processed_at = time::now(), %s, updated_at = time::now();",
		recordID("documents", documentID),
		surrealString(status),
		errAssign,
	)
	_, err := s.app.DB.Query(ctx, query)
	return err
}

func (s *Server) persistClassifierResult(ctx context.Context, documentID string, r classifierResult) error {
	sets := []string{
		"kind = " + surrealString(r.Kind),
		"summary = " + surrealString(r.Summary),
		"topics = " + surrealStringArray(r.Topics),
		"company_refs = " + surrealStringArray(r.CompanyRefs),
		"people_refs = " + surrealPeopleRefs(r.PeopleRefs),
		"metadata_status = \"ready\"",
		"metadata_processed_at = time::now()",
		"metadata_error = NONE",
		"updated_at = time::now()",
	}
	if r.Library != nil {
		if *r.Library {
			sets = append(sets, "library = true")
		} else {
			sets = append(sets, "library = false")
		}
	} else {
		sets = append(sets, "library = NONE")
	}
	if r.LibraryKind != nil {
		sets = append(sets, "library_kind = "+surrealString(*r.LibraryKind))
	} else {
		sets = append(sets, "library_kind = NONE")
	}
	if r.InterviewStage != nil {
		sets = append(sets, "interview_stage = "+surrealString(*r.InterviewStage))
	} else {
		sets = append(sets, "interview_stage = NONE")
	}
	if r.DatedEventAt != nil && *r.DatedEventAt != "" {
		// Pass through as a Surreal datetime literal; if the LLM returned a
		// malformed value the UPDATE will fail and the caller will mark error.
		sets = append(sets, "dated_event_at = <datetime>"+surrealString(*r.DatedEventAt))
	} else {
		sets = append(sets, "dated_event_at = NONE")
	}
	query := "UPDATE " + recordID("documents", documentID) + " SET " + strings.Join(sets, ", ") + ";"
	_, err := s.app.DB.Query(ctx, query)
	return err
}

// surrealStringArray renders a Go []string as a Surreal array literal of
// strings, e.g. ["alpha", "beta"]. Empty slice renders as [].
func surrealStringArray(items []string) string {
	if len(items) == 0 {
		return "[]"
	}
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = surrealString(s)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

// queueDocumentMetadataJob marks a document as queued and spawns a background
// goroutine that runs the classifier. Returns whether the queue actually
// accepted the doc (false when the doc was already processing).
func (s *Server) queueDocumentMetadataJob(ctx context.Context, documentID string) error {
	if err := s.setDocumentMetadataStatus(ctx, documentID, "queued", ""); err != nil {
		return err
	}
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), metadataClassifyTimeout)
		defer cancel()
		_ = s.enrichDocumentMetadata(bg, documentID)
	}()
	return nil
}

// queueDocumentMetadataBatch runs multiple classifier jobs with a fixed
// concurrency cap. Each job has its own timeout context derived from
// context.Background so it survives the originating HTTP request.
func (s *Server) queueDocumentMetadataBatch(ctx context.Context, documentIDs []string) error {
	if len(documentIDs) == 0 {
		return nil
	}
	for _, id := range documentIDs {
		if err := s.setDocumentMetadataStatus(ctx, id, "queued", ""); err != nil {
			return fmt.Errorf("mark queued %s: %w", id, err)
		}
	}
	sem := make(chan struct{}, metadataMaxConcurrentClassifiers)
	for _, id := range documentIDs {
		docID := id
		sem <- struct{}{}
		go func() {
			defer func() { <-sem }()
			bg, cancel := context.WithTimeout(context.Background(), metadataClassifyTimeout)
			defer cancel()
			_ = s.enrichDocumentMetadata(bg, docID)
		}()
	}
	return nil
}

// findDocumentIDsForFilter resolves a batch filter ("unprocessed", "error",
// "all") to the matching document ID list.
func (s *Server) findDocumentIDsForFilter(ctx context.Context, filter string) ([]string, error) {
	where := ""
	switch filter {
	case "unprocessed":
		where = "metadata_status = \"unprocessed\" OR metadata_status = NONE"
	case "error":
		where = "metadata_status = \"error\""
	case "all":
		where = "true"
	default:
		return nil, fmt.Errorf("unknown filter %q", filter)
	}
	rows, err := queryRows(ctx, s.app.DB, "SELECT id FROM documents WHERE "+where+";")
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, trimRecord(asString(r["id"])))
	}
	return ids, nil
}

func (s *Server) processSingleDocumentMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	docID := r.PathValue("documentId")
	if docID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("documentId required"))
		return
	}
	if err := s.queueDocumentMetadataJob(r.Context(), docID); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"queued_document_ids": []string{docID},
		"status":              "queued",
	})
}

func (s *Server) processDocumentMetadataBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	var req struct {
		DocumentIDs []string `json:"document_ids"`
		Filter      string   `json:"filter"`
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
			return
		}
	}
	ids := req.DocumentIDs
	if req.Filter != "" {
		filteredIDs, err := s.findDocumentIDsForFilter(r.Context(), req.Filter)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		ids = append(ids, filteredIDs...)
	}
	// Dedupe while preserving order.
	seen := make(map[string]struct{}, len(ids))
	deduped := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		deduped = append(deduped, id)
	}
	if err := s.queueDocumentMetadataBatch(r.Context(), deduped); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"queued_document_ids": deduped,
		"status":              "queued",
	})
}

func (s *Server) metadataQueueStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	rows, err := queryRows(r.Context(), s.app.DB,
		"SELECT metadata_status, count() AS count FROM documents GROUP BY metadata_status;")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	counts := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		statusVal := asString(row["metadata_status"])
		if statusVal == "" {
			statusVal = "unprocessed"
		}
		counts = append(counts, map[string]any{
			"metadata_status": statusVal,
			"count":           row["count"],
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": counts})
}

func (s *Server) patchDocumentMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, fmt.Errorf("method not allowed"))
		return
	}
	docID := r.PathValue("documentId")
	if docID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("documentId required"))
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var req struct {
		Confirm        *bool                  `json:"confirm"`
		Kind           *string                `json:"kind"`
		Library        *bool                  `json:"library"`
		LibraryKind    *string                `json:"library_kind"`
		InterviewStage *string                `json:"interview_stage"`
		Summary        *string                `json:"summary"`
		Topics         *[]string              `json:"topics"`
		CompanyRefs    *[]string              `json:"company_refs"`
		PeopleRefs     *[]classifierPersonRef `json:"people_refs"`
		DatedEventAt   *string                `json:"dated_event_at"`
		DerivedFromID  *string                `json:"derived_from_id"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
			return
		}
	}
	sets := []string{"updated_at = time::now()"}
	if req.Kind != nil {
		if _, ok := classifierKindAllowList[*req.Kind]; !ok {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid kind %q", *req.Kind))
			return
		}
		sets = append(sets, "kind = "+surrealString(*req.Kind))
	}
	if req.Library != nil {
		if *req.Library {
			sets = append(sets, "library = true")
		} else {
			sets = append(sets, "library = false")
		}
	}
	if req.LibraryKind != nil {
		if *req.LibraryKind == "" {
			sets = append(sets, "library_kind = NONE")
		} else if _, ok := classifierLibraryKindAllowList[*req.LibraryKind]; !ok {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid library_kind %q", *req.LibraryKind))
			return
		} else {
			sets = append(sets, "library_kind = "+surrealString(*req.LibraryKind))
		}
	}
	if req.InterviewStage != nil {
		if *req.InterviewStage == "" {
			sets = append(sets, "interview_stage = NONE")
		} else if _, ok := classifierInterviewStageAllowList[*req.InterviewStage]; !ok {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid interview_stage %q", *req.InterviewStage))
			return
		} else {
			sets = append(sets, "interview_stage = "+surrealString(*req.InterviewStage))
		}
	}
	if req.Summary != nil {
		sets = append(sets, "summary = "+surrealString(*req.Summary))
	}
	if req.Topics != nil {
		topics := *req.Topics
		if len(topics) > 8 {
			topics = topics[:8]
		}
		sets = append(sets, "topics = "+surrealStringArray(topics))
	}
	if req.CompanyRefs != nil {
		refs := *req.CompanyRefs
		if len(refs) > 16 {
			refs = refs[:16]
		}
		sets = append(sets, "company_refs = "+surrealStringArray(refs))
	}
	if req.PeopleRefs != nil {
		refs := *req.PeopleRefs
		if len(refs) > 16 {
			refs = refs[:16]
		}
		sets = append(sets, "people_refs = "+surrealPeopleRefs(refs))
	}
	if req.DatedEventAt != nil {
		if *req.DatedEventAt == "" {
			sets = append(sets, "dated_event_at = NONE")
		} else {
			sets = append(sets, "dated_event_at = <datetime>"+surrealString(*req.DatedEventAt))
		}
	}
	if req.DerivedFromID != nil {
		if *req.DerivedFromID == "" {
			sets = append(sets, "derived_from_id = NONE")
		} else {
			sets = append(sets, "derived_from_id = "+recordID("documents", *req.DerivedFromID))
		}
	}
	if req.Confirm != nil && *req.Confirm {
		sets = append(sets, "metadata_status = \"user_confirmed\"",
			"metadata_processed_at = time::now()",
			"metadata_error = NONE")
	}
	query := "UPDATE " + recordID("documents", docID) + " SET " + strings.Join(sets, ", ") + ";"
	if _, err := s.app.DB.Query(r.Context(), query); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	rows, err := queryRows(r.Context(), s.app.DB, documentListQuery("id = "+recordID("documents", docID)))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if len(rows) == 0 {
		writeError(w, http.StatusNotFound, fmt.Errorf("document not found"))
		return
	}
	writeJSON(w, http.StatusOK, rows[0])
}

func surrealPeopleRefs(refs []classifierPersonRef) string {
	if len(refs) == 0 {
		return "[]"
	}
	parts := make([]string, len(refs))
	for i, p := range refs {
		parts[i] = fmt.Sprintf("{name: %s, role: %s}",
			surrealString(p.Name),
			surrealString(p.Role),
		)
	}
	return "[" + strings.Join(parts, ", ") + "]"
}
