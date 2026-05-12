package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantSaveDocumentArgs = Type("AssistantSaveDocumentArgs", func() {
	Attribute("application_id", String, "Optional application to attach the new document to. Omit for a library (no-application) document.")
	Attribute("filename", String, "Filename including extension, e.g. \"Job description.md\"")
	Attribute("kind", String, "Document kind. Use \"job_description\" when saving a fetched job posting, \"resume\" for resumes, otherwise a descriptive kind or omit to leave unclassified.")
	Attribute("body", String, "Document body. Markdown is preferred for kind=job_description. Plain text accepted otherwise.")
	Attribute("format", String, "Storage format suffix used to render the body downstream: \"md\" (default) for markdown/text, \"txt\" for plain text.")
	Required("filename", "body")
	Example(map[string]any{
		"application_id": "applications:application_abc",
		"filename":       "Job description.md",
		"kind":           "job_description",
		"body":           "# Senior Engineer\n\nAcme is hiring…",
	})
})

var AssistantSavedDocument = Type("AssistantSavedDocument", func() {
	Attribute("ok", Boolean, "Whether the document was created")
	Attribute("document_id", String, "Local document identifier of the new document")
	Attribute("filename", String, "Filename of the saved document")
	Attribute("application_id", String, "Application the document was attached to, when applicable")
	Attribute("download_url", String, "Relative URL to download the saved document")
	Attribute("error", String, "Error message when saving failed")
})

func declareSaveDocumentTool() {
	Tool("save_document", "Persist arbitrary text content (e.g. a fetched job description, notes) as a new document, optionally attached to an application. Prefer this over create_application when only saving a file is requested.", func() {
		Args(AssistantSaveDocumentArgs)
		Return(AssistantSavedDocument)
	})
}
