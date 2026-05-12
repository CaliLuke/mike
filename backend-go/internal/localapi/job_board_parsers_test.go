package localapi

import "testing"

func TestParseJobBoardURLRecognizesKnownProviders(t *testing.T) {
	cases := []struct {
		name        string
		url         string
		wantBoard   string
		wantSlug    string
		wantCompany string
	}{
		{
			name:        "greenhouse_new_path",
			url:         "https://job-boards.greenhouse.io/typeface/jobs/5103539007?gh_src=c2824f177us",
			wantBoard:   "greenhouse",
			wantSlug:    "typeface",
			wantCompany: "Typeface",
		},
		{
			name:        "greenhouse_legacy_path",
			url:         "https://boards.greenhouse.io/stripe/jobs/12345",
			wantBoard:   "greenhouse",
			wantSlug:    "stripe",
			wantCompany: "Stripe",
		},
		{
			name:        "lever",
			url:         "https://jobs.lever.co/notion/abcd-ef",
			wantBoard:   "lever",
			wantSlug:    "notion",
			wantCompany: "Notion",
		},
		{
			name:        "ashby",
			url:         "https://jobs.ashbyhq.com/anthropic/openings/123",
			wantBoard:   "ashby",
			wantSlug:    "anthropic",
			wantCompany: "Anthropic",
		},
		{
			name:        "workday_tenant_subdomain",
			url:         "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/1234",
			wantBoard:   "workday",
			wantSlug:    "nvidia",
			wantCompany: "Nvidia",
		},
		{
			name:        "slug_with_hyphens_title_cases_per_segment",
			url:         "https://job-boards.greenhouse.io/some-co/jobs/9",
			wantBoard:   "greenhouse",
			wantSlug:    "some-co",
			wantCompany: "Some Co",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseJobBoardURL(tc.url)
			if got == nil {
				t.Fatalf("parseJobBoardURL(%q) returned nil", tc.url)
			}
			if got.Board != tc.wantBoard {
				t.Errorf("board = %q, want %q", got.Board, tc.wantBoard)
			}
			if got.Slug != tc.wantSlug {
				t.Errorf("slug = %q, want %q", got.Slug, tc.wantSlug)
			}
			if got.CompanyHint != tc.wantCompany {
				t.Errorf("company hint = %q, want %q", got.CompanyHint, tc.wantCompany)
			}
			if got.Identity != tc.wantBoard+":"+tc.wantSlug {
				t.Errorf("identity = %q, want %q", got.Identity, tc.wantBoard+":"+tc.wantSlug)
			}
		})
	}
}

func TestParseJobBoardURLRejectsUnknown(t *testing.T) {
	cases := []string{
		"",
		"   ",
		"not a url",
		"https://example.com/jobs/123",
		"https://careers.google.com/jobs/results/12345",
		"https://www.github.careers/careers-home/jobs/5140",
	}
	for _, raw := range cases {
		if got := parseJobBoardURL(raw); got != nil {
			t.Errorf("parseJobBoardURL(%q) = %+v, want nil", raw, got)
		}
	}
}
