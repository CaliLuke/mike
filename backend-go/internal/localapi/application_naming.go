package localapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/CaliLuke/luke/backend-go/internal/localdata"
)

const jobDescriptionFilename = "Job description.md"

// unknownCompanyName must match the name used by
// localdata.migrateApplicationsToCompanies for `companies:migrated_unknown`
// — that migration runs at startup and seeds the placeholder row, and our
// fuzzy-name match in findSimilarCompanies will (and should) reuse it
// rather than create a parallel "Unknown" company.
const unknownCompanyName = "Unknown Company"

// resolveCompanyForApplication maps the caller's payload — either an existing
// company_id or a free-text company_name — to a concrete company record. When
// only a name is supplied, an exact-key match in findSimilarCompanies is reused
// to keep duplicates out; otherwise a fresh company is created. When neither
// is supplied, an "Unknown" placeholder company is returned so the schema's
// non-nullable company_id constraint stays satisfied — the assistant can rename
// the application's company later from the job description.
func (s *Server) resolveCompanyForApplication(ctx context.Context, companyID, companyName string) (string, string, error) {
	companyID = strings.TrimSpace(companyID)
	companyName = strings.TrimSpace(companyName)
	if companyID != "" {
		row, err := s.getCompany(ctx, companyID)
		if err != nil {
			return "", "", err
		}
		if row == nil {
			return "", "", fmt.Errorf("company %s not found", companyID)
		}
		return companyID, asString(row["name"]), nil
	}
	if companyName == "" {
		companyName = unknownCompanyName
	}
	matches, err := s.findSimilarCompanies(ctx, companyName)
	if err == nil {
		for _, match := range matches {
			if match.ExactKey {
				return match.ID, match.Name, nil
			}
		}
	}
	row, err := s.createCompany(ctx, companyName, nil)
	if err != nil {
		return "", "", err
	}
	return trimRecord(asString(row["id"])), asString(row["name"]), nil
}

// companyFromGeneratedName splits "Role at Company" → "Company". Returns
// empty when the format doesn't match. Used to back-fill the company when
// the user didn't supply one but the URL fetch produced a name.
func companyFromGeneratedName(name string) string {
	name = strings.TrimSpace(name)
	idx := strings.LastIndex(strings.ToLower(name), " at ")
	if idx < 0 {
		return ""
	}
	return strings.TrimSpace(name[idx+len(" at "):])
}

// resolveApplicationName picks the new application's display name from the
// inputs the create handler accepted. Position+company is preferred because it
// is deterministic and fast; a URL triggers a single LLM call backed by a
// pre-fetched page; everything else falls back to "New application". Any
// failure on the URL path is swallowed silently — the create itself must
// never fail just because naming did.
func (s *Server) resolveApplicationName(ctx context.Context, position, companyName string, page *jobPage) string {
	position = strings.TrimSpace(position)
	companyName = strings.TrimSpace(companyName)
	if position != "" {
		if companyName != "" {
			return fmt.Sprintf("%s at %s", position, companyName)
		}
		return position
	}
	if page != nil {
		if name, err := s.nameFromJobPage(ctx, page, companyName); err == nil && name != "" {
			return name
		}
	}
	return "New application"
}

const (
	jobFetchTimeout  = 5 * time.Second
	jobFetchMaxBytes = 1 << 20 // 1MB
	jobPromptCharCap = 2048
)

// jobPage holds the result of fetching a job posting once so naming and
// document ingestion can share it instead of double-fetching.
type jobPage struct {
	URL      string
	Title    string
	Snippet  string // capped to jobPromptCharCap, fed to the naming LLM
	FullText string // full extracted plain text, used for the naming snippet source
	Markdown string // markdown rendering of the page body, used for the persisted doc
}

