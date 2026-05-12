package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantAttachDocumentArgs = Type("AssistantAttachDocumentArgs", func() {
	Attribute("document_id", String, "Existing document to link")
	Attribute("application_id", String, "Application that should reference the document")
	Required("document_id", "application_id")
	Example(map[string]any{"document_id": "documents:doc_abc", "application_id": "applications:application_xyz"})
})

var AssistantAttachDocumentResult = Type("AssistantAttachDocumentResult", func() {
	Attribute("ok", Boolean, "Whether the link was created (or already existed)")
	Attribute("link_id", String, "Identifier of the link row")
	Attribute("error", String, "Error message when linking failed")
})

func declareAttachDocumentTool() {
	Tool("attach_document_to_application", "Link an existing library document into an application so it shows up in the application's file list. Idempotent.", func() {
		Args(AssistantAttachDocumentArgs)
		Return(AssistantAttachDocumentResult)
	})
}
