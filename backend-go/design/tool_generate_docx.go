package design

import (
	. "github.com/CaliLuke/loom-mcp/dsl"
	. "github.com/CaliLuke/loom/dsl"
)

var AssistantDocxTable = Type("AssistantDocxTable", func() {
	Attribute("headers", ArrayOf(String), "Table header cells")
	Attribute("rows", ArrayOf(ArrayOf(String)), "Table body rows")
})

var AssistantDocxSection = Type("AssistantDocxSection", func() {
	Attribute("heading", String, "Optional section heading")
	Attribute("level", Int, "Heading level: 1, 2, or 3")
	Attribute("content", String, "Section prose; blank lines split paragraphs")
	Attribute("pageBreak", Boolean, "Whether to start this section on a new page")
	Attribute("table", AssistantDocxTable, "Optional table for this section")
})

var AssistantGenerateDocxArgs = Type("AssistantGenerateDocxArgs", func() {
	Attribute("title", String, "Document title")
	Attribute("landscape", Boolean, "Whether to use landscape orientation")
	Attribute("sections", ArrayOf(AssistantDocxSection), "Document sections")
	Example(map[string]any{
		"title":     "Tailored Resume Notes",
		"landscape": false,
		"sections":  []any{map[string]any{"heading": "Summary", "level": 1, "content": "Draft content."}},
	})
})

var AssistantGeneratedDocument = Type("AssistantGeneratedDocument", func() {
	Attribute("ok", Boolean, "Whether the document was generated")
	Attribute("filename", String, "Generated filename")
	Attribute("download_url", String, "Local download URL")
	Attribute("document_id", String, "Local document identifier")
	Attribute("version_id", String, "Current document version identifier")
	Attribute("version_number", Int, "Current version number")
	Attribute("error", String, "Error message when generation failed")
})

func declareGenerateDocxTool() {
	Tool("generate_docx", "Generate a new editable DOCX document and store it locally. Use only when the user explicitly wants an editable Word document — for plain text/markdown saves (e.g. job descriptions, notes) prefer save_document.", func() {
		Args(AssistantGenerateDocxArgs)
		Return(AssistantGeneratedDocument)
	})
}
