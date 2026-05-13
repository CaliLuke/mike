package localapi

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	pdf "github.com/ledongthuc/pdf"
)

// displayBytes returns the body + content-type to serve from /display.
// PDFs are returned as-is so the browser viewer (PDF.js) can render them;
// docx is left as octet-stream so the frontend falls back to its
// docx-preview path; plain text formats are served verbatim.
//
// fileType is the document's stored kind ("md", "pdf", …) used when the
// filename has no usable extension — without it, LLM-generated documents
// titled like "Principal Product Manager at GitHub" fall through to
// octet-stream and the frontend tries to render them as DOCX.
func displayBytes(filename, fileType string, data []byte) ([]byte, string) {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), "."))
	if ext == "" {
		ext = strings.ToLower(strings.TrimSpace(fileType))
	}
	switch ext {
	case "md":
		return data, "text/markdown; charset=utf-8"
	case "txt", "csv", "json":
		return data, "text/plain; charset=utf-8"
	case "pdf":
		return data, "application/pdf"
	}
	return data, "application/octet-stream"
}

// extractDocumentText pulls plain text out of a document for LLM /
// search consumption. Returns the text and whether extraction was
// attempted+succeeded for this file type; callers typically fall back
// to the raw bytes as UTF-8 when this returns "".
func extractDocumentText(filename string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt", ".md", ".csv", ".json":
		return string(data)
	case ".docx":
		if text, err := extractDocxText(data); err == nil && strings.TrimSpace(text) != "" {
			return text
		}
	case ".pdf":
		if text, err := extractPDFText(data); err == nil && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return ""
}

type generatedDocxSection struct {
	Heading      string
	Level        int
	Content      string
	PageBreak    bool
	TableHeaders []string
	TableRows    [][]string
}

const generatedDocxStylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style></w:styles>`

const generatedDocxNumberingXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

func buildSimpleDocx(title string, sections []generatedDocxSection) ([]byte, error) {
	if strings.TrimSpace(title) == "" {
		title = "Document"
	}
	var body strings.Builder
	body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:t>`)
	body.WriteString(escapeWordXML(strings.ToUpper(title)))
	body.WriteString(`</w:t></w:r></w:p>`)
	counters := []int{0, 0, 0}
	for _, section := range sections {
		if section.PageBreak {
			body.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
		}
		if strings.TrimSpace(section.Heading) != "" {
			level := section.Level
			if level < 1 || level > 3 {
				level = 1
			}
			counters[level-1]++
			for i := level; i < len(counters); i++ {
				counters[i] = 0
			}
			var numbering []string
			for i := 0; i < level; i++ {
				if counters[i] > 0 {
					numbering = append(numbering, fmt.Sprint(counters[i]))
				}
			}
			heading := strings.Join(numbering, ".") + ". " + section.Heading
			if level == 1 {
				heading = strings.ToUpper(heading)
			}
			body.WriteString(`<w:p><w:pPr><w:pStyle w:val="Heading`)
			fmt.Fprint(&body, level)
			body.WriteString(`"/></w:pPr><w:r><w:t>`)
			body.WriteString(escapeWordXML(heading))
			body.WriteString(`</w:t></w:r></w:p>`)
		}
		if len(section.TableHeaders) > 0 {
			body.WriteString(`<w:tbl>`)
			writeDocxTableRow(&body, section.TableHeaders, true)
			for _, row := range section.TableRows {
				cells := make([]string, len(section.TableHeaders))
				for i := range cells {
					if i < len(row) {
						cells[i] = row[i]
					}
				}
				writeDocxTableRow(&body, cells, false)
			}
			body.WriteString(`</w:tbl>`)
		}
		for paragraph := range strings.SplitSeq(section.Content, "\n") {
			paragraph = strings.TrimSpace(paragraph)
			if paragraph == "" {
				continue
			}
			isBullet := strings.HasPrefix(paragraph, "- ") || strings.HasPrefix(paragraph, "* ") || strings.HasPrefix(paragraph, "• ")
			if isBullet {
				paragraph = strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(paragraph, "- "), "* "), "• ")
				body.WriteString(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>`)
			} else {
				body.WriteString(`<w:p><w:r><w:t>`)
			}
			body.WriteString(escapeWordXML(paragraph))
			body.WriteString(`</w:t></w:r></w:p>`)
		}
	}
	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body.String() + `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	files := map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		"word/document.xml":            documentXML,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
		"word/styles.xml":              generatedDocxStylesXML,
		"word/numbering.xml":           generatedDocxNumberingXML,
	}
	for name, content := range files {
		writer, err := zw.Create(name)
		if err != nil {
			_ = zw.Close()
			return nil, err
		}
		if _, err := writer.Write([]byte(content)); err != nil {
			_ = zw.Close()
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeDocxTableRow(body *strings.Builder, cells []string, header bool) {
	body.WriteString(`<w:tr>`)
	for _, cell := range cells {
		body.WriteString(`<w:tc><w:p><w:r>`)
		if header {
			body.WriteString(`<w:rPr><w:b/></w:rPr>`)
		}
		body.WriteString(`<w:t>`)
		body.WriteString(escapeWordXML(cell))
		body.WriteString(`</w:t></w:r></w:p></w:tc>`)
	}
	body.WriteString(`</w:tr>`)
}

func escapeWordXML(value string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(value))
	return buf.String()
}

func extractDocxText(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	for _, file := range reader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return "", err
		}
		defer func() { _ = rc.Close() }()
		return textFromWordXML(rc)
	}
	return "", fmt.Errorf("word/document.xml not found")
}

