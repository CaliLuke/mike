package localapi

import (
	"net/url"
	"regexp"
	"strings"
)

// jobBoardMatch is what parseJobBoardURL returns when it recognizes a posting
// URL. The identity ("<board>:<slug>") is the canonical key we store on
// companies.job_board_identities so future postings for the same employer on
// the same board dedupe automatically; CompanyHint is the title-cased slug
// we fall back to for naming when no other source is available.
type jobBoardMatch struct {
	Board       string
	Slug        string
	Identity    string
	CompanyHint string
}

// jobBoardParser captures one provider's URL shape. Each parser examines a
// parsed URL and either returns a non-empty slug or "" to signal no match.
// ListingURL reconstructs a careers-page URL from {board, slug} so a future
// search agent can poll the board for new openings.
type jobBoardParser struct {
	Board      string
	Match      func(*url.URL) string
	ListingURL func(slug string) string
}

var jobBoardSlugRE = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func sanitizeSlug(raw string) string {
	cleaned := jobBoardSlugRE.ReplaceAllString(strings.TrimSpace(raw), "")
	cleaned = strings.Trim(cleaned, ".-_")
	if len(cleaned) > 64 {
		cleaned = cleaned[:64]
	}
	return cleaned
}

// jobBoardParsers is the lookup registry. New providers go here — the entries
// run in order and the first match wins.
var jobBoardParsers = []jobBoardParser{
	{
		Board: "greenhouse",
		Match: func(u *url.URL) string {
			host := strings.ToLower(u.Hostname())
			// boards.greenhouse.io/<slug>/jobs/<id> and the newer
			// job-boards.greenhouse.io/<slug>/jobs/<id> path layouts.
			if host == "boards.greenhouse.io" || host == "job-boards.greenhouse.io" {
				parts := strings.Split(strings.Trim(u.Path, "/"), "/")
				if len(parts) >= 1 {
					return sanitizeSlug(parts[0])
				}
			}
			// Some employers proxy Greenhouse under <slug>.greenhouse.io.
			if strings.HasSuffix(host, ".greenhouse.io") {
				slug := strings.TrimSuffix(host, ".greenhouse.io")
				if slug != "" && slug != "boards" && slug != "job-boards" {
					return sanitizeSlug(slug)
				}
			}
			return ""
		},
		ListingURL: func(slug string) string {
			return "https://job-boards.greenhouse.io/" + slug
		},
	},
	{
		Board: "lever",
		Match: func(u *url.URL) string {
			if strings.ToLower(u.Hostname()) != "jobs.lever.co" {
				return ""
			}
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) >= 1 {
				return sanitizeSlug(parts[0])
			}
			return ""
		},
		ListingURL: func(slug string) string {
			return "https://jobs.lever.co/" + slug
		},
	},
	{
		Board: "ashby",
		Match: func(u *url.URL) string {
			if strings.ToLower(u.Hostname()) != "jobs.ashbyhq.com" {
				return ""
			}
			parts := strings.Split(strings.Trim(u.Path, "/"), "/")
			if len(parts) >= 1 {
				return sanitizeSlug(parts[0])
			}
			return ""
		},
		ListingURL: func(slug string) string {
			return "https://jobs.ashbyhq.com/" + slug
		},
	},
	{
		Board: "workday",
		Match: func(u *url.URL) string {
			host := strings.ToLower(u.Hostname())
			// <slug>.wdN.myworkdayjobs.com — the leftmost label identifies
			// the employer's tenant.
			if !strings.Contains(host, ".myworkdayjobs.com") {
				return ""
			}
			label, _, ok := strings.Cut(host, ".")
			if !ok {
				return ""
			}
			return sanitizeSlug(label)
		},
		ListingURL: func(slug string) string {
			// Workday paths require the tenant + a per-employer site name
			// we don't capture from a single posting URL, so we can only
			// link to the root tenant. Good enough for "where to look".
			return "https://" + slug + ".wd1.myworkdayjobs.com/"
		},
	},
}

// parseJobBoardURL inspects a posting URL and returns the first matching
// provider's {board, slug}. Returns nil when the URL is empty, unparseable,
// or doesn't match any known provider.
func parseJobBoardURL(rawURL string) *jobBoardMatch {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return nil
	}
	for _, parser := range jobBoardParsers {
		slug := parser.Match(u)
		if slug == "" {
			continue
		}
		return &jobBoardMatch{
			Board:       parser.Board,
			Slug:        slug,
			Identity:    parser.Board + ":" + slug,
			CompanyHint: titleCaseSlug(slug),
		}
	}
	return nil
}

// titleCaseSlug turns "typeface" → "Typeface" and "data-bricks" → "Data Bricks".
// Best-effort — the assistant can still rename the company later if the
// employer's preferred capitalization differs.
func titleCaseSlug(slug string) string {
	parts := regexp.MustCompile(`[-_.]+`).Split(slug, -1)
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + strings.ToLower(p[1:])
	}
	return strings.Join(parts, " ")
}
