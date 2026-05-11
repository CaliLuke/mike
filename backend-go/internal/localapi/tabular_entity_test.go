package localapi

import (
	"strings"
	"testing"
)

func TestParseAnchorList(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		input     string
		wantCount int
		wantFirst string // expected first anchor label, or "" to skip
		wantErr   bool
	}{
		{
			name:      "bare json array",
			input:     `[{"label":"A","summary":"sa"},{"label":"B"}]`,
			wantCount: 2,
			wantFirst: "A",
		},
		{
			name:      "empty array",
			input:     `[]`,
			wantCount: 0,
		},
		{
			name:      "whitespace empty",
			input:     "   \n  ",
			wantCount: 0,
		},
		{
			name:      "fenced json",
			input:     "```json\n[{\"label\":\"X\"}]\n```",
			wantCount: 1,
			wantFirst: "X",
		},
		{
			name:      "fenced no lang",
			input:     "```\n[{\"label\":\"Y\"}]\n```",
			wantCount: 1,
			wantFirst: "Y",
		},
		{
			name:      "anchors wrapper object",
			input:     `{"anchors":[{"label":"W"}]}`,
			wantCount: 1,
			wantFirst: "W",
		},
		{
			name:      "extra fields collapse into metadata",
			input:     `[{"label":"Z","company":"Acme","year":2024}]`,
			wantCount: 1,
			wantFirst: "Z",
		},
		{
			name: "prose around an embedded array",
			input: `Here are the anchors I found:
[{"label":"P1"},{"label":"P2"}]
Hope this helps.`,
			wantCount: 2,
			wantFirst: "P1",
		},
		{
			name:    "garbage",
			input:   `not json at all`,
			wantErr: true,
		},
		{
			name:      "anchor with metadata object",
			input:     `[{"label":"M","metadata":{"company":"Acme","role":"Eng"}}]`,
			wantCount: 1,
			wantFirst: "M",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseAnchorList(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got anchors=%v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != tc.wantCount {
				t.Fatalf("count = %d, want %d. anchors=%v", len(got), tc.wantCount, got)
			}
			if tc.wantFirst != "" && (len(got) == 0 || got[0].Label != tc.wantFirst) {
				t.Fatalf("first label = %q, want %q", anchorLabel(got, 0), tc.wantFirst)
			}
		})
	}
}

func anchorLabel(anchors []Anchor, i int) string {
	if i < 0 || i >= len(anchors) {
		return ""
	}
	return anchors[i].Label
}

func TestParseAnchorListPreservesExtraMetadata(t *testing.T) {
	t.Parallel()
	got, err := parseAnchorList(`[{"label":"M","company":"Acme","year":2024}]`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 anchor, got %d", len(got))
	}
	if got[0].Metadata["company"] != "Acme" {
		t.Fatalf("company metadata = %v", got[0].Metadata["company"])
	}
	if v, ok := got[0].Metadata["year"]; !ok {
		t.Fatalf("year metadata missing: %v", got[0].Metadata)
	} else if _, isNumber := v.(float64); !isNumber {
		t.Fatalf("year coerced wrong type: %T", v)
	}
}

func TestStripCodeFences(t *testing.T) {
	t.Parallel()
	if got := stripCodeFences("```json\n[]\n```"); got != "[]" {
		t.Fatalf("stripCodeFences fenced: got %q", got)
	}
	if got := stripCodeFences("plain"); got != "plain" {
		t.Fatalf("stripCodeFences plain mutated: got %q", got)
	}
}

func TestFindMatchingBracket(t *testing.T) {
	t.Parallel()
	s := `prefix [1, [2, 3], 4] suffix`
	open := strings.Index(s, "[")
	end := findMatchingBracket(s, open)
	if end < 0 || s[end] != ']' {
		t.Fatalf("findMatchingBracket end = %d (char %q)", end, byteOrEmpty(s, end))
	}
	if got := s[open : end+1]; got != "[1, [2, 3], 4]" {
		t.Fatalf("substring = %q", got)
	}
}

func byteOrEmpty(s string, i int) byte {
	if i < 0 || i >= len(s) {
		return 0
	}
	return s[i]
}
