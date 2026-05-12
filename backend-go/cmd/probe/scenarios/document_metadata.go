package scenarios

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/CaliLuke/luke/backend-go/internal/probe"
)

func init() {
	Register(Scenario{
		Name:        "document_metadata",
		Description: "Exercises the deferred metadata classifier end-to-end: process-metadata → ready, PATCH confirm → user_confirmed, library link → application.library_documents. Asserts the metadata.enrich_document telemetry span fires.",
		Run:         runDocumentMetadata,
	})
}

// metadataDocument mirrors the document fields the M1/M3/M4 endpoints surface.
type metadataDocument struct {
	ID                   string           `json:"id"`
	Filename             string           `json:"filename"`
	Status               string           `json:"status"`
	MetadataStatus       *string          `json:"metadata_status"`
	MetadataError        *string          `json:"metadata_error"`
	Kind                 *string          `json:"kind"`
	Library              *bool            `json:"library"`
	LibraryKind          *string          `json:"library_kind"`
	InterviewStage       *string          `json:"interview_stage"`
	Summary              *string          `json:"summary"`
	Topics               []string         `json:"topics"`
	CompanyRefs          []string         `json:"company_refs"`
	PeopleRefs           []map[string]any `json:"people_refs"`
	DatedEventAt         *string          `json:"dated_event_at"`
	LinkedApplicationIDs []string         `json:"linked_application_ids"`
}