func textFromWordXML(reader io.Reader) (string, error) {
	decoder := xml.NewDecoder(reader)
	var out strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return out.String(), nil
		}
		if err != nil {
			return "", err
		}
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Local == "p" && out.Len() > 0 {
				out.WriteByte('\n')
			}
		case xml.CharData:
			text := string(value)
			if strings.TrimSpace(text) != "" {
				out.WriteString(text)
			}
		}
	}
}

func extractPDFText(data []byte) (string, error) {
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

func applyTrackedChange(data []byte, accept bool, targetChangeID string) ([]byte, bool, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return data, false, err
	}
	buf := &bytes.Buffer{}
	writer := zip.NewWriter(buf)
	changed := false
	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		content, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		if file.Name == "word/document.xml" {
			next := rewriteTrackedChangeXML(string(content), accept, targetChangeID)
			if next != string(content) {
				changed = true
				content = []byte(next)
			}
		}
		header := file.FileHeader
		out, err := writer.CreateHeader(&header)
		if err != nil {
			_ = writer.Close()
			return nil, false, err
		}
		if _, err := out.Write(content); err != nil {
			_ = writer.Close()
			return nil, false, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, false, err
	}
	if !changed {
		return data, false, nil
	}
	return buf.Bytes(), true, nil
}

type trackedEditRequest struct {
	Find    string
	Replace string
	Reason  string
}

type trackedEditResult struct {
	ChangeID      string
	DeletedText   string
	InsertedText  string
	ContextBefore string
	ContextAfter  string
	Reason        string
}

func applyTrackedEditsToDocx(data []byte, edits []trackedEditRequest, startChangeID int) ([]byte, []trackedEditResult, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, nil, err
	}
	buf := &bytes.Buffer{}
	writer := zip.NewWriter(buf)
	var results []trackedEditResult
	documentFound := false
	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			_ = writer.Close()
			return nil, nil, err
		}
		content, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			_ = writer.Close()
			return nil, nil, err
		}
		if file.Name == "word/document.xml" {
			documentFound = true
			next, applied := applyTrackedEditsToDocumentXML(string(content), edits, startChangeID)
			content = []byte(next)
			results = applied
		}
		header := file.FileHeader
		out, err := writer.CreateHeader(&header)
		if err != nil {
			_ = writer.Close()
			return nil, nil, err
		}
		if _, err := out.Write(content); err != nil {
			_ = writer.Close()
			return nil, nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, nil, err
	}
	if !documentFound {
		return nil, nil, fmt.Errorf("word/document.xml not found")
	}
	return buf.Bytes(), results, nil
}

func applyTrackedEditsToDocumentXML(input string, edits []trackedEditRequest, startChangeID int) (string, []trackedEditResult) {
	if startChangeID < 1 {
		startChangeID = 1
	}
	out := input
	var results []trackedEditResult
	for _, edit := range edits {
		find := strings.TrimSpace(edit.Find)
		if find == "" {
			continue
		}
		escapedFind := escapeWordXML(find)
		idx := strings.Index(out, escapedFind)
		if idx < 0 {
			normalized, ok := normalizeParagraphContainingText(out, find)
			if !ok {
				continue
			}
			out = normalized
			idx = strings.Index(out, escapedFind)
			if idx < 0 {
				continue
			}
		}
		changeID := fmt.Sprintf("%d", startChangeID+len(results))
		replacement, ok := trackedTextNodeReplacement(out, idx, len(escapedFind), trackedEditXML(changeID, find, edit.Replace))
		if !ok {
			continue
		}
		beforeStart := max(idx-240, 0)
		afterEnd := min(idx+len(escapedFind)+240, len(out))
		results = append(results, trackedEditResult{
			ChangeID:      changeID,
			DeletedText:   find,
			InsertedText:  edit.Replace,
			ContextBefore: plainXMLContext(out[beforeStart:idx]),
			ContextAfter:  plainXMLContext(out[idx+len(escapedFind) : afterEnd]),
			Reason:        edit.Reason,
		})
		out = replacement
	}
	return out, results
}

