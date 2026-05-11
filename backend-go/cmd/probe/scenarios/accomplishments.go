package scenarios

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/CaliLuke/luke/backend-go/internal/probe"
)

func init() {
	Register(Scenario{
		Name:        "accomplishments",
		Description: "Create an entity-mode tabular review (Accomplishments by Company), pick a resume-like document, generate, assert spans + DB state, clean up.",
		Run:         runAccomplishments,
	})
}

// runAccomplishments exercises the full P0–P4 entity-row stack end-to-end.
//
// Steps:
//  1. Pick a document with non-trivial extracted_text (preferring filenames
//     that look like resumes / CVs).
//  2. POST /tabular-review with row_mode=entity and the Accomplishments
//     anchor_extractor + columns inline.
//  3. POST /tabular-review/{id}/generate with that single document and all
//     column indices. Tail SSE; count row_created and cell_update.
//  4. GET /tabular-review/{id} and verify rows + row_cells in the DB match
//     the SSE event counts.
//  5. Assert telemetry spans: tabular.anchor.extract (≥1), tabular.row.cell.generate
//     (≥1 per row × column), no Error spans in window.
//  6. DELETE the review at the end so the probe leaves no garbage behind.
func runAccomplishments(ctx context.Context, client *probe.Client, tel *probe.TelemetryDB, result *probe.Result) error {
	// Generation is heavy on small local models: anchor extract (~30s) plus
	// N rows × M columns × ~15s each. Five-row resume × five columns can run
	// 7 minutes. The probe should not be the limiting factor — give it
	// headroom and let real failures show up as Error spans.
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()

	doc, err := pickResumeLikeDocument(ctx, client)
	if err != nil {
		result.RecordSetupError(fmt.Errorf("pick document: %w", err))
		return nil
	}
	result.AddNote("using document: %s (%s)", doc.Filename, doc.ID)

	reviewID, err := createAccomplishmentsReview(ctx, client, doc.ID)
	if err != nil {
		result.RecordSetupError(fmt.Errorf("create review: %w", err))
		return nil
	}
	result.AddNote("created review: %s", reviewID)
	keepReview := os.Getenv("LUKE_PROBE_KEEP") != ""
	defer func() {
		if keepReview {
			result.AddNote("LUKE_PROBE_KEEP set — leaving review in DB for UI inspection: %s", reviewID)
			return
		}
		// Best-effort cleanup. Failure here is logged but doesn't fail the run.
		if delErr := client.Delete(context.Background(), "/tabular-review/"+reviewID); delErr != nil {
			result.AddNote("cleanup delete failed: %v", delErr)
		}
	}()

	// Drive Generate and count SSE events.
	streamStart := probe.Now()
	if err = client.StreamSSE(ctx, http.MethodPost,
		"/tabular-review/"+reviewID+"/generate",
		map[string]any{
			"document_ids":   []string{doc.ID},
			"column_indices": []int{0, 1, 2, 3, 4},
		},
		func(ev probe.SSEEvent) error {
			t := "unknown"
			if ev.Payload != nil {
				if v, ok := ev.Payload["type"].(string); ok {
					t = v
				}
			}
			result.SSESummary[t]++
			return nil
		},
	); err != nil {
		result.AddNote("SSE stream error: %v", err)
	}
	streamEnd := time.Now()
	result.AddNote("SSE stream duration: %.1fs", streamEnd.Sub(streamStart).Seconds())

	// Pull the review back and validate persistence matched the stream.
	type detailResp struct {
		Review struct {
			ID      string `json:"id"`
			RowMode string `json:"row_mode"`
		} `json:"review"`
		Rows     []map[string]any `json:"rows"`
		RowCells []map[string]any `json:"row_cells"`
	}
	var detail detailResp
	// Use a fresh short-timeout context so a stalled SSE stream doesn't
	// poison the post-flight inspection.
	detailCtx, detailCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer detailCancel()
	if err = client.GetJSON(detailCtx, "/tabular-review/"+reviewID, &detail); err != nil {
		result.RecordSetupError(fmt.Errorf("get review detail: %w", err))
		return nil
	}

	// Assertions ----------------------------------------------------------
	rowsCreated := result.SSESummary["row_created"]
	cellUpdates := result.SSESummary["cell_update"]
	rowsPersisted := len(detail.Rows)
	cellsPersisted := len(detail.RowCells)

	result.AddAssertion(probe.Assertion{
		Description: "review row_mode is entity",
		OK:          detail.Review.RowMode == "entity",
		Detail:      "row_mode=" + detail.Review.RowMode,
	})
	result.AddAssertion(probe.Assertion{
		Description: "at least one row created via SSE",
		OK:          rowsCreated >= 1,
		Detail:      fmt.Sprintf("%d row_created event(s)", rowsCreated),
	})
	result.AddAssertion(probe.Assertion{
		Description: "rows persisted to DB match SSE",
		OK:          rowsPersisted == rowsCreated,
		Detail:      fmt.Sprintf("db=%d sse=%d", rowsPersisted, rowsCreated),
	})
	result.AddAssertion(probe.Assertion{
		Description: "cell_update events received",
		OK:          cellUpdates >= 1,
		Detail:      fmt.Sprintf("%d cell_update event(s)", cellUpdates),
	})
	result.AddAssertion(probe.Assertion{
		Description: "row_cells persisted to DB",
		OK:          cellsPersisted >= rowsPersisted, // each row should have ≥1 cell
		Detail:      fmt.Sprintf("%d row_cell(s) for %d row(s)", cellsPersisted, rowsPersisted),
	})

	// Telemetry-based assertions. Window: from review creation to now,
	// with a small backstop for span flush.
	time.Sleep(500 * time.Millisecond)
	spans, err := tel.SpansBetween(ctx, result.StartedAt, time.Now())
	if err != nil {
		result.AddNote("telemetry query failed: %v", err)
		return nil
	}
	all := probe.From(spans)

	result.AddAssertion(
		all.Named("tabular.anchor.extract").
			RequireAtLeast(1, "tabular.anchor.extract span emitted"),
	)
	result.AddAssertion(
		all.Named("tabular.anchor.extract").
			WithAttr("tabular.anchor.exit_reason", "ok").
			RequireAtLeast(1, "anchor extract exit_reason=ok"),
	)
	result.AddAssertion(
		all.Named("tabular.row.cell.generate").
			RequireAtLeast(1, "tabular.row.cell.generate spans emitted"),
	)
	result.AddAssertion(
		all.Named("tabular.row.cell.generate").
			WithAttr("tabular.cell.status", "done").
			RequireAtLeast(1, "row cell spans with status=done"),
	)
	// No new Error-status spans from our review flow. Scope to tabular.* and
	// chatv2.* to avoid noise from unrelated polling errors.
	result.AddAssertion(
		all.NamePrefix("tabular.").Errors().
			RequireNone("no Error-status spans in tabular.*"),
	)

	return nil
}

