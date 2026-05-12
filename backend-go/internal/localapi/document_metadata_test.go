package localapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClassifierResultParse(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "glean_transcript_llm_response.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	got, err := parseClassifierResult(string(raw))
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if got.Kind != "interview_transcript" {
		t.Errorf("Kind = %q, want %q", got.Kind, "interview_transcript")
	}
	if got.Library == nil || *got.Library != false {
		t.Errorf("Library = %v, want non-nil false", got.Library)
	}
	if got.LibraryKind != nil {
		t.Errorf("LibraryKind = %v, want nil for application-scoped transcript", got.LibraryKind)
	}
	if got.InterviewStage == nil || *got.InterviewStage != "recruiter" {
		t.Errorf("InterviewStage = %v, want recruiter", got.InterviewStage)
	}
	if !strings.Contains(got.Summary, "Glean") {
		t.Errorf("Summary missing 'Glean': %q", got.Summary)
	}
	if len(got.Topics) < 3 {
		t.Errorf("Topics len = %d, want >= 3", len(got.Topics))
	}
	if len(got.CompanyRefs) == 0 {
		t.Errorf("CompanyRefs empty, want references to mentioned employers")
	}
	if len(got.PeopleRefs) == 0 {
		t.Errorf("PeopleRefs empty, want at least one")
	}
	if got.DatedEventAt == nil || *got.DatedEventAt == "" {
		t.Errorf("DatedEventAt = %v, want ISO timestamp", got.DatedEventAt)
	}
}

func TestParseClassifierResult_StripsFences(t *testing.T) {
	fenced := "```json\n{\"kind\":\"story\",\"library\":true,\"library_kind\":\"shared\",\"summary\":\"Cloud Connect platform story.\",\"topics\":[\"platform\"],\"company_refs\":[\"Google Cloud\"],\"people_refs\":[]}\n```"
	got, err := parseClassifierResult(fenced)
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if got.Kind != "story" {
		t.Errorf("Kind = %q, want story", got.Kind)
	}
	if got.Library == nil || *got.Library != true {
		t.Errorf("Library = %v, want non-nil true", got.Library)
	}
}

func TestParseClassifierResult_NormalisesUnknownEnums(t *testing.T) {
	body := `{"kind":"made_up_kind","library_kind":"invented","interview_stage":"nonsense","summary":"x","topics":[]}`
	got, err := parseClassifierResult(body)
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if got.Kind != "unclassified" {
		t.Errorf("Kind = %q, want unclassified (unknown -> fallback)", got.Kind)
	}
	if got.LibraryKind != nil {
		t.Errorf("LibraryKind = %v, want nil for unknown value", got.LibraryKind)
	}
	if got.InterviewStage != nil {
		t.Errorf("InterviewStage = %v, want nil for unknown value", got.InterviewStage)
	}
}

func TestParseClassifierResult_InfersLibraryFromKind(t *testing.T) {
	// LLM omitted "library" entirely; normaliseClassifierResult should set
	// it based on the kind alone so persistence has a definite value.
	body := `{"kind":"story","summary":"Datapad founding story.","topics":[]}`
	got, err := parseClassifierResult(body)
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if got.Library == nil || *got.Library != true {
		t.Errorf("Library = %v, want non-nil true (story is library by default)", got.Library)
	}

	body2 := `{"kind":"recruiter_notes","summary":"Initial recruiter call notes.","topics":[]}`
	got2, err := parseClassifierResult(body2)
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if got2.Library == nil || *got2.Library != false {
		t.Errorf("Library = %v, want non-nil false (recruiter_notes is app-scoped)", got2.Library)
	}
}

func TestParseClassifierResult_CapsArrays(t *testing.T) {
	body := `{
		"kind": "story",
		"summary": "x",
		"topics": ["a","b","c","d","e","f","g","h","i","j","k","l"],
		"company_refs": [],
		"people_refs": []
	}`
	got, err := parseClassifierResult(body)
	if err != nil {
		t.Fatalf("parseClassifierResult: %v", err)
	}
	if len(got.Topics) != 8 {
		t.Errorf("Topics len = %d, want 8 (capped)", len(got.Topics))
	}
}

func TestSurrealStringArray(t *testing.T) {
	if got := surrealStringArray(nil); got != "[]" {
		t.Errorf("nil slice => %q, want []", got)
	}
	got := surrealStringArray([]string{"alpha", `with "quote"`, "with\nnewline"})
	// Should produce a quoted-and-escaped Surreal array literal.
	if !strings.HasPrefix(got, "[") || !strings.HasSuffix(got, "]") {
		t.Errorf("surrealStringArray output not bracketed: %q", got)
	}
	if !strings.Contains(got, `"alpha"`) {
		t.Errorf("alpha not quoted in %q", got)
	}
}

func TestSurrealPeopleRefs(t *testing.T) {
	if got := surrealPeopleRefs(nil); got != "[]" {
		t.Errorf("nil slice => %q, want []", got)
	}
	got := surrealPeopleRefs([]classifierPersonRef{
		{Name: "Ben Alton", Role: "Hiring Manager"},
		{Name: "Christopher Haverman", Role: ""},
	})
	if !strings.Contains(got, "Ben Alton") {
		t.Errorf("missing first ref: %q", got)
	}
	if !strings.Contains(got, "Christopher Haverman") {
		t.Errorf("missing second ref: %q", got)
	}
}
