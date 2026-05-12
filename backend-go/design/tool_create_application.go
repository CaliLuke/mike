package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantCreateApplicationArgs = Type("AssistantCreateApplicationArgs", func() {
	Attribute("name", String, "Application name, usually the role title from the job ad")
	Attribute("company_id", String, "Local company identifier returned by create_company or a prior company_created event")
	Attribute("job_description_text", String, "Optional full job description text to save as an application document")
	Attribute("job_description_url", String, "Optional source URL for the job description")
	Example(map[string]any{"name": "Senior Product Counsel", "company_id": "company_123", "job_description_url": "https://example.com/jobs/123"})
})

var AssistantCreatedApplication = Type("AssistantCreatedApplication", func() {
	Attribute("ok", Boolean, "Whether the application was created")
	Attribute("application_id", String, "Local application identifier")
	Attribute("company_id", String, "Attached local company identifier")
	Attribute("name", String, "Application name")
	Attribute("job_description_document_id", String, "Created job description document identifier, when job text was provided")
	Attribute("error", String, "Error message when creation failed")
})

func declareCreateApplicationTool() {
	Tool("create_application", "Create a tracked job application attached to a company. Do NOT call this when the chat is already scoped to an existing application — operate on that application instead (use save_document for job descriptions, etc.).", func() {
		Args(AssistantCreateApplicationArgs)
		Return(AssistantCreatedApplication)
	})
}
