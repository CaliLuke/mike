// pdfextract-compare runs multiple PDF text-extraction backends against the
// same input file and reports a side-by-side comparison so we can pick the
// one that handles modern custom-font CMaps correctly.
//
// Usage:
//
//	go run ./cmd/pdfextract-compare /path/to/file.pdf
//
// Each backend is invoked from an isolated function. Failure of one backend
// is logged but does not stop the others. Output is grouped by backend with
// a head sample, total char count, and a crude "readable" score so the
// caller can scan results visually.
package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"

	gxpdf "github.com/coregx/gxpdf"
	ledongthuc "github.com/ledongthuc/pdf"
	pdfcpu "github.com/pdfcpu/pdfcpu/pkg/api"
)

const headSampleChars = 400

type extractor struct {
	name string
	run  func(data []byte, path string) (string, error)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: pdfextract-compare <pdf-path>")
		os.Exit(2)
	}
	path := os.Args[1]
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read pdf: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("file:        %s\n", path)
	fmt.Printf("size_bytes:  %d\n", len(data))
	fmt.Println()

	extractors := []extractor{
		{"ledongthuc/pdf (current)", extractLedongthuc},
		{"pdfcpu", extractPdfcpu},
		{"coregx/gxpdf", extractGxpdf},
		{"spdf (Rust, PDFium-backed)", extractSpdf},
		{"pdftotext (poppler CLI)", extractPdftotext},
	}

	for _, e := range extractors {
		fmt.Printf("=== %s ===\n", e.name)
		text, err := e.run(data, path)
		if err != nil {
			fmt.Printf("  ERROR: %v\n\n", err)
			continue
		}
		printReport(text)
		fmt.Println()
	}
}

func printReport(text string) {
	fmt.Printf("  chars:           %d\n", len(text))
	fmt.Printf("  readable_score:  %.2f%%  (fraction of common English stopwords)\n", readableScore(text)*100)
	head := text
	if len(head) > headSampleChars {
		head = head[:headSampleChars]
	}
	fmt.Println("  head_sample:")
	for _, line := range strings.Split(head, "\n") {
		fmt.Printf("    %s\n", line)
	}
}

// readableScore returns the fraction of words that match a small set of
// common English stopwords. Clean English text usually scores 0.10-0.20.
// Caesar-cipher garbage scores ~0.00.
func readableScore(text string) float64 {
	stopwords := map[string]struct{}{
		"the": {}, "a": {}, "and": {}, "of": {}, "to": {}, "in": {},
		"is": {}, "for": {}, "on": {}, "with": {}, "at": {}, "by": {},
		"an": {}, "as": {}, "it": {}, "this": {}, "that": {}, "from": {},
	}
	words := strings.Fields(strings.ToLower(text))
	if len(words) == 0 {
		return 0
	}
	hits := 0
	for _, w := range words {
		w = strings.Trim(w, ".,;:!?\"'()[]{}")
		if _, ok := stopwords[w]; ok {
			hits++
		}
	}
	return float64(hits) / float64(len(words))
}

// --- ledongthuc/pdf (the current production extractor) ----------------------

func extractLedongthuc(data []byte, _ string) (string, error) {
	reader, err := ledongthuc.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var out strings.Builder
	fonts := map[string]*ledongthuc.Font{}
	for pageNum := 1; pageNum <= reader.NumPage(); pageNum++ {
		page := reader.Page(pageNum)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(fonts)
		if err != nil {
			return "", fmt.Errorf("page %d: %w", pageNum, err)
		}
		out.WriteString(text)
		out.WriteString("\n")
	}
	return out.String(), nil
}

// --- pdfcpu ----------------------------------------------------------------

func extractPdfcpu(_ []byte, path string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "pdfcpu-extract-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tmpDir)
	if err := pdfcpu.ExtractContentFile(path, tmpDir, nil, nil); err != nil {
		return "", err
	}
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return "", err
	}
	var out strings.Builder
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		b, err := os.ReadFile(tmpDir + "/" + ent.Name())
		if err != nil {
			continue
		}
		out.Write(b)
		out.WriteString("\n")
	}
	return out.String(), nil
}

// --- coregx/gxpdf ----------------------------------------------------------

func extractGxpdf(_ []byte, path string) (string, error) {
	doc, err := gxpdf.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = doc.Close() }()
	var out strings.Builder
	for i := 1; i <= doc.PageCount(); i++ {
		text, err := doc.ExtractTextFromPage(i)
		if err != nil {
			return out.String(), fmt.Errorf("page %d: %w", i, err)
		}
		out.WriteString(text)
		out.WriteString("\n")
	}
	return out.String(), nil
}

// --- pdftotext shell-out (poppler) ----------------------------------------

func extractPdftotext(_ []byte, path string) (string, error) {
	cmd := exec.Command("pdftotext", "-layout", path, "-")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return stdout.String(), nil
}

// --- spdf shell-out (Rust, PDFium-backed) ---------------------------------

func extractSpdf(_ []byte, path string) (string, error) {
	// spdf parse <path> -o /dev/stdout prints the text projection.
	// Default format is plain text; --no-ocr keeps us off the OCR fallback
	// so we measure the pure-PDF path.
	cmd := exec.Command("spdf", "parse", path, "-o", "/dev/stdout", "--no-ocr")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
