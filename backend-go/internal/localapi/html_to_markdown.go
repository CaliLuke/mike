package localapi

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// htmlToMarkdown produces a light Markdown rendering of the most-likely
// "main content" of a job posting page. It is not a general-purpose
// HTML→Markdown converter — it targets the structures job boards actually
// emit (Greenhouse, Lever, Ashby, Workday): headings, paragraphs,
// bullet/numbered lists, bold/italic, links, line breaks. Unknown elements
// pass through as their text content; elements that are typically chrome
// (script/style/nav/aside/header/footer/form/svg/noscript) are skipped.
//
// Errors during parsing degrade to "" so the caller can fall back to the
// plain-text extractor.
func htmlToMarkdown(raw string) string {
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return ""
	}
	root := findMainContent(doc)
	if root == nil {
		root = doc
	}
	var b strings.Builder
	walkHTMLToMarkdown(root, &b, 0)
	return normalizeMarkdown(b.String())
}

// findMainContent prefers <main> or <article> when present so we don't drag
// site chrome into the document body. Returns nil so the caller walks the
// whole tree as a fallback.
func findMainContent(n *html.Node) *html.Node {
	if n == nil {
		return nil
	}
	if n.Type == html.ElementNode && (n.Data == "main" || n.Data == "article") {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if found := findMainContent(c); found != nil {
			return found
		}
	}
	return nil
}

// htmlSkipTags lists elements we never want in the markdown body — they're
// either site chrome or non-textual content that turns into noise (country
// selectors, EEO survey forms, file pickers, etc.).
var htmlSkipTags = map[string]struct{}{
	"script": {}, "style": {}, "head": {}, "nav": {}, "header": {},
	"footer": {}, "aside": {}, "svg": {}, "img": {}, "noscript": {},
	"form": {}, "button": {}, "select": {}, "input": {}, "textarea": {},
	"iframe": {}, "option": {},
}

func walkHTMLToMarkdown(n *html.Node, b *strings.Builder, listDepth int) {
	if n == nil {
		return
	}
	switch n.Type {
	case html.TextNode:
		text := collapseInlineWhitespace(n.Data)
		if text != "" {
			b.WriteString(text)
		}
		return
	case html.DocumentNode:
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walkHTMLToMarkdown(c, b, listDepth)
		}
		return
	case html.ElementNode:
		// fall through
	default:
		return
	}

	tag := strings.ToLower(n.Data)
	if _, skip := htmlSkipTags[tag]; skip {
		return
	}

	switch tag {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		level := int(tag[1] - '0')
		ensureBlankLine(b)
		b.WriteString(strings.Repeat("#", level))
		b.WriteString(" ")
		renderInline(n, b, listDepth)
		b.WriteString("\n\n")
		return
	case "p":
		ensureBlankLine(b)
		renderInline(n, b, listDepth)
		b.WriteString("\n\n")
		return
	case "br":
		b.WriteString("  \n")
		return
	case "hr":
		ensureBlankLine(b)
		b.WriteString("---\n\n")
		return
	case "ul":
		ensureBlankLine(b)
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && strings.ToLower(c.Data) == "li" {
				writeListItem(c, b, listDepth, "- ")
			}
		}
		b.WriteString("\n")
		return
	case "ol":
		ensureBlankLine(b)
		index := 1
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && strings.ToLower(c.Data) == "li" {
				writeListItem(c, b, listDepth, intMarker(index))
				index++
			}
		}
		b.WriteString("\n")
		return
	case "li":
		writeListItem(n, b, listDepth, "- ")
		return
	case "strong", "b":
		b.WriteString("**")
		renderInline(n, b, listDepth)
		b.WriteString("**")
		return
	case "em", "i":
		b.WriteString("*")
		renderInline(n, b, listDepth)
		b.WriteString("*")
		return
	case "code":
		b.WriteString("`")
		renderInline(n, b, listDepth)
		b.WriteString("`")
		return
	case "pre":
		ensureBlankLine(b)
		b.WriteString("```\n")
		renderInline(n, b, listDepth)
		b.WriteString("\n```\n\n")
		return
	case "blockquote":
		ensureBlankLine(b)
		var inner strings.Builder
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walkHTMLToMarkdown(c, &inner, listDepth)
		}
		for _, line := range strings.Split(strings.TrimRight(inner.String(), "\n"), "\n") {
			b.WriteString("> ")
			b.WriteString(line)
			b.WriteString("\n")
		}
		b.WriteString("\n")
		return
	case "a":
		href := getAttr(n, "href")
		if href == "" {
			renderInline(n, b, listDepth)
			return
		}
		b.WriteString("[")
		renderInline(n, b, listDepth)
		b.WriteString("](")
		b.WriteString(href)
		b.WriteString(")")
		return
	}

	// Unknown element — emit its children. Treats div/section/span etc. as
	// transparent containers, which is the right call for job-board markup.
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walkHTMLToMarkdown(c, b, listDepth)
	}
}

func renderInline(n *html.Node, b *strings.Builder, listDepth int) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		walkHTMLToMarkdown(c, b, listDepth)
	}
}

// writeListItem emits one list-item line with `marker` (already trailing-
// spaced) plus two-space indentation per nesting depth, then recurses into
// the item's children. Nested lists keep their block formatting at depth+1.
func writeListItem(li *html.Node, b *strings.Builder, depth int, marker string) {
	b.WriteString(strings.Repeat("  ", depth))
	b.WriteString(marker)
	var inner strings.Builder
	for c := li.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && (strings.ToLower(c.Data) == "ul" || strings.ToLower(c.Data) == "ol") {
			inner.WriteString("\n")
			walkHTMLToMarkdown(c, &inner, depth+1)
			continue
		}
		walkHTMLToMarkdown(c, &inner, depth+1)
	}
	b.WriteString(strings.TrimRight(strings.TrimLeft(inner.String(), " "), " "))
	b.WriteString("\n")
}

func intMarker(i int) string {
	digits := []byte{}
	if i == 0 {
		digits = []byte{'0'}
	}
	for i > 0 {
		digits = append([]byte{byte('0' + i%10)}, digits...)
		i /= 10
	}
	return string(digits) + ". "
}

func getAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}

var htmlInlineWSRE = regexp.MustCompile(`[ \t\r\n]+`)

// collapseInlineWhitespace condenses runs of whitespace (including
// newlines) into a single space. Used while emitting inline text content
// where surrounding block elements own the paragraph/line breaks. Named
// distinctly from assistant_web.go's collapseWhitespace, which strips
// entirely.
func collapseInlineWhitespace(s string) string {
	return htmlInlineWSRE.ReplaceAllString(s, " ")
}

// ensureBlankLine guarantees a single trailing blank line before a new
// block, without piling up empty lines when blocks abut.
func ensureBlankLine(b *strings.Builder) {
	out := b.String()
	if out == "" {
		return
	}
	if strings.HasSuffix(out, "\n\n") {
		return
	}
	if strings.HasSuffix(out, "\n") {
		b.WriteString("\n")
		return
	}
	b.WriteString("\n\n")
}

var multiBlankRE = regexp.MustCompile(`\n{3,}`)

func normalizeMarkdown(s string) string {
	s = multiBlankRE.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s) + "\n"
}
