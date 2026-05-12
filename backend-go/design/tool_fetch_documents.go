package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantFetchDocumentsArgs = Type("AssistantFetchDocumentsArgs", func() {
	Attribute("document_ids", ArrayOf(String), "Local document identifiers to fetch")
	Example(map[string]any{"document_ids": []string{"doc_123", "doc_456"}})
})

var AssistantDocumentBundle = Type("AssistantDocumentBundle", func() {
	Attribute("documents", ArrayOf(AssistantDocumentText), "Fetched document contents")
})

func declareFetchDocumentsTool() {
	Tool("fetch_documents", "Fetch text from multiple local documents", func() {
		Args(AssistantFetchDocumentsArgs)
		Return(AssistantDocumentBundle)
	})
}