func normalizeParagraphContainingText(input, find string) (string, bool) {
	searchFrom := 0
	for {
		pStartRelative := strings.Index(input[searchFrom:], "<w:p")
		if pStartRelative < 0 {
			return input, false
		}
		pStart := searchFrom + pStartRelative
		pOpenEndRelative := strings.Index(input[pStart:], ">")
		if pOpenEndRelative < 0 {
			return input, false
		}
		pOpenEnd := pStart + pOpenEndRelative
		pEndRelative := strings.Index(input[pOpenEnd:], "</w:p>")
		if pEndRelative < 0 {
			return input, false
		}
		pEnd := pOpenEnd + pEndRelative + len("</w:p>")
		paragraph := input[pStart:pEnd]
		plain := plainXMLContext(paragraph)
		if !strings.Contains(plain, find) {
			searchFrom = pEnd
			continue
		}
		replacement := input[pStart : pOpenEnd+1]
		if pPr := paragraphPropertyXML(paragraph); pPr != "" {
			replacement += pPr
		}
		replacement += "<w:r><w:t>" + escapeWordXML(plain) + "</w:t></w:r></w:p>"
		return input[:pStart] + replacement + input[pEnd:], true
	}
}

func paragraphPropertyXML(paragraph string) string {
	start := strings.Index(paragraph, "<w:pPr")
	if start < 0 {
		return ""
	}
	endRelative := strings.Index(paragraph[start:], "</w:pPr>")
	if endRelative < 0 {
		return ""
	}
	end := start + endRelative + len("</w:pPr>")
	return paragraph[start:end]
}

func trackedTextNodeReplacement(input string, matchStart, matchLen int, trackedXML string) (string, bool) {
	openStart := strings.LastIndex(input[:matchStart], "<w:t")
	if openStart < 0 {
		return "", false
	}
	openEndRelative := strings.Index(input[openStart:matchStart], ">")
	if openEndRelative < 0 {
		return "", false
	}
	openEnd := openStart + openEndRelative
	closeStartRelative := strings.Index(input[matchStart:], "</w:t>")
	if closeStartRelative < 0 {
		return "", false
	}
	closeStart := matchStart + closeStartRelative
	if matchStart+matchLen > closeStart {
		return "", false
	}
	prefix := input[openEnd+1 : matchStart]
	suffix := input[matchStart+matchLen : closeStart]
	return input[:openEnd+1] + prefix + `</w:t></w:r>` + trackedXML + `<w:r><w:t>` + suffix + input[closeStart:], true
}

func trackedEditXML(changeID, deletedText, insertedText string) string {
	date := time.Now().UTC().Format(time.RFC3339)
	return `<w:del w:id="` + escapeWordXML(changeID) + `" w:author="Luke" w:date="` + date + `"><w:r><w:delText>` +
		escapeWordXML(deletedText) +
		`</w:delText></w:r></w:del><w:ins w:id="` + escapeWordXML(changeID) + `" w:author="Luke" w:date="` + date + `"><w:r><w:t>` +
		escapeWordXML(insertedText) +
		`</w:t></w:r></w:ins>`
}

func plainXMLContext(value string) string {
	var out strings.Builder
	inTag := false
	for _, r := range value {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				out.WriteRune(r)
			}
		}
	}
	return strings.TrimSpace(strings.NewReplacer("&lt;", "<", "&gt;", ">", "&amp;", "&").Replace(out.String()))
}

func rewriteTrackedChangeXML(input string, accept bool, targetChangeID string) string {
	out := input
	changed := false
	for {
		next, ok := rewriteTargetTrackedChangeXML(out, accept, targetChangeID)
		if !ok {
			break
		}
		out = next
		changed = true
		if targetChangeID != "" {
			break
		}
	}
	if !changed {
		return input
	}
	return out
}

func rewriteTargetTrackedChangeXML(input string, accept bool, targetChangeID string) (string, bool) {
	delMarker := `<w:del`
	if targetChangeID != "" {
		delMarker = `<w:del w:id="` + escapeWordXML(targetChangeID) + `"`
	}
	delStart := strings.Index(input, delMarker)
	if delStart < 0 {
		return input, false
	}
	delEndRelative := strings.Index(input[delStart:], `</w:del>`)
	if delEndRelative < 0 {
		return input, false
	}
	delEnd := delStart + delEndRelative + len(`</w:del>`)
	insMarker := `<w:ins`
	if targetChangeID != "" {
		insMarker = `<w:ins w:id="` + escapeWordXML(targetChangeID) + `"`
	}
	insStart := strings.Index(input[delEnd:], insMarker)
	if insStart < 0 {
		return input, false
	}
	insStart += delEnd
	between := strings.TrimSpace(input[delEnd:insStart])
	if between != "" {
		return input, false
	}
	insEndRelative := strings.Index(input[insStart:], `</w:ins>`)
	if insEndRelative < 0 {
		return input, false
	}
	insEnd := insStart + insEndRelative + len(`</w:ins>`)

	replacement := trackedChangePlainRun(input[insStart:insEnd], "t")
	if !accept {
		replacement = trackedChangePlainRun(input[delStart:delEnd], "delText")
	}
	if replacement == "" {
		return input, false
	}
	return input[:delStart] + replacement + input[insEnd:], true
}

func trackedChangePlainRun(fragment, localName string) string {
	open := "<w:" + localName + ">"
	close := "</w:" + localName + ">"
	start := strings.Index(fragment, open)
	if start < 0 {
		return ""
	}
	start += len(open)
	end := strings.Index(fragment[start:], close)
	if end < 0 {
		return ""
	}
	return "<w:r><w:t>" + fragment[start:start+end] + "</w:t></w:r>"
}
