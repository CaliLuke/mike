package localapi

import (
	"strings"
	"testing"
)

func TestBuildSimpleDocxExtractsText(t *testing.T) {
	data, err := buildSimpleDocx("Resume Draft", []generatedDocxSection{
		{Heading: "Summary", Level: 1, Content: "Built local-first AI workbench.\n- Improved backend parity."},
		{Heading: "Skills", Level: 2, TableHeaders: []string{"Tool", "Use"}, TableRows: [][]string{{"Go", "Backend"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	text, err := extractDocxText(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"RESUME DRAFT", "1. SUMMARY", "Built local-first AI workbench.", "Improved backend parity.", "Go", "Backend"} {
		if !strings.Contains(text, want) {
			t.Fatalf("extracted text missing %q:\n%s", want, text)
		}
	}
}

func TestApplyTrackedEditsToDocx(t *testing.T) {
	data, err := buildSimpleDocx("Resume Draft", []generatedDocxSection{{Content: "Built local-first AI workbench."}})
	if err != nil {
		t.Fatal(err)
	}
	edited, results, err := applyTrackedEditsToDocx(data, []trackedEditRequest{{Find: "local-first", Replace: "career-focused", Reason: "Tailor wording"}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("results = %d, want 1", len(results))
	}
	text, err := extractDocxText(edited)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "local-first") || !strings.Contains(text, "career-focused") {
		t.Fatalf("tracked edit text missing deleted/inserted content:\n%s", text)
	}
	accepted, changed, err := applyTrackedChange(edited, true, results[0].ChangeID)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("accept did not change document")
	}
	acceptedText, err := extractDocxText(accepted)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(acceptedText, "local-first") || !strings.Contains(acceptedText, "career-focused") {
		t.Fatalf("accepted text wrong:\n%s", acceptedText)
	}
}

func TestApplyTrackedChangeTargetsOneEdit(t *testing.T) {
	data, err := buildSimpleDocx("Resume Draft", []generatedDocxSection{{Content: "Built local-first AI workbench.\nWrote resume bullets."}})
	if err != nil {
		t.Fatal(err)
	}
	edited, results, err := applyTrackedEditsToDocx(data, []trackedEditRequest{
		{Find: "local-first", Replace: "career-focused"},
		{Find: "resume bullets", Replace: "job-search materials"},
	}, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("results = %d, want 2", len(results))
	}
	accepted, changed, err := applyTrackedChange(edited, true, results[0].ChangeID)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Logf("change ids: %#v", results)
		if text, textErr := extractDocxText(edited); textErr == nil {
			t.Logf("edited text: %s", text)
		}
		t.Fatal("accept did not change document")
	}
	text, err := extractDocxText(accepted)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "local-first") || !strings.Contains(text, "career-focused") {
		t.Fatalf("first edit was not accepted:\n%s", text)
	}
	if !strings.Contains(text, "resume bullets") || !strings.Contains(text, "job-search materials") {
		t.Fatalf("second edit should remain pending with deleted and inserted text:\n%s", text)
	}
}

func TestApplyTrackedEditsNormalizesRunSplitText(t *testing.T) {
	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>senior </w:t></w:r><w:r><w:t>engineer</w:t></w:r></w:p></w:body></w:document>`
	editedXML, results := applyTrackedEditsToDocumentXML(documentXML, []trackedEditRequest{{Find: "senior engineer", Replace: "principal engineer"}}, 1)
	if len(results) != 1 {
		t.Fatalf("results = %d, want 1", len(results))
	}
	if !strings.Contains(editedXML, `<w:del w:id="1"`) || !strings.Contains(editedXML, "principal engineer") {
		t.Fatalf("run-split text was not tracked-edited:\n%s", editedXML)
	}
}