// fetchJobPage performs the single HTTP GET used by both the application
// naming step and the job-description document ingestion. Returns nil on
// any failure (bad URL, non-2xx, non-HTML, timeout) — callers must treat a
// nil result as "no page available" rather than as an error.
func (s *Server) fetchJobPage(ctx context.Context, jobURL string) *jobPage {
	jobURL = strings.TrimSpace(jobURL)
	if jobURL == "" {
		return nil
	}
	ctx, span := startLocalSpan(ctx, "application.fetch_job_page",
		attribute.String("application.job_url", jobURL),
	)
	defer span.End()
	fetchCtx, cancel := context.WithTimeout(ctx, jobFetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, jobURL, nil)
	if err != nil {
		recordSpanError(span, err)
		return nil
	}
	req.Header.Set("User-Agent", "luke-app/1.0 (+job-description-fetcher)")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		recordSpanError(span, err)
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	span.SetAttributes(attribute.Int("http.status_code", resp.StatusCode))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		recordSpanError(span, fmt.Errorf("job url fetch returned %d", resp.StatusCode))
		return nil
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if ct != "" && !strings.Contains(ct, "html") && !strings.Contains(ct, "text") {
		recordSpanError(span, fmt.Errorf("unsupported content-type %q", ct))
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, jobFetchMaxBytes))
	if err != nil {
		recordSpanError(span, err)
		return nil
	}
	title, fullText := extractTitleAndText(string(body))
	snippet := fullText
	if len(snippet) > jobPromptCharCap {
		snippet = snippet[:jobPromptCharCap]
	}
	markdown := htmlToMarkdown(string(body))
	span.SetAttributes(
		attribute.Int("application.fetched_bytes", len(body)),
		attribute.Int("application.snippet_chars", len(snippet)),
		attribute.Int("application.full_text_chars", len(fullText)),
		attribute.Int("application.markdown_chars", len(markdown)),
		attribute.String("application.page_title", title),
	)
	return &jobPage{URL: jobURL, Title: title, Snippet: snippet, FullText: fullText, Markdown: markdown}
}

func (s *Server) nameFromJobPage(ctx context.Context, page *jobPage, companyName string) (string, error) {
	ctx, span := startLocalSpan(ctx, "application.name_from_url",
		attribute.String("application.job_url", page.URL),
	)
	defer span.End()
	prompt := buildJobNamePrompt(page.URL, companyName, page.Title, page.Snippet)
	completion, err := s.completeText(ctx, completionRequest{
		Model:        defaultTitleModel,
		SystemPrompt: jobNameSystemPrompt,
		User:         prompt,
	})
	if err != nil {
		recordSpanError(span, err)
		return "", err
	}
	name := sanitizeApplicationName(completion)
	span.SetAttributes(attribute.String("application.generated_name", name))
	if name == "" {
		return "", fmt.Errorf("model returned empty name")
	}
	return name, nil
}

const jobNameSystemPrompt = `You name job applications. Given a job posting URL and short page snippet, reply with a single short application title (2-6 words) in the form "<Role> at <Company>" when possible. No quotes, no punctuation at the end, no extra commentary.`

func buildJobNamePrompt(jobURL, companyName, title, snippet string) string {
	var b strings.Builder
	b.WriteString("URL: ")
	b.WriteString(jobURL)
	b.WriteString("\n")
	if companyName != "" {
		b.WriteString("Company (user-provided): ")
		b.WriteString(companyName)
		b.WriteString("\n")
	}
	if title != "" {
		b.WriteString("Page title: ")
		b.WriteString(title)
		b.WriteString("\n")
	}
	if snippet != "" {
		b.WriteString("Page snippet:\n")
		b.WriteString(snippet)
		b.WriteString("\n")
	}
	b.WriteString("Reply with the application title only.")
	return b.String()
}

var (
	titleTagRE = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	scriptRE   = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	tagRE      = regexp.MustCompile(`(?s)<[^>]+>`)
	wsRE       = regexp.MustCompile(`\s+`)
)

