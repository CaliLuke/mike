package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantSearchCompaniesArgs = Type("AssistantSearchCompaniesArgs", func() {
	Attribute("query", String, "Optional partial name to match against existing companies. Omit or empty for the most recent companies.")
	Attribute("limit", Int, "Maximum number of matches to return. Defaults to 8 when omitted.")
	Example(map[string]any{"query": "GitHub"})
})

var AssistantCompanyRef = Type("AssistantCompanyRef", func() {
	Attribute("company_id", String, "Local company identifier")
	Attribute("name", String, "Company name")
	Attribute("website", String, "Company website, when set")
	Attribute("similarity", Float64, "Fuzzy-match score from 0 to 1 against the query, when one was provided")
	Attribute("exact_key", Boolean, "True when the normalised company name exactly matches the query")
})

var AssistantSearchCompaniesResult = Type("AssistantSearchCompaniesResult", func() {
	Attribute("ok", Boolean, "Whether the search ran")
	Attribute("companies", ArrayOf(AssistantCompanyRef), "Matching companies, ordered by relevance (or by recency when query is empty)")
	Attribute("error", String, "Error message when search failed")
})

func declareSearchCompaniesTool() {
	Tool("search_companies", "Search the user's local companies by partial name. Always call this BEFORE create_company so existing matches can be reused; only fall through to create_company when no match is appropriate.", func() {
		Args(AssistantSearchCompaniesArgs)
		Return(AssistantSearchCompaniesResult)
	})
}
