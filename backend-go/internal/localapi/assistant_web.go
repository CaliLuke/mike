package localapi

import (
	"context"
	"encoding/json"
	"fmt"
	stdhtml "html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/CaliLuke/loom-mcp/runtime/agent/planner"
	"go.opentelemetry.io/otel/attribute"
	xhtml "golang.org/x/net/html"

	careercontext "github.com/CaliLuke/luke/backend-go/gen/chat/toolsets/career_context"
)

const (
	maxWebPageBytes        = 2 << 20
	defaultWebPageMaxChars = 60_000
)

type simplifiedWebPage struct {
	URL       string
	Title     string
	Text      string
	Truncated bool
}

func (s *Server) executeFetchWebPage(ctx context.Context, call *planner.ToolRequest, send func(map[string]any) error) (*planner.ToolResult, error) {
	ctx, span := startLocalSpan(ctx, "assistant.tool.fetch_web_page",
		attribute.String("assistant.tool_call_id", call.ToolCallID),
	)
	defer span.End()
	payload, err := careercontext.UnmarshalFetchWebPagePayload([]byte(call.Payload))
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	rawURL, err := requiredString(payload.URL, "url")
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(attribute.String("http.url", rawURL))
	maxChars := defaultWebPageMaxChars
	if payload.MaxChars != nil && *payload.MaxChars > 0 {
		maxChars = min(*payload.MaxChars, defaultWebPageMaxChars)
	}
	page, err := fetchSimplifiedWebPage(ctx, rawURL, maxChars)
	if err != nil {
		recordSpanError(span, err)
		return toolError(call.Name, err), nil
	}
	span.SetAttributes(
		attribute.String("http.final_url", page.URL),
		attribute.String("web_page.title", page.Title),
		attribute.Int("web_page.text_chars", len([]rune(page.Text))),
		attribute.Bool("web_page.truncated", page.Truncated),
	)
	_ = send(map[string]any{"type": "web_page_fetched", "url": page.URL, "title": page.Title})
	return &planner.ToolResult{Name: call.Name, Result: &careercontext.FetchWebPageResult{
		URL:       stringPtr(page.URL),
		Title:     stringPtr(page.Title),
		Text:      stringPtr(page.Text),
		Truncated: boolPtr(page.Truncated),
	}}, nil
}

func fetchSimplifiedWebPage(ctx context.Context, rawURL string, maxChars int) (simplifiedWebPage, error) {
	parsed, err := validatePublicWebURL(ctx, rawURL)
	if err != nil {
		return simplifiedWebPage{}, err
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			_, validateErr := validatePublicWebURL(req.Context(), req.URL.String())
			return validateErr
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return simplifiedWebPage{}, err
	}
	req.Header.Set("User-Agent", "Luke/1.0 (+local job workbench)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return simplifiedWebPage{}, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return simplifiedWebPage{}, fmt.Errorf("fetch web page: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxWebPageBytes+1))
	if err != nil {
		return simplifiedWebPage{}, err
	}
	if len(body) > maxWebPageBytes {
		return simplifiedWebPage{}, fmt.Errorf("web page is too large")
	}
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "html") && !strings.Contains(contentType, "text/plain") {
		return simplifiedWebPage{}, fmt.Errorf("unsupported content type %q", contentType)
	}
	title, text := simplifyWebPageContent(contentType, string(body))
	text, truncated := truncateString(text, maxChars)
	return simplifiedWebPage{URL: resp.Request.URL.String(), Title: title, Text: text, Truncated: truncated}, nil
}

func validatePublicWebURL(ctx context.Context, rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, fmt.Errorf("url must use http or https")
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("url host is required")
	}
	if strings.EqualFold(host, "localhost") || strings.HasSuffix(strings.ToLower(host), ".local") {
		return nil, fmt.Errorf("local URLs are not allowed")
	}
	if ip, parseErr := netip.ParseAddr(host); parseErr == nil {
		if !isPublicAddr(ip) {
			return nil, fmt.Errorf("local or private URLs are not allowed")
		}
		return parsed, nil
	}
	addrs, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, fmt.Errorf("resolve url host: %w", err)
	}
	for _, addr := range addrs {
		if !isPublicAddr(addr) {
			return nil, fmt.Errorf("local or private URLs are not allowed")
		}
	}
	return parsed, nil
}

func isPublicAddr(addr netip.Addr) bool {
	return addr.IsValid() &&
		!addr.IsLoopback() &&
		!addr.IsPrivate() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsLinkLocalMulticast() &&
		!addr.IsMulticast() &&
		!addr.IsUnspecified()
}

func simplifyWebPageContent(contentType, body string) (string, string) {
	if strings.Contains(strings.ToLower(contentType), "text/plain") {
		return "", collapseWhitespace(body)
	}
	root, err := xhtml.Parse(strings.NewReader(body))
	if err != nil {
		return "", collapseWhitespace(stripAngleBrackets(body))
	}
	if title, text, ok := extractJobPostingJSONLD(root); ok {
		return title, text
	}
	var title strings.Builder
	var text strings.Builder
	walkReadableHTML(root, false, false, &title, &text)
	return collapseWhitespace(title.String()), collapseWhitespace(text.String())
}

