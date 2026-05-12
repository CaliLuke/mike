package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantFindDocumentArgs = Type("AssistantFindDocumentArgs", func() {
	Attribute("document_id", String, "Local document identifier to search")
	Attribute("query", String, "Exact text to find")
	Attribute("max_results", Int, "Maximum number of matches to return")
	Attribute("context_chars", Int, "Characters of context to include around each match")
	Example(map[string]any{"document_id": "doc_123", "query": "React", "max_results": 5, "context_chars": 120})
})

var AssistantDocumentMatch = Type("AssistantDocumentMatch", func() {
	Attribute("index", Int, "Zero-based match index")
	Attribute("start", Int, "Start character offset")
	Attribute("end", Int, "End character offset")
	Attribute("quote", String, "Matched text")
	Attribute("context", String, "Surrounding text context")
})

var AssistantDocumentMatches = Type("AssistantDocumentMatches", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("matches", ArrayOf(AssistantDocumentMatch), "Search matches")
	Attribute("total_matches", Int, "Total matches found before truncation")
})

func declareFindInDocumentTool() {
	Tool("find_in_document", "Find exact text matches in one local document", func() {
		Args(AssistantFindDocumentArgs)
		Return(AssistantDocumentMatches)
	})
}
