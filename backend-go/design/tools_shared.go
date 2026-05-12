package design

import . "github.com/CaliLuke/loom/dsl"

// Cross-tool types — kept in one place because more than one tool
// references them. Per-tool types live in their tool's own
// tool_<name>.go file.

var AssistantNoArgs = Type("AssistantNoArgs", func() {
	Example(map[string]any{})
})

// AssistantDocumentText is the body of one fetched document. Used as
// the read_document return, and as the element type of the
// fetch_documents return bundle.
var AssistantDocumentText = Type("AssistantDocumentText", func() {
	Attribute("document_id", String, "Local document identifier")
	Attribute("filename", String, "Document filename")
	Attribute("text", String, "Plain text extracted from the current document version")
})
