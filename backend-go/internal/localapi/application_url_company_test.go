package localapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestCreateApplicationWithGreenhouseURLCreatesTypefaceCompany exercises the
// real handler path the user hits when submitting a Greenhouse posting URL
// with no company. The URL parser must:
//  1. Match the URL → board=greenhouse, slug=typeface.
//  2. Land on the Unknown placeholder because no company is supplied and
//     no existing company has the identity yet.
//  3. Upgrade off Unknown to a fresh "Typeface" company tagged with
//     "greenhouse:typeface".
//
// Reproduces the user-reported regression where "typeface was not created
// as a company". A real HTTP fetch to the URL is going to fail in this
// test environment, but that's fine — board matching runs on the URL
// alone, before the fetch.
func TestCreateApplicationWithGreenhouseURLCreatesTypefaceCompany(t *testing.T) {
	handler, closeApp := newTestHandler(t)
	defer closeApp()

	app := postJSONForTest(t, handler, "/applications", map[string]any{
		"job_description_url": "https://job-boards.greenhouse.io/typeface/jobs/5103539007?gh_src=c2824f177us",
	}, http.StatusCreated)

	if got := asString(app["company_name"]); got != "Typeface" {
		t.Fatalf("company_name = %q, want %q (full response: %#v)", got, "Typeface", app)
	}
	companyID := trimRecord(asString(app["company_id"]))
	if companyID == "" {
		t.Fatalf("company_id missing on application: %#v", app)
	}

	// The freshly created company must show up in /companies and carry
	// the greenhouse:typeface identity so the next posting on the same
	// slug reuses it.
	req := httptest.NewRequest(http.MethodGet, "/companies", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /companies status = %d, want 200", rec.Code)
	}
	var companies []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &companies); err != nil {
		t.Fatalf("decode /companies: %v", err)
	}
	var typeface map[string]any
	for _, c := range companies {
		if asString(c["name"]) == "Typeface" {
			typeface = c
			break
		}
	}
	if typeface == nil {
		t.Fatalf("Typeface company not found in /companies; got: %#v", companies)
	}
	identities := jobBoardIdentitiesFromRow(typeface)
	found := false
	for _, id := range identities {
		if id == "greenhouse:typeface" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Typeface company is missing greenhouse:typeface identity; identities = %v", identities)
	}
}

// TestCreateApplicationWithGreenhouseURLReusesExistingCompany confirms the
// second posting for the same slug attaches to the same company instead of
// creating a duplicate.
func TestCreateApplicationWithGreenhouseURLReusesExistingCompany(t *testing.T) {
	handler, closeApp := newTestHandler(t)
	defer closeApp()

	first := postJSONForTest(t, handler, "/applications", map[string]any{
		"job_description_url": "https://job-boards.greenhouse.io/typeface/jobs/1",
	}, http.StatusCreated)
	firstCompanyID := trimRecord(asString(first["company_id"]))
	if firstCompanyID == "" || asString(first["company_name"]) != "Typeface" {
		t.Fatalf("first create did not produce Typeface company: %#v", first)
	}

	second := postJSONForTest(t, handler, "/applications", map[string]any{
		"job_description_url": "https://boards.greenhouse.io/typeface/jobs/2",
	}, http.StatusCreated)
	secondCompanyID := trimRecord(asString(second["company_id"]))
	if secondCompanyID != firstCompanyID {
		t.Fatalf("second posting created a duplicate company: first=%q second=%q (name=%q)",
			firstCompanyID, secondCompanyID, asString(second["company_name"]))
	}

	// Sanity check: only one Typeface company exists.
	req := httptest.NewRequest(http.MethodGet, "/companies", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var companies []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &companies)
	typefaceCount := 0
	for _, c := range companies {
		if strings.EqualFold(asString(c["name"]), "Typeface") {
			typefaceCount++
		}
	}
	if typefaceCount != 1 {
		t.Errorf("expected exactly one Typeface company, found %d", typefaceCount)
	}
}
