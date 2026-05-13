package localapi

import (
	"context"
	"strings"
	"testing"

	"github.com/CaliLuke/luke/backend-go/internal/localdata"
)

// TestBuildApplicationContextPromptParsesAgainstSurrealDB exercises the
// system-prompt builder used by every application-scoped chat against a real
// SurrealDB. The function is best-effort and swallows DB errors at runtime —
// without this test, a SurrealQL drift (e.g. ORDER BY field missing from
// SELECT) shows up as a silent empty application context that the model then
// papers over by calling create_application without the user-supplied name.
// Failing the parse in CI keeps that loop from leaking into production.
func TestBuildApplicationContextPromptParsesAgainstSurrealDB(t *testing.T) {
	app, err := localdata.Open(context.Background(), localdata.Options{
		DataDir:          t.TempDir(),
		LocalStorageRoot: t.TempDir(),
		WorkerID:         "app-context-test",
	})
	if err != nil {
		t.Fatalf("open localdata app: %v", err)
	}
	defer func() {
		if closeErr := app.Close(context.Background()); closeErr != nil {
			t.Fatalf("close localdata app: %v", closeErr)
		}
	}()

	server := &Server{app: app}
	ctx := context.Background()

	company, err := server.createCompany(ctx, "Acme", nil)
	if err != nil {
		t.Fatalf("create company: %v", err)
	}
	companyID := asString(company["id"])
	if companyID == "" {
		t.Fatalf("createCompany returned no id: %#v", company)
	}
	// recordID() wraps the bare id with the table prefix; createApplication
	// expects the unprefixed form, so strip the "companies:" prefix.
	companyShortID := strings.TrimPrefix(companyID, "companies:")

	jdURL := "https://example.com/jd"
	appRow, err := server.createApplication(ctx, createApplicationInput{
		Name:              "Principal Product Manager",
		CompanyID:         companyShortID,
		JobDescriptionURL: &jdURL,
	})
	if err != nil {
		t.Fatalf("create application: %v", err)
	}
	applicationID := asString(appRow["id"])
	if applicationID == "" {
		t.Fatalf("createApplication returned no id: %#v", appRow)
	}
	applicationShortID := strings.TrimPrefix(applicationID, "applications:")

	// Both branches matter: empty document list (early return) AND a populated
	// one (ORDER BY path). Exercise empty first, then add a document and
	// re-run.
	prompt, err := server.buildApplicationContextPrompt(ctx, applicationShortID)
	if err != nil {
		t.Fatalf("buildApplicationContextPrompt (no docs): %v", err)
	}
	if prompt == "" {
		t.Fatalf("expected non-empty prompt for known application, got empty")
	}
	if !strings.Contains(prompt, "Principal Product Manager") {
		t.Fatalf("prompt missing application name: %q", prompt)
	}
	if !strings.Contains(prompt, "(none attached yet)") {
		t.Fatalf("prompt missing empty-document marker: %q", prompt)
	}

	// Insert a minimal document row directly so the ORDER BY branch runs.
	// We only need the columns the SELECT projects (id, filename, kind) plus
	// application_id for the WHERE.
	docID := newID("doc")
	if _, err := app.DB.Query(ctx, "CREATE "+recordID("documents", docID)+
		" CONTENT { user_id: users:local, application_id: "+recordID("applications", applicationShortID)+
		", filename: \"resume.pdf\", kind: \"resume\", size_bytes: 0, status: \"ready\","+
		" created_at: time::now(), updated_at: time::now() };"); err != nil {
		t.Fatalf("seed document: %v", err)
	}

	prompt, err = server.buildApplicationContextPrompt(ctx, applicationShortID)
	if err != nil {
		t.Fatalf("buildApplicationContextPrompt (with doc): %v", err)
	}
	if !strings.Contains(prompt, "resume.pdf") {
		t.Fatalf("prompt missing attached document: %q", prompt)
	}
	if !strings.Contains(prompt, "kind=resume") {
		t.Fatalf("prompt missing document kind: %q", prompt)
	}
}