func runDocumentMetadata(ctx context.Context, client *probe.Client, tel *probe.TelemetryDB, result *probe.Result) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	scenarioStart := time.Now()
	stamp := time.Now().UnixNano()

	// --- Setup: create an application with a fetchable job_description_url
	// so the backend auto-creates a "Job description.md" document with an
	// extracted text twin. Mirrors the pattern in scenarios/applications.go.
	companyName := fmt.Sprintf("Metadata Probe Co %d", stamp)
	var app apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"company_name":        companyName,
		"position":            "Metadata Probe Role",
		"job_description_url": "https://example.com",
	}, &app); err != nil {
		result.RecordSetupError(fmt.Errorf("create application with job URL: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+app.ID); err != nil {
			result.AddNote("cleanup application failed: %v", err)
		}
		// The application's auto-created company should disappear with the
		// last application; clean it explicitly to be safe.
		if app.CompanyID != "" {
			_ = client.Delete(context.Background(), "/companies/"+trimSurrealID(app.CompanyID))
		}
	}()

	// Find the job-description document the URL ingestion created.
	var appDocs []apiDocument
	if err := client.GetJSON(ctx, "/applications/"+app.ID+"/documents", &appDocs); err != nil {
		result.RecordSetupError(fmt.Errorf("list app docs: %w", err))
		return nil
	}
	if len(appDocs) == 0 {
		result.RecordSetupError(fmt.Errorf("application has no documents after URL ingestion (job_description_ingested=%v)", app.JobDescriptionIngested))
		return nil
	}
	docID := trimSurrealID(appDocs[0].ID)

	// --- Drive 1: queue classification, poll for ready.
	var queueAck map[string]any
	if err := client.PostJSON(ctx, "/single-documents/"+docID+"/process-metadata", map[string]any{}, &queueAck); err != nil {
		result.RecordSetupError(fmt.Errorf("queue classifier: %w", err))
		return nil
	}
	result.AddAssertion(probe.Assertion{
		Description: "POST process-metadata returns queued",
		OK:          fmt.Sprint(queueAck["status"]) == "queued",
		Detail:      fmt.Sprintf("status=%v", queueAck["status"]),
	})

	doc, reached, err := waitForMetadataStatus(ctx, client, docID, []string{"ready", "error"}, 60*time.Second)
	if err != nil {
		result.RecordSetupError(fmt.Errorf("poll metadata_status: %w", err))
		return nil
	}
	if !reached {
		errMsg := ""
		if doc.MetadataError != nil {
			errMsg = *doc.MetadataError
		}
		result.AddAssertion(probe.Assertion{
			Description: "metadata_status reaches ready within 60s",
			OK:          false,
			Detail:      fmt.Sprintf("last status=%v error=%q", stringValue(doc.MetadataStatus), errMsg),
		})
		// Don't stop the scenario — still verify the user-confirm + link paths,
		// which are orthogonal to classifier success.
	} else {
		reachedOK := stringValue(doc.MetadataStatus) == "ready"
		result.AddAssertion(probe.Assertion{
			Description: "metadata_status transitions to ready (mock or real Ollama)",
			OK:          reachedOK,
			Detail:      fmt.Sprintf("status=%v error=%q", stringValue(doc.MetadataStatus), stringValue(doc.MetadataError)),
		})
		result.AddAssertion(probe.Assertion{
			Description: "classifier populated summary",
			OK:          doc.Summary != nil && strings.TrimSpace(*doc.Summary) != "",
			Detail:      fmt.Sprintf("summary=%q", stringValue(doc.Summary)),
		})
		result.AddAssertion(probe.Assertion{
			Description: "classifier populated kind",
			OK:          doc.Kind != nil && *doc.Kind != "",
			Detail:      fmt.Sprintf("kind=%v", stringValue(doc.Kind)),
		})
	}

	// --- Drive 2: PATCH with confirm=true to flip to user_confirmed.
	overrideSummary := fmt.Sprintf("Probe override summary %d", stamp)
	var patched metadataDocument
	if err := client.Patch(ctx, "/single-documents/"+docID+"/metadata", map[string]any{
		"confirm":      true,
		"summary":      overrideSummary,
		"kind":         "story",
		"library":      true,
		"library_kind": "shared",
	}, &patched); err != nil {
		result.RecordSetupError(fmt.Errorf("PATCH metadata: %w", err))
		return nil
	}
	result.AddAssertion(probe.Assertion{
		Description: "PATCH confirm=true flips metadata_status to user_confirmed",
		OK:          stringValue(patched.MetadataStatus) == "user_confirmed",
		Detail:      fmt.Sprintf("status=%v", stringValue(patched.MetadataStatus)),
	})
	result.AddAssertion(probe.Assertion{
		Description: "PATCH persists user-supplied summary",
		OK:          patched.Summary != nil && *patched.Summary == overrideSummary,
		Detail:      fmt.Sprintf("summary=%q", stringValue(patched.Summary)),
	})
	result.AddAssertion(probe.Assertion{
		Description: "PATCH persists library=true",
		OK:          patched.Library != nil && *patched.Library,
		Detail:      fmt.Sprintf("library=%v", boolValue(patched.Library)),
	})

	// --- Drive 3: link the doc to the application.
	var link map[string]any
	if err := client.PostJSON(ctx, "/single-documents/"+docID+"/application-links", map[string]any{
		"application_id": trimSurrealID(app.ID),
	}, &link); err != nil {
		result.RecordSetupError(fmt.Errorf("POST application-link: %w", err))
		return nil
	}
	result.AddAssertion(probe.Assertion{
		Description: "POST application-link returns created link row",
		OK:          link["id"] != nil && link["created_by"] == "user_confirmed",
		Detail:      fmt.Sprintf("link=%v", link),
	})
	defer func() {
		_ = client.Delete(context.Background(),
			"/single-documents/"+docID+"/application-links/"+trimSurrealID(app.ID))
	}()

	// Re-fetch the application; the new library_documents array should include the doc.
	var apps []apiApplication
	if err := client.GetJSON(ctx, "/applications", &apps); err != nil {
		result.RecordSetupError(fmt.Errorf("list applications: %w", err))
		return nil
	}
	libraryHit := false
	for _, a := range apps {
		if a.ID != app.ID {
			continue
		}
		for _, ld := range a.LibraryDocuments {
			if strings.HasSuffix(ld.ID, docID) || ld.ID == docID {
				libraryHit = true
				break
			}
		}
	}
	result.AddAssertion(probe.Assertion{
		Description: "linked library doc appears under application.library_documents",
		OK:          libraryHit,
		Detail:      fmt.Sprintf("library hit=%v", libraryHit),
	})

	// Reject path: linking a non-library doc must 400. Create a fresh app with
	// another URL ingestion, find its doc, leave library=false, attempt link.
	if err := assertLibraryGuard(ctx, client, result, stamp); err != nil {
		result.AddNote("library guard check failed to set up: %v", err)
	}

	// --- Assert telemetry: at least one metadata.enrich_document span with
	// the matching document id. Skip silently if telemetry not available
	// (e.g. probe pointed at a backend with a different data dir).
	if tel != nil {
		spans, err := tel.SpansBetween(ctx, scenarioStart, time.Now())
		if err == nil {
			result.AddAssertion(probe.From(spans).
				Named("metadata.enrich_document").
				WithAttr("metadata.document_id", docID).
				RequireAtLeast(1, "metadata.enrich_document span fired for the queued doc"))
		} else {
			result.AddNote("telemetry query failed: %v", err)
		}
	}
	return nil
}