func extractJobPostingJSONLD(root *xhtml.Node) (string, string, bool) {
	for node := range walkHTMLNodes(root) {
		if node.Type != xhtml.ElementNode || !strings.EqualFold(node.Data, "script") {
			continue
		}
		if !hasHTMLAttrValue(node, "type", func(value string) bool {
			return strings.Contains(strings.ToLower(value), "application/ld+json")
		}) {
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(nodeText(node)), &payload); err != nil {
			continue
		}
		if posting, ok := findJSONLDType(payload, "JobPosting"); ok {
			title := collapseWhitespace(jsonStringField(posting, "title"))
			descriptionHTML := firstNonEmptyString(
				jsonStringField(posting, "description"),
				jsonStringField(posting, "responsibilities"),
				jsonStringField(posting, "qualifications"),
			)
			if descriptionHTML == "" {
				continue
			}
			_, text := simplifyWebPageContent("text/html", stdhtml.UnescapeString(descriptionHTML))
			text = collapseWhitespace(text)
			if text != "" {
				return title, text, true
			}
		}
	}
	return "", "", false
}

func walkHTMLNodes(root *xhtml.Node) func(func(*xhtml.Node) bool) {
	return func(yield func(*xhtml.Node) bool) {
		var walk func(*xhtml.Node) bool
		walk = func(node *xhtml.Node) bool {
			if !yield(node) {
				return false
			}
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				if !walk(child) {
					return false
				}
			}
			return true
		}
		walk(root)
	}
}

func hasHTMLAttrValue(node *xhtml.Node, key string, match func(string) bool) bool {
	for _, attr := range node.Attr {
		if strings.EqualFold(attr.Key, key) && match(attr.Val) {
			return true
		}
	}
	return false
}

func nodeText(node *xhtml.Node) string {
	var out strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == xhtml.TextNode {
			out.WriteString(child.Data)
		}
	}
	return out.String()
}

func findJSONLDType(value any, targetType string) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		if jsonLDTypeMatches(typed["@type"], targetType) {
			return typed, true
		}
		if graph, ok := typed["@graph"]; ok {
			return findJSONLDType(graph, targetType)
		}
	case []any:
		for _, item := range typed {
			if found, ok := findJSONLDType(item, targetType); ok {
				return found, true
			}
		}
	}
	return nil, false
}

func jsonLDTypeMatches(value any, targetType string) bool {
	switch typed := value.(type) {
	case string:
		return strings.EqualFold(typed, targetType)
	case []any:
		for _, item := range typed {
			if jsonLDTypeMatches(item, targetType) {
				return true
			}
		}
	}
	return false
}

func jsonStringField(value map[string]any, key string) string {
	raw, ok := value[key].(string)
	if !ok {
		return ""
	}
	return raw
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func walkReadableHTML(node *xhtml.Node, skip bool, inTitle bool, title *strings.Builder, text *strings.Builder) {
	if node.Type == xhtml.ElementNode {
		name := strings.ToLower(node.Data)
		if isSkippedHTMLElement(name) {
			skip = true
		}
		if name == "title" {
			inTitle = true
		}
		if isBlockHTMLElement(name) {
			text.WriteString("\n")
		}
	}
	if node.Type == xhtml.TextNode && !skip {
		if inTitle {
			title.WriteString(node.Data)
			title.WriteString(" ")
		} else {
			text.WriteString(node.Data)
			text.WriteString(" ")
		}
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walkReadableHTML(child, skip, inTitle, title, text)
	}
	if node.Type == xhtml.ElementNode && isBlockHTMLElement(strings.ToLower(node.Data)) {
		text.WriteString("\n")
	}
}

func isSkippedHTMLElement(name string) bool {
	switch name {
	case "script", "style", "noscript", "svg", "canvas", "template", "nav", "header", "footer", "form", "button", "select":
		return true
	default:
		return false
	}
}

func isBlockHTMLElement(name string) bool {
	switch name {
	case "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "li", "main", "p", "pre", "section", "table", "td", "th", "tr", "ul", "ol":
		return true
	default:
		return false
	}
}

func collapseWhitespace(value string) string {
	var out strings.Builder
	previousSpace := true
	for _, r := range value {
		if unicode.IsSpace(r) {
			if !previousSpace {
				out.WriteByte(' ')
				previousSpace = true
			}
			continue
		}
		out.WriteRune(r)
		previousSpace = false
	}
	return strings.TrimSpace(out.String())
}

func stripAngleBrackets(value string) string {
	var out strings.Builder
	inTag := false
	for _, r := range value {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
			out.WriteByte(' ')
		default:
			if !inTag {
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}

func truncateString(value string, maxChars int) (string, bool) {
	runes := []rune(value)
	if maxChars <= 0 || len(runes) <= maxChars {
		return value, false
	}
	return string(runes[:maxChars]) + "\n\n[truncated]", true
}
