package localapi

import (
	"strings"
	"testing"
)

func TestHTMLToMarkdownPreservesJobPostingStructure(t *testing.T) {
	// Shape modelled on Greenhouse postings (boards.greenhouse.io and
	// job-boards.greenhouse.io). The walker should turn block-level
	// elements into paragraphs/headings/lists and drop chrome.
	src := `<!DOCTYPE html><html><head><title>Staff PM at Typeface</title>
<script>tracking()</script><style>.x{color:red}</style></head>
<body>
<nav>Back to jobs</nav>
<main>
<h1>Staff Product Manager</h1>
<p>Palo Alto, CA</p>
<h2>About Typeface</h2>
<p>We help the world's biggest brands move from brief to fully personalized campaigns.</p>
<p><strong>What You'll Do</strong></p>
<p>As a Staff Product Manager, you'll operate as a product leader.</p>
<h2>How You'll Make an Impact</h2>
<ul>
<li>Define and drive product strategy across major product areas</li>
<li>Work with engineering, design and other product teams</li>
<li>Identify and prioritize high-impact opportunities</li>
</ul>
<h2>What You Bring</h2>
<ul>
<li>7-10+ years of product management experience</li>
<li>Strong experience with AI/ML or data-intensive products</li>
</ul>
<p>Visit <a href="https://typeface.ai">our website</a> for more info.</p>
</main>
<footer>Apply form goes here</footer>
<form><input name="email"></form>
</body></html>`

	got := htmlToMarkdown(src)
	if got == "" {
		t.Fatal("htmlToMarkdown returned empty string")
	}

	mustContain := []string{
		"# Staff Product Manager",
		"## About Typeface",
		"## How You'll Make an Impact",
		"- Define and drive product strategy across major product areas",
		"- Work with engineering, design and other product teams",
		"- 7-10+ years of product management experience",
		"**What You'll Do**",
		"[our website](https://typeface.ai)",
		"Palo Alto, CA",
	}
	for _, want := range mustContain {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in output:\n%s", want, got)
		}
	}

	mustNotContain := []string{
		"tracking()",      // script body
		".x{color:red}",   // style body
		"Apply form goes", // footer content
		"email",           // form input
		"Back to jobs",    // nav chrome
	}
	for _, unwanted := range mustNotContain {
		if strings.Contains(got, unwanted) {
			t.Errorf("found chrome %q in output:\n%s", unwanted, got)
		}
	}
}

func TestHTMLToMarkdownFallsBackWhenNoMainOrArticle(t *testing.T) {
	src := `<html><body>
<h1>Title</h1>
<p>Plain paragraph.</p>
<ul><li>One</li><li>Two</li></ul>
</body></html>`
	got := htmlToMarkdown(src)
	for _, want := range []string{"# Title", "Plain paragraph.", "- One", "- Two"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in output:\n%s", want, got)
		}
	}
}

func TestHTMLToMarkdownHandlesNestedLists(t *testing.T) {
	src := `<main><ul>
<li>Outer
<ul><li>Inner A</li><li>Inner B</li></ul>
</li>
<li>Outer 2</li>
</ul></main>`
	got := htmlToMarkdown(src)
	if !strings.Contains(got, "- Outer") {
		t.Errorf("missing outer bullet:\n%s", got)
	}
	if !strings.Contains(got, "  - Inner A") {
		t.Errorf("missing indented inner bullet:\n%s", got)
	}
	if !strings.Contains(got, "  - Inner B") {
		t.Errorf("missing indented inner bullet:\n%s", got)
	}
}

func TestHTMLToMarkdownDoesNotTruncate(t *testing.T) {
	// Builds a 50KB body to confirm the walker has no internal cap. The
	// 2KB jobPromptCharCap applies only to the LLM snippet path; the
	// markdown body should round-trip in full.
	var sb strings.Builder
	sb.WriteString("<main>")
	for i := 0; i < 1000; i++ {
		sb.WriteString("<p>")
		sb.WriteString(strings.Repeat("x", 60))
		sb.WriteString("</p>")
	}
	sb.WriteString("</main>")
	got := htmlToMarkdown(sb.String())
	if len(got) < 40_000 {
		t.Errorf("expected ≥40KB output, got %d chars (truncation regression?)", len(got))
	}
}
