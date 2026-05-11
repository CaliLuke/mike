// Package textextract pulls plain-text "twins" out of binary documents
// (PDF, DOCX) so the assistant can consume their contents without
// re-parsing the binary on every read. The Extract entry-point lives
// here (rather than in localapi) so the localdata upload workflow can
// extract at write time without creating a localapi import cycle.
package textextract

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	pdf "github.com/ledongthuc/pdf"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

var tracer = otel.Tracer("luke/textextract")

// Status reports whether extraction succeeded, was deliberately skipped
// (file type doesn't need extraction, content is already text), or failed.
type Status string

const (
	StatusOK      Status = "ok"
	StatusSkipped Status = "skipped"
	StatusFailed  Status = "failed"
)

// Result carries the extracted text alongside metadata the caller needs
// to persist the twin (or log why no twin exists).
type Result struct {
	Text   string
	Status Status
	Reason string // "txt", "pdf", "docx", "unsupported_type", "empty_extraction"
	Error  string // non-empty when Status == StatusFailed
}

// sanitizeText strips control bytes that SurrealQL's string literal can't
// represent (it accepts only \n \t \r \" \\ \uXXXX — not \x form). PDF
// extraction in particular often returns 0x00 glyph-id bytes which would
// otherwise corrupt the persisted twin and trip parse errors at upload.
// Printable ASCII, common whitespace, and any non-ASCII byte (valid UTF-8
// runes) all pass through unchanged.
func sanitizeText(s string) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n', r == '\r', r == '\t':
			b.WriteRune(r)
		case r < 0x20: // any other C0 control byte
			continue
		case r == 0x7f: // DEL
			continue
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Extract dispatches on filename extension and returns the plain-text
// content of the file. Spans the operation so the upload trace shows how
// long extraction took + how much text came out.
//
// The function never returns an error — extraction failures are reported
// via Result.Status / Result.Error. Callers want to persist the version
// row regardless of extraction outcome.
func Extract(ctx context.Context, filename string, data []byte) Result {
	_, span := tracer.Start(ctx, "textextract.extract")
	defer span.End()
	ext := strings.ToLower(filepath.Ext(filename))
	span.SetAttributes(
		attribute.String("doc.filename", filename),
		attribute.String("doc.ext", ext),
		attribute.Int("doc.bytes", len(data)),
	)

	finish := func(text string, status Status, reason string, errMsg string) Result {
		// Sanitize before reporting char counts so the span value matches
		// what gets persisted. Record both raw and sanitized lengths so an
		// outsized delta is visible (signals a glyph-id-soup PDF).
		sanitized := sanitizeText(text)
		span.SetAttributes(
			attribute.Int("doc.text_raw_chars", len(text)),
			attribute.Int("doc.text_chars", len(sanitized)),
			attribute.Int("doc.text_chars_stripped", len(text)-len(sanitized)),
			attribute.String("doc.extract_reason", reason),
			attribute.String("doc.extract_status", string(status)),
		)
		return Result{Text: sanitized, Status: status, Reason: reason, Error: errMsg}
	}

	switch ext {
	case ".txt", ".md", ".markdown", ".csv", ".json":
		return finish(string(data), StatusOK, "plain_text", "")

	case ".pdf":
		text, err := extractPDF(data)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(
				attribute.String("doc.extract_reason", "pdf"),
				attribute.String("doc.extract_status", string(StatusFailed)),
			)
			return Result{Status: StatusFailed, Reason: "pdf", Error: err.Error()}
		}
		if strings.TrimSpace(text) == "" {
			span.SetAttributes(
				attribute.String("doc.extract_reason", "pdf"),
				attribute.String("doc.extract_status", string(StatusSkipped)),
			)
			return Result{Status: StatusSkipped, Reason: "empty_pdf_extraction"}
		}
		return finish(text, StatusOK, "pdf", "")

	case ".docx":
		text, err := extractDocx(data)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(
				attribute.String("doc.extract_reason", "docx"),
				attribute.String("doc.extract_status", string(StatusFailed)),
			)
			return Result{Status: StatusFailed, Reason: "docx", Error: err.Error()}
		}
		if strings.TrimSpace(text) == "" {
			span.SetAttributes(
				attribute.String("doc.extract_reason", "docx"),
				attribute.String("doc.extract_status", string(StatusSkipped)),
			)
			return Result{Status: StatusSkipped, Reason: "empty_docx_extraction"}
		}
		return finish(text, StatusOK, "docx", "")
	}

	span.SetAttributes(
		attribute.String("doc.extract_reason", "unsupported_type"),
		attribute.String("doc.extract_status", string(StatusSkipped)),
	)
	return Result{Status: StatusSkipped, Reason: "unsupported_type"}
}

func extractPDF(data []byte) (string, error) {
	reader, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var out strings.Builder
	fonts := map[string]*pdf.Font{}
	for pageNum := 1; pageNum <= reader.NumPage(); pageNum++ {
		page := reader.Page(pageNum)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(fonts)
		if err != nil {
			return "", err
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if out.Len() > 0 {
			out.WriteString("\n\n")
		}
		out.WriteString("[Page ")
		fmt.Fprint(&out, pageNum)
		out.WriteString("]\n")
		out.WriteString(text)
	}
	return out.String(), nil
}

// extractDocx pulls plain text out of a DOCX zip. Reads only word/document.xml
// (and footnotes/endnotes when present) and walks `<w:t>` runs in document
// order, dropping styling. Good enough for an LLM "twin"; not preserving
// formatting because the assistant works against the prose, not the layout.
func extractDocx(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var out strings.Builder
	for _, file := range reader.File {
		if file.Name != "word/document.xml" &&
			file.Name != "word/footnotes.xml" &&
			file.Name != "word/endnotes.xml" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return "", err
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return "", err
		}
		decoder := xml.NewDecoder(bytes.NewReader(body))
		for {
			tok, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				return "", err
			}
			switch t := tok.(type) {
			case xml.StartElement:
				if t.Name.Local == "t" {
					var text string
					if err := decoder.DecodeElement(&text, &t); err == nil {
						if strings.TrimSpace(text) != "" {
							out.WriteString(text)
						}
					}
				}
				if t.Name.Local == "p" {
					if out.Len() > 0 {
						out.WriteString("\n")
					}
				}
				if t.Name.Local == "br" || t.Name.Local == "tab" {
					out.WriteString(" ")
				}
			}
		}
	}
	return strings.TrimSpace(out.String()), nil
}
