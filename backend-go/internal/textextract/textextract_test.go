package textextract

import (
	"context"
	"strings"
	"testing"
)

func TestExtractPlainTextRoundTrips(t *testing.T) {
	r := Extract(context.Background(), "notes.txt", []byte("hello world"))
	if r.Status != StatusOK {
		t.Fatalf("status = %s, want ok", r.Status)
	}
	if r.Text != "hello world" {
		t.Fatalf("text = %q", r.Text)
	}
}

func TestExtractMarkdownIsTreatedAsText(t *testing.T) {
	body := "# heading\n\nbody paragraph"
	r := Extract(context.Background(), "doc.md", []byte(body))
	if r.Status != StatusOK || r.Text != body {
		t.Fatalf("md text: status=%s text=%q", r.Status, r.Text)
	}
}

func TestExtractUnsupportedTypeIsSkipped(t *testing.T) {
	r := Extract(context.Background(), "image.png", []byte{0x89, 0x50, 0x4e, 0x47})
	if r.Status != StatusSkipped {
		t.Fatalf("status = %s, want skipped", r.Status)
	}
	if r.Reason != "unsupported_type" {
		t.Fatalf("reason = %q", r.Reason)
	}
}

func TestExtractInvalidPDFReturnsFailed(t *testing.T) {
	r := Extract(context.Background(), "broken.pdf", []byte("not a real pdf"))
	if r.Status != StatusFailed {
		t.Fatalf("status = %s, want failed", r.Status)
	}
	if r.Error == "" {
		t.Fatalf("expected non-empty error message")
	}
}

func TestExtractInvalidDocxReturnsFailed(t *testing.T) {
	r := Extract(context.Background(), "broken.docx", []byte("not a zip"))
	if r.Status != StatusFailed {
		t.Fatalf("status = %s, want failed (got reason=%s err=%s)", r.Status, r.Reason, r.Error)
	}
}

// Minimal valid-but-empty .docx: a zip with word/document.xml that has no
// `<w:t>` runs. Should be reported as skipped/empty rather than failed.
func TestExtractEmptyDocxStatusSkipped(t *testing.T) {
	// Build a docx in memory.
	docx := buildEmptyDocx(t)
	r := Extract(context.Background(), "empty.docx", docx)
	if r.Status != StatusSkipped {
		t.Fatalf("status = %s, want skipped (reason=%s err=%s text=%q)", r.Status, r.Reason, r.Error, r.Text)
	}
}

// PDF extraction frequently produces \x00 glyph-id bytes (and similar
// C0 controls) when the producer didn't ship a ToUnicode cmap. Those
// can't be encoded in a SurrealQL string literal (only \n \t \r \" \\
// \uXXXX are supported), so we strip them before returning the twin.
// Without this, upload UPSERTs hit "Parse error: Invalid escape sequence".
func TestSanitizeStripsControlBytesExceptWhitespace(t *testing.T) {
	// Input contains:
	//   \x00 (NUL) and \x01 (SOH)         — must be stripped
	//   \n \t \r                          — must be kept
	//   \x7f (DEL)                        — must be stripped
	//   literal letters around them       — must be kept
	in := "ok line\n\x00garbage\x01here\ttab\rcr\x7fafter-del"
	got := sanitizeText(in)
	want := "ok line\ngarbagehere\ttab\rcrafter-del"
	if got != want {
		t.Fatalf("sanitize:\n got:  %q\n want: %q", got, want)
	}
}

func TestSanitizePreservesUTF8(t *testing.T) {
	in := "Élégant — 日本語\x00emoji 😀"
	got := sanitizeText(in)
	want := "Élégant — 日本語emoji 😀"
	if got != want {
		t.Fatalf("utf8:\n got:  %q\n want: %q", got, want)
	}
}

func TestExtractDocxWithTextProducesText(t *testing.T) {
	docx := buildDocxWith(t, "hello from docx")
	r := Extract(context.Background(), "doc.docx", docx)
	if r.Status != StatusOK {
		t.Fatalf("status = %s, want ok (reason=%s err=%s)", r.Status, r.Reason, r.Error)
	}
	if !strings.Contains(r.Text, "hello from docx") {
		t.Fatalf("expected text to contain 'hello from docx', got %q", r.Text)
	}
}
