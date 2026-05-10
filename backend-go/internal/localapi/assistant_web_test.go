package localapi

import (
	"context"
	"strings"
	"testing"
)

func TestSimplifyWebPageContentExtractsReadableText(t *testing.T) {
	title, text := simplifyWebPageContent("text/html", `
		<html>
			<head>
				<title>Senior Product Counsel - GitHub</title>
				<style>.hidden { display: none; }</style>
			</head>
			<body>
				<header>Navigation</header>
				<main>
					<h1>Senior Product Counsel</h1>
					<p>GitHub is hiring counsel to support product teams.</p>
					<script>window.noise = true;</script>
				</main>
				<footer>Footer</footer>
			</body>
		</html>
	`)
	if title != "Senior Product Counsel - GitHub" {
		t.Fatalf("title = %q", title)
	}
	if !strings.Contains(text, "Senior Product Counsel") || !strings.Contains(text, "GitHub is hiring counsel") {
		t.Fatalf("simplified text missing job content: %q", text)
	}
	if strings.Contains(text, "Navigation") || strings.Contains(text, "window.noise") || strings.Contains(text, "Footer") {
		t.Fatalf("simplified text contains page chrome: %q", text)
	}
}

func TestSimplifyWebPageContentPrefersJobPostingJSONLD(t *testing.T) {
	title, text := simplifyWebPageContent("text/html", `
		<html>
			<head>
				<title>Careers Home</title>
				<script type="application/ld+json">
					{
						"@context": "https://schema.org",
						"@type": "JobPosting",
						"title": "Principal Product Manager, Agent Platform",
						"description": "<strong>Overview</strong><p>Own the product vision for Agent Platform.</p><p>Work on agent memory, context, code search and code understanding.</p>",
						"responsibilities": "<ul><li>Fallback responsibilities.</li></ul>"
					}
				</script>
			</head>
			<body>
				<header>Careers navigation</header>
				<main>GitHub Careers Home is hiring. Review all of the job details and apply today!</main>
			</body>
		</html>
	`)
	if title != "Principal Product Manager, Agent Platform" {
		t.Fatalf("title = %q", title)
	}
	for _, want := range []string{
		"Overview",
		"Own the product vision for Agent Platform.",
		"agent memory, context, code search and code understanding",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("simplified text missing %q: %q", want, text)
		}
	}
	if strings.Contains(text, "Careers navigation") || strings.Contains(text, "Review all of the job details") {
		t.Fatalf("simplified text used page chrome instead of JSON-LD: %q", text)
	}
}

func TestSimplifyWebPageContentFindsJobPostingInJSONLDGraph(t *testing.T) {
	title, text := simplifyWebPageContent("text/html", `
		<html>
			<head>
				<title>Generic Careers Shell</title>
				<script type="APPLICATION/LD+JSON; charset=utf-8">
					{
						"@context": "https://schema.org",
						"@graph": [
							{"@type": "Organization", "name": "Example Co"},
							{
								"@type": ["Thing", "JobPosting"],
								"title": "Staff AI Platform PM",
								"description": "<p>Lead platform strategy for developer agents.</p>"
							}
						]
					}
				</script>
			</head>
			<body><main>Search all jobs</main></body>
		</html>
	`)
	if title != "Staff AI Platform PM" {
		t.Fatalf("title = %q", title)
	}
	if text != "Lead platform strategy for developer agents." {
		t.Fatalf("text = %q", text)
	}
}

func TestSimplifyWebPageContentFallsBackWhenJobPostingJSONLDIsUnusable(t *testing.T) {
	title, text := simplifyWebPageContent("text/html", `
		<html>
			<head>
				<title>Readable Job Page</title>
				<script type="application/ld+json">
					{"@type": "JobPosting", "title": "Incomplete Structured Data"}
				</script>
			</head>
			<body>
				<main>
					<h1>Backend Product Manager</h1>
					<p>Build workflow automation for hiring teams.</p>
				</main>
			</body>
		</html>
	`)
	if title != "Readable Job Page" {
		t.Fatalf("title = %q", title)
	}
	if !strings.Contains(text, "Backend Product Manager") || !strings.Contains(text, "workflow automation") {
		t.Fatalf("fallback text missing visible job content: %q", text)
	}
}

func TestValidatePublicWebURLRejectsLocalTargets(t *testing.T) {
	for _, rawURL := range []string{
		"http://localhost/jobs",
		"http://127.0.0.1/jobs",
		"http://10.0.0.1/jobs",
		"file:///tmp/job.html",
	} {
		if _, err := validatePublicWebURL(context.Background(), rawURL); err == nil {
			t.Fatalf("validatePublicWebURL(%q) succeeded, want error", rawURL)
		}
	}
}
