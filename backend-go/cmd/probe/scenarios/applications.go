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
		Name:        "applications",
		Description: "Create applications via the new modal payload shape — position+company derives a name, empty payload falls back to 'New application', and status transitions to closed via PATCH.",
		Run:         runApplications,
	})
}

type apiApplication struct {
	ID                     string `json:"id"`
	Name                   string `json:"name"`
	Status                 string `json:"status"`
	JobDescriptionURL      string `json:"job_description_url"`
	CompanyID              string `json:"company_id"`
	CompanyName            string `json:"company_name"`
	JobDescriptionIngested bool   `json:"job_description_ingested"`
	DocumentCount          int    `json:"document_count"`
}

func runApplications(ctx context.Context, client *probe.Client, tel *probe.TelemetryDB, result *probe.Result) error {
	ctx, cancel := context.WithTimeout(ctx, 1*time.Minute)
	defer cancel()

	stamp := time.Now().UnixNano()
	companyName := fmt.Sprintf("Probe Co %d", stamp)

	// Scenario A: position + company_name → name derived as "{position} at {company}"
	var appWithPosition apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"company_name": companyName,
		"position":     "Senior Engineer",
	}, &appWithPosition); err != nil {
		result.RecordSetupError(fmt.Errorf("create with position: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+appWithPosition.ID); err != nil {
			result.AddNote("cleanup position app failed: %v", err)
		}
	}()
	expectedName := "Senior Engineer at " + companyName
	result.AddAssertion(probe.Assertion{
		Description: "position+company derives application name",
		OK:          appWithPosition.Name == expectedName,
		Detail:      fmt.Sprintf("name=%q want=%q", appWithPosition.Name, expectedName),
	})
	result.AddAssertion(probe.Assertion{
		Description: "default status is in_progress",
		OK:          appWithPosition.Status == "in_progress",
		Detail:      "status=" + appWithPosition.Status,
	})
	result.AddAssertion(probe.Assertion{
		Description: "company_name reused or created on the fly",
		OK:          appWithPosition.CompanyName == companyName,
		Detail:      "company_name=" + appWithPosition.CompanyName,
	})

	// Scenario B: empty payload → falls back to "New application"
	var emptyApp apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"company_id": appWithPosition.CompanyID,
	}, &emptyApp); err != nil {
		result.RecordSetupError(fmt.Errorf("create empty: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+emptyApp.ID); err != nil {
			result.AddNote("cleanup empty app failed: %v", err)
		}
	}()
	result.AddAssertion(probe.Assertion{
		Description: "empty payload falls back to 'New application'",
		OK:          emptyApp.Name == "New application",
		Detail:      "name=" + emptyApp.Name,
	})

	// Scenario C: status transitions to closed via PATCH and persists.
	var patched apiApplication
	if err := client.Patch(ctx, "/applications/"+appWithPosition.ID, map[string]any{
		"status": "closed",
	}, &patched); err != nil {
		result.RecordSetupError(fmt.Errorf("patch status: %w", err))
		return nil
	}
	result.AddAssertion(probe.Assertion{
		Description: "PATCH status=closed persists",
		OK:          patched.Status == "closed",
		Detail:      "status=" + patched.Status,
	})

	// Scenario D: PATCH with invalid status is rejected.
	rejectErr := client.Patch(ctx, "/applications/"+appWithPosition.ID, map[string]any{
		"status": "bogus",
	}, &patched)
	result.AddAssertion(probe.Assertion{
		Description: "PATCH with invalid status returns error",
		OK:          rejectErr != nil,
		Detail:      fmt.Sprintf("err=%v", rejectErr),
	})

	// Scenario E: job_description_url is fetched and persisted as a document.
	// example.com is small, stable HTML — sufficient to exercise the ingestion path
	// without depending on a third-party careers page.
	var appWithJobURL apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"company_name":        companyName,
		"position":            "Probe Ingest Role",
		"job_description_url": "https://example.com",
	}, &appWithJobURL); err != nil {
		result.RecordSetupError(fmt.Errorf("create with job url: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+appWithJobURL.ID); err != nil {
			result.AddNote("cleanup job-url app failed: %v", err)
		}
	}()
	result.AddAssertion(probe.Assertion{
		Description: "create response signals job_description_ingested when URL was reachable",
		OK:          appWithJobURL.JobDescriptionIngested,
		Detail:      fmt.Sprintf("ingested=%v", appWithJobURL.JobDescriptionIngested),
	})
	var docs []apiDocument
	if err := client.GetJSON(ctx, "/applications/"+appWithJobURL.ID+"/documents", &docs); err != nil {
		result.RecordSetupError(fmt.Errorf("list job-url app docs: %w", err))
		return nil
	}
	foundJobDoc := false
	for _, d := range docs {
		if d.Filename == "Job description.md" {
			foundJobDoc = true
			break
		}
	}
	result.AddAssertion(probe.Assertion{
		Description: "Job description.md is persisted on the new application",
		OK:          foundJobDoc,
		Detail:      fmt.Sprintf("doc_count=%d", len(docs)),
	})

	// Scenario F: creating an application with no company at all succeeds
	// and lands on the "Unknown Company" placeholder.
	var noCompanyApp apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{}, &noCompanyApp); err != nil {
		result.RecordSetupError(fmt.Errorf("create with no company: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+noCompanyApp.ID); err != nil {
			result.AddNote("cleanup no-company app failed: %v", err)
		}
	}()
	result.AddAssertion(probe.Assertion{
		Description: "create with empty payload assigns the Unknown company",
		OK:          noCompanyApp.CompanyName == "Unknown Company",
		Detail:      "company_name=" + noCompanyApp.CompanyName,
	})

	// Scenario G: the Unknown placeholder company cannot be deleted.
	if noCompanyApp.CompanyID != "" {
		unknownID := trimSurrealID(noCompanyApp.CompanyID)
		delErr := client.Delete(ctx, "/companies/"+unknownID)
		result.AddAssertion(probe.Assertion{
			Description: "Unknown placeholder company refuses deletion",
			OK:          delErr != nil,
			Detail:      fmt.Sprintf("err=%v", delErr),
		})
	}

	// Scenario H: a Greenhouse posting URL creates a slug-named company,
	// and a second posting on the same slug reuses it via the stored
	// job_board_identity instead of creating a duplicate. Uses a fixture
	// slug derived from the test stamp so it never collides with the user's
	// real applications. Note: we cannot actually fetch the made-up
	// example.com Greenhouse path, but URL parsing happens before fetch
	// and the company-resolution path is what we're asserting here.
	probeSlug := fmt.Sprintf("probe-co-%d", stamp)
	greenhouseURL1 := "https://job-boards.greenhouse.io/" + probeSlug + "/jobs/1"
	greenhouseURL2 := "https://job-boards.greenhouse.io/" + probeSlug + "/jobs/2"
	var firstGH apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"job_description_url": greenhouseURL1,
	}, &firstGH); err != nil {
		result.RecordSetupError(fmt.Errorf("create with greenhouse url #1: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+firstGH.ID); err != nil {
			result.AddNote("cleanup greenhouse app #1 failed: %v", err)
		}
		// Also clean up the company the URL parser created.
		if firstGH.CompanyID != "" {
			_ = client.Delete(context.Background(), "/companies/"+trimSurrealID(firstGH.CompanyID))
		}
	}()
	expectedCompanyName := strings.Title(strings.ReplaceAll(probeSlug, "-", " ")) //nolint:staticcheck // Title is deprecated but adequate for the slug shape we control.
	result.AddAssertion(probe.Assertion{
		Description: "Greenhouse URL creates a slug-derived company instead of Unknown",
		OK:          firstGH.CompanyName == expectedCompanyName,
		Detail:      fmt.Sprintf("company_name=%q want=%q", firstGH.CompanyName, expectedCompanyName),
	})

	var secondGH apiApplication
	if err := client.PostJSON(ctx, "/applications", map[string]any{
		"job_description_url": greenhouseURL2,
	}, &secondGH); err != nil {
		result.RecordSetupError(fmt.Errorf("create with greenhouse url #2: %w", err))
		return nil
	}
	defer func() {
		if err := client.Delete(context.Background(), "/applications/"+secondGH.ID); err != nil {
			result.AddNote("cleanup greenhouse app #2 failed: %v", err)
		}
	}()
	result.AddAssertion(probe.Assertion{
		Description: "Second Greenhouse posting on the same slug reuses the existing company",
		OK:          secondGH.CompanyID == firstGH.CompanyID,
		Detail:      fmt.Sprintf("company_id=%q first_company_id=%q", secondGH.CompanyID, firstGH.CompanyID),
	})

	return nil
}

// trimSurrealID strips the "<table>:" prefix from a surreal record id.
// API endpoints accept either the bare id or the prefixed form, but the
// path segment is cleaner without it.
func trimSurrealID(id string) string {
	if _, after, ok := strings.Cut(id, ":"); ok {
		return after
	}
	return id
}
