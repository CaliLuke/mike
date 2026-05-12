package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantSearchDocumentsArgs = Type("AssistantSearchDocumentsArgs", func() {
	Attribute("query", String, "Optional substring to match against filenames (case-insensitive). Omit for no filename filter.")
	Attribute("application_id", String, "Optional application scope: only return documents attached to this application.")
	Attribute("kind", String, "Optional document kind filter (e.g. resume, job_description, interview_transcript).")
	Attribute("limit", Int, "Maximum number of matches to return. Defaults to 20 when omitted.")
	Example(map[string]any{"application_id": "applications:application_abc", "kind": "job_description"})
})

var AssistantDocumentSummary = Type("AssistantDocumentSummary", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("kind", String, "Document kind (resume, job_description, etc.) when classified")
	Attribute("application_id", String, "Owning application identifier, when scoped to one")
	Attribute("file_type", String, "Storage format (docx, md, pdf, …)")
	Attribute("summary", String, "Short summary from metadata extraction, when available")
})

var AssistantSearchDocumentsResult = Type("AssistantSearchDocumentsResult", func() {
	Attribute("ok", Boolean, "Whether the search ran")
	Attribute("documents", ArrayOf(AssistantDocumentSummary), "Matching documents, ordered by recency")
	Attribute("error", String, "Error message when search failed")
})

func declareSearchDocumentsTool() {
	Tool("search_documents", "Search local documents by filename, application scope, or kind. Use when the user references a document or a file the agent hasn't already seen in the active application's listing.", func() {
		Args(AssistantSearchDocumentsArgs)
		Return(AssistantSearchDocumentsResult)
	})
}
