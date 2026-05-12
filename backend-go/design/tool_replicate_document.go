package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantReplicateDocumentArgs = Type("AssistantReplicateDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to copy")
	Attribute("count", Int, "Number of copies to create")
	Attribute("new_filename", String, "Optional filename for a single copy")
	Example(map[string]any{"document_id": "doc_123", "count": 2})
})

var AssistantDocumentCopy = Type("AssistantDocumentCopy", func() {
	Attribute("new_filename", String, "Copied document filename")
	Attribute("document_id", String, "New local document identifier")
	Attribute("version_id", String, "New version identifier")
	Attribute("download_url", String, "Local download URL")
})

var AssistantReplicatedDocuments = Type("AssistantReplicatedDocuments", func() {
	Attribute("ok", Boolean, "Whether replication succeeded")
	Attribute("filename", String, "Source filename")
	Attribute("count", Int, "Number of copies created")
	Attribute("copies", ArrayOf(AssistantDocumentCopy), "Created copies")
	Attribute("error", String, "Error message when replication failed")
})

func declareReplicateDocumentTool() {
	Tool("replicate_document", "Copy an existing document into one or more new local documents", func() {
		Args(AssistantReplicateDocumentArgs)
		Return(AssistantReplicatedDocuments)
	})
}