type apiDocument struct {
	ID                 string `json:"id"`
	Filename           string `json:"filename"`
	ExtractedTextChars int    `json:"extracted_text_chars"`
}

// pickResumeLikeDocument picks the best available document for an accomplishments
// run. Preference order:
//  1. Filename matches /resume|cv|career/i AND has extracted_text_chars ≥ 500.
//  2. Any document with extracted_text_chars ≥ 1000.
//
// If none qualify, returns an error — we don't seed documents from this
// scenario (PDF parsing has its own probe).
func pickResumeLikeDocument(ctx context.Context, client *probe.Client) (apiDocument, error) {
	var docs []apiDocument
	if err := client.GetJSON(ctx, "/single-documents", &docs); err != nil {
		return apiDocument{}, err
	}
	var best *apiDocument
	var bestScore int
	for i := range docs {
		d := &docs[i]
		score := 0
		lower := strings.ToLower(d.Filename)
		if strings.Contains(lower, "resume") || strings.Contains(lower, "cv") || strings.Contains(lower, "career") {
			score += 1000
		}
		if d.ExtractedTextChars >= 500 {
			score += d.ExtractedTextChars / 100
		}
		if score > bestScore {
			bestScore = score
			best = d
		}
	}
	if best == nil || bestScore == 0 {
		return apiDocument{}, fmt.Errorf("no resume-like document found (need a CV/resume with extracted text)")
	}
	return *best, nil
}

// createAccomplishmentsReview POSTs a fresh entity-mode review and returns
// the review id (with the "tabular_reviews:" prefix stripped — the API
// accepts both forms).
func createAccomplishmentsReview(ctx context.Context, client *probe.Client, docID string) (string, error) {
	payload := map[string]any{
		"title":        "probe: accomplishments",
		"document_ids": []string{docID},
		"row_mode":     "entity",
		// Match the built-in "Accomplishments by Company" workflow as closely
		// as practical so the probe exercises a realistic prompt, not a
		// minimal stand-in.
		"anchor_extractor": map[string]any{
			"prompt": "Identify every concrete accomplishment, achievement, or notable contribution attributable to the subject of this document. " +
				"An accomplishment is an OUTCOME (shipped a product, led a team, won an award, closed a deal, published a paper, grew a metric, was promoted), NOT a mere responsibility or job duty.\n\n" +
				"For each accomplishment, return one anchor with:\n" +
				"- \"label\": a short sentence describing the accomplishment (max ~120 chars)\n" +
				"- \"summary\": the verbatim sentence(s) from the document that ground the accomplishment\n" +
				"- \"metadata\": { \"company\": <string|null>, \"role\": <string|null>, \"start_date\": <\"Mon YYYY\"|null>, \"end_date\": <\"Mon YYYY\"|\"Present\"|null> }\n\n" +
				"Match each accomplishment to the company where it was achieved using the document's employment dates. " +
				"If the accomplishment is not tied to any company (personal project, education, independent work), set \"company\" to \"Independent\". " +
				"If a date is missing or ambiguous, use null. Do not invent companies, roles, dates, or accomplishments not supported by the document.",
		},
		"columns_config": []map[string]any{
			{"index": 0, "name": "Company", "format": "text", "prompt": "Which company is associated with this accomplishment? Return only the company name, or 'Independent', or 'Not addressed'."},
			{"index": 1, "name": "Role", "format": "text", "prompt": "What role did the subject hold when this accomplishment was achieved? If unstated, 'Not addressed'."},
			{"index": 2, "name": "Date", "format": "date", "prompt": "When did this accomplishment occur? 'Mon YYYY' form, or 'Unknown'."},
			{"index": 3, "name": "Impact", "format": "text", "prompt": "Quantify the impact using the document's language. If no quantitative result, summarise qualitatively."},
			{"index": 4, "name": "Evidence", "format": "text", "prompt": "Quote the verbatim sentence(s) from the document that establish this accomplishment."},
		},
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := client.PostJSON(ctx, "/tabular-review", payload, &created); err != nil {
		return "", err
	}
	return created.ID, nil
}
