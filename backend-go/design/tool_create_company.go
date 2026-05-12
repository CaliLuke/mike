package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantCreateCompanyArgs = Type("AssistantCreateCompanyArgs", func() {
	Attribute("name", String, "Company name")
	Attribute("website", String, "Optional company website")
	Attribute("confirm_new", Boolean, "Set true only after reviewing a similar existing company and deciding a separate company should be created")
	Example(map[string]any{"name": "Acme Inc.", "website": "https://example.com"})
})

var AssistantCreatedCompany = Type("AssistantCreatedCompany", func() {
	Attribute("ok", Boolean, "Whether the company was created")
	Attribute("company_id", String, "Local company identifier")
	Attribute("name", String, "Company name")
	Attribute("website", String, "Company website")
	Attribute("reused_existing", Boolean, "Whether an existing company was reused instead of creating a duplicate")
	Attribute("requires_confirmation", Boolean, "Whether a similar existing company blocked creation until confirm_new is true")
	Attribute("similar_company_id", String, "Similar existing company identifier, when one was found")
	Attribute("similar_company_name", String, "Similar existing company name, when one was found")
	Attribute("similarity", Float64, "Similarity score for the nearest existing company, from 0 to 1")
	Attribute("error", String, "Error message when creation failed")
})

func declareCreateCompanyTool() {
	Tool("create_company", "Create a company for attaching applications. Always call search_companies first; only invoke this when no acceptable existing company was found.", func() {
		Args(AssistantCreateCompanyArgs)
		Return(AssistantCreatedCompany)
	})
}
