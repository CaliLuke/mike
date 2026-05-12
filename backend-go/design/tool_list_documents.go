package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantDocumentRef = Type("AssistantDocumentRef", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("application_id", String, "Owning application identifier, when attached to a application")
	Attribute("file_type", String, "Stored file type or MIME hint")
	Attribute("status", String, "Processing status")
})

var AssistantDocumentList = Type("AssistantDocumentList", func() {
	Attribute("documents", ArrayOf(AssistantDocumentRef), "Documents available to the current chat")
})

func declareListDocumentsTool() {
	Tool("list_documents", "List local documents available to the current chat", func() {
		Args(AssistantNoArgs)
		Return(AssistantDocumentList)
	})
}
