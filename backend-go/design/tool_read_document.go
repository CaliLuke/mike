package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantReadDocumentArgs = Type("AssistantReadDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to read")
	Example(map[string]any{"document_id": "doc_123"})
})

func declareReadDocumentTool() {
	Tool("read_document", "Read the text content of one local document", func() {
		Args(AssistantReadDocumentArgs)
		Return(AssistantDocumentText)
	})
}
