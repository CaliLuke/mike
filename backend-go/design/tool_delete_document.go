package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantDeleteDocumentArgs = Type("AssistantDeleteDocumentArgs", func() {
	Attribute("document_id", String, "Document to remove")
	Required("document_id")
	Example(map[string]any{"document_id": "documents:doc_abc"})
})

var AssistantDeleteDocumentResult = Type("AssistantDeleteDocumentResult", func() {
	Attribute("ok", Boolean, "Whether the document was deleted")
	Attribute("error", String, "Error message when deletion failed")
})

func declareDeleteDocumentTool() {
	Tool("delete_document", "Delete a document and its versions. Irreversible — only call when the user has explicitly asked to remove it.", func() {
		Args(AssistantDeleteDocumentArgs)
		Return(AssistantDeleteDocumentResult)
	})
}
