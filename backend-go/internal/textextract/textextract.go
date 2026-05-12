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
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"path/filepath"
	"strings"

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
		text, backend, err := extractPDFViaSpdf(ctx, data)
		span.SetAttributes(attribute.String("doc.pdf_backend", backend))
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			span.SetAttributes(
				attribute.String("doc.extract_reason", "pdf"),
				attribute.String("doc.extract_status", string(StatusFailed)),
			)
			slog.ErrorContext(ctx, "textextract.pdf_failed",
				"filename", filename, "backend", backend, "error", err.Error())
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

// spdfBinaryName is the executable we shell out to. spdf
// (https://github.com/Fanaperana/spdf) is a Rust binary that embeds
// Chrome's PDFium engine, giving us proper CMap / glyph-to-Unicode
// translation that the pure-Go libraries (ledongthuc/pdf, pdfcpu)
// can't reliably do for PDFs with custom font subsets.
//
// Install once per dev machine with:
//
//	cargo install spdf-cli --version 0.2.0-alpha.2
const spdfBinaryName = "spdf"

// extractPDFViaSpdf is the production PDF extractor. Returns the
// extracted text plus a backend identifier we emit as a span attribute
// so telemetry shows which path each upload took. Returns an explicit
// error when spdf isn't on PATH so the operator gets a clear "install
// spdf" message instead of silently falling back to a broken extractor.
//
// We pipe the PDF bytes via stdin (`spdf parse -`) rather than writing
// a temp file: simpler, no FS cleanup, and matches the pattern other
// shell-outs in this repo use (LibreOffice for DOCX preview).
func extractPDFViaSpdf(ctx context.Context, data []byte) (text, backend string, err error) {
	backend = "spdf"
	bin, lookErr := exec.LookPath(spdfBinaryName)
	if lookErr != nil {
		return "", backend, fmt.Errorf("spdf binary not found on PATH (install with `cargo install spdf-cli --version 0.2.0-alpha.2`): %w", lookErr)
	}
	// --no-ocr keeps this call to the PDFium text path. Scanned / image-only
	// docs that need OCR will produce empty output here and be reported as
	// Status=Skipped by the caller, which is the right signal to the UI.
	// A future flag could re-enable OCR for documents marked image-only.
	cmd := exec.CommandContext(ctx, bin, "parse", "-", "-o", "/dev/stdout", "--no-ocr", "--quiet")
	cmd.Stdin = bytes.NewReader(data)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if runErr := cmd.Run(); runErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = runErr.Error()
		}
		return "", backend, fmt.Errorf("spdf parse: %s", msg)
	}
	return stdout.String(), backend, nil
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
			if errors.Is(err, io.EOF) {
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
