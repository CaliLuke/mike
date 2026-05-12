package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantSetApplicationCompanyArgs = Type("AssistantSetApplicationCompanyArgs", func() {
	Attribute("application_id", String, "Local application identifier to move")
	Attribute("company_id", String, "Existing local company identifier to attach. Mutually exclusive with company_name.")
	Attribute("company_name", String, "Free-text company name. When set, the tool resolves an existing matching company or creates a new one — preferred when the assistant has just identified the company from materials.")
	Attribute("confirm_new", Boolean, "When using company_name and a similar company already exists, set true to bypass the dedupe warning and create a fresh row.")
	Example(map[string]any{"application_id": "application_123", "company_name": "GitHub, Inc."})
})

var AssistantSetApplicationCompanyResult = Type("AssistantSetApplicationCompanyResult", func() {
	Attribute("ok", Boolean, "Whether the application's company was updated")
	Attribute("application_id", String, "Local application identifier")
	Attribute("company_id", String, "Now-attached local company identifier")
	Attribute("company_name", String, "Now-attached company name")
	Attribute("previous_company_id", String, "Previously attached company identifier")
	Attribute("previous_company_name", String, "Previously attached company name")
	Attribute("requires_confirmation", Boolean, "Whether a similar existing company blocked creation until confirm_new is true")
	Attribute("similar_company_id", String, "Similar existing company identifier, when one was found")
	Attribute("similar_company_name", String, "Similar existing company name, when one was found")
	Attribute("similarity", Float64, "Similarity score for the nearest existing company, from 0 to 1")
	Attribute("error", String, "Error message when the update failed")
})

func declareSetApplicationCompanyTool() {
	Tool("set_application_company", "Move an existing application onto a different (usually newly identified) company. Use after reading the job description to swap the application off the Unknown placeholder.", func() {
		Args(AssistantSetApplicationCompanyArgs)
		Return(AssistantSetApplicationCompanyResult)
	})
}