// assertLibraryGuard verifies that POST application-links rejects with 400
// when the target doc has library != true. Uses a second application+doc so
// the main scenario's library state is untouched.
func assertLibraryGuard(ctx context.Context, client *probe.Client, result *probe.Result, stamp int64) error {
	var guardApp apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"company_name":        fmt.Sprintf("Metadata Probe Guard %d", stamp),
		"position":            "Library Guard",
		"job_description_url": "https://example.com",
	}, &guardApp); err != nil {
		return err
	}
	defer func() {
		_ = client.Delete(context.Background(), "/applications/"+guardApp.ID)
		if guardApp.CompanyID != "" {
			_ = client.Delete(context.Background(), "/companies/"+trimSurrealID(guardApp.CompanyID))
		}
	}()
	var guardDocs []apiDocument
	if err := client.GetJSON(ctx, "/applications/"+guardApp.ID+"/documents", &guardDocs); err != nil {
		return err
	}
	if len(guardDocs) == 0 {
		return fmt.Errorf("guard app has no docs")
	}
	guardDocID := trimSurrealID(guardDocs[0].ID)
	// Do NOT flip library=true. Attempt the link; expect HTTP 400.
	_, code, _ := client.Do(ctx, "POST",
		"/single-documents/"+guardDocID+"/application-links",
		map[string]any{"application_id": trimSurrealID(guardApp.ID)},
	)
	result.AddAssertion(probe.Assertion{
		Description: "POST application-link on library=false doc returns 400",
		OK:          code == 400,
		Detail:      fmt.Sprintf("http_status=%d", code),
	})
	return nil
}

// waitForMetadataStatus polls GET /single-documents and returns the most
// recent document state once metadata_status reaches one of `terminal`, or
// the timeout elapses (reached=false). Always returns a non-nil document so
// the caller can inspect what we last saw.
func waitForMetadataStatus(ctx context.Context, client *probe.Client, docID string, terminal []string, timeout time.Duration) (metadataDocument, bool, error) {
	deadline := time.Now().Add(timeout)
	var doc metadataDocument
	for time.Now().Before(deadline) {
		var docs []metadataDocument
		if err := client.GetJSON(ctx, "/single-documents", &docs); err != nil {
			return doc, false, err
		}
		for _, d := range docs {
			if strings.HasSuffix(d.ID, docID) {
				doc = d
				break
			}
		}
		status := stringValue(doc.MetadataStatus)
		for _, t := range terminal {
			if status == t {
				return doc, true, nil
			}
		}
		select {
		case <-ctx.Done():
			return doc, false, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return doc, false, nil
}

func stringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func boolValue(p *bool) bool {
	if p == nil {
		return false
	}
	return *p
}