// extractTitleAndText returns the raw <title> tag content plus a plain-text
// flattening of the entire body. The full text is returned uncapped — the
// caller is responsible for any size-limited downstream use (e.g. the LLM
// naming snippet cap). For a structure-preserving rendering of the page
// body, callers should prefer htmlToMarkdown.
func extractTitleAndText(html string) (string, string) {
	title := ""
	if match := titleTagRE.FindStringSubmatch(html); len(match) == 2 {
		title = wsRE.ReplaceAllString(strings.TrimSpace(match[1]), " ")
	}
	stripped := scriptRE.ReplaceAllString(html, " ")
	stripped = tagRE.ReplaceAllString(stripped, " ")
	stripped = wsRE.ReplaceAllString(stripped, " ")
	stripped = strings.TrimSpace(stripped)
	return title, stripped
}

// ingestJobDescription persists the fetched job posting as a Markdown
// document attached to the application. Failures are silent — the
// application is already created at this point, and naming/scraping issues
// must never bubble up to the caller. Telemetry captures success/failure.
func (s *Server) ingestJobDescription(ctx context.Context, applicationID string, page *jobPage) bool {
	ctx, span := startLocalSpan(ctx, "application.ingest_job_description",
		attribute.String("application.id", applicationID),
		attribute.String("application.job_url", page.URL),
	)
	defer span.End()

	body := buildJobDescriptionMarkdown(page)
	if body == "" {
		span.SetAttributes(attribute.String("application.ingest.skip_reason", "empty_body"))
		return false
	}
	span.SetAttributes(attribute.Int("application.ingest.body_chars", len(body)))

	docID := newID("doc")
	versionID := docID + "_v1"
	storagePath := filepath.ToSlash(filepath.Join(docID, jobDescriptionFilename))
	data := []byte(body)
	payload := map[string]any{
		"document_id":    docID,
		"version_id":     versionID,
		"filename":       jobDescriptionFilename,
		"file_type":      "md",
		"storage_path":   storagePath,
		"size_bytes":     len(data),
		"version_number": 1,
		"content_base64": encodeBase64(data),
		"application_id": applicationID,
	}
	if _, err := localdata.PersistDocumentOperation(
		localdata.WithUserContext(ctx, s.app.User),
		s.app,
		localdata.DocumentOperationInput{
			WorkflowName: localdata.DocumentUploadWorkflowName,
			TargetID:     docID,
			Payload:      payload,
		},
	); err != nil {
		recordSpanError(span, err)
		return false
	}
	if _, err := s.app.DB.Query(ctx, "UPDATE "+recordID("documents", docID)+" SET application_id = "+recordID("applications", applicationID)+", updated_at = time::now();"); err != nil {
		recordSpanError(span, err)
		return false
	}
	span.SetAttributes(attribute.String("application.ingest.document_id", docID))
	return true
}

// buildJobDescriptionMarkdown stitches the extracted page text into a small
// Markdown document. The first line names the source URL so the assistant
// can cite it; the page title (when present) becomes an H1. Prefers the
// markdown rendering of the page when the walker produced one, and falls
// back to the plain-text flattening when it didn't (e.g. unparseable HTML).
func buildJobDescriptionMarkdown(page *jobPage) string {
	if page == nil {
		return ""
	}
	text := strings.TrimSpace(page.Markdown)
	if text == "" {
		text = strings.TrimSpace(page.FullText)
	}
	if text == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("Source: ")
	b.WriteString(page.URL)
	b.WriteString("\n\n")
	if title := strings.TrimSpace(page.Title); title != "" {
		b.WriteString("# ")
		b.WriteString(title)
		b.WriteString("\n\n")
	}
	b.WriteString(text)
	b.WriteString("\n")
	return b.String()
}

func sanitizeApplicationName(raw string) string {
	cleaned := strings.TrimSpace(raw)
	cleaned = strings.Trim(cleaned, "\"'`")
	if idx := strings.IndexAny(cleaned, "\r\n"); idx >= 0 {
		cleaned = cleaned[:idx]
	}
	cleaned = strings.TrimSpace(cleaned)
	if len(cleaned) > 120 {
		cleaned = cleaned[:120]
	}
	return cleaned
}
